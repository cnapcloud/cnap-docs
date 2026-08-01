---
title: "설치 환경 구성"
sidebar_position: 1
---

---

## 1. 개요
**클라우드 네이티브 애플리케이션 플랫폼 설치**를 위해 GitOps로 구성된 모듈을 배포하는 방법을 안내합니다. **Kustomize**와 **Helm 차트**를 활용하여 Kubernetes 클러스터에 자동 배포할 수 있으며, 모든 모듈을 설치함으로써 완전한 GitOps 기반 개발 및 배포 플랫폼을 구성할 수 있습니다.

> **도메인 안내**: 이 가이드 전반에서 `cnapcloud.com`을 예시 도메인으로 사용합니다. 실제 구성 시에는 본인이 소유한 도메인으로 교체해야 합니다. 도메인이 등장하는 모든 파일(`ClusterIssuer`, `Certificate`, `Ingress`, `values.yaml` 등)에서 `cnapcloud.com`을 실제 도메인으로 변경하세요.

관련 소스 코드는 [GitHub Repository](https://github.com/cnapcloud/gitops.git)에서 확인할 수 있습니다.

---

## 2. 설치 환경 구성

### 2.1 Kubernetes 구축

본 가이드의 모든 모듈은 **AWS EKS 1.33**과 **Kind 1.34** 환경에서 기능이 검증되었으며, Kubernetes 버전 **1.30 이상**을 권장합니다. 클러스터는 고가용성을 위해 **노드 3개 이상**으로 구성하는 것을 권장합니다.

Kubernetes 클러스터가 없는 경우 Kind(Kubernetes in Docker)를 사용하여 로컬 환경에 경량 클러스터를 구성할 수 있습니다. ([Kind 설치 가이드](../cluster/kind-provision.md) 참조)

### 2.2 GitOps 도구 설치

SOPS, kubectl, Helm, Kustomize, SopsSecretGenerator를 설치합니다.

```bash
# Architecture: amd64, arm64
ARCH=amd64

# SOPS 설치
curl -LO https://github.com/getsops/sops/releases/download/v3.9.0/sops-v3.9.0.linux.${ARCH}
sudo mv sops-v3.9.0.linux.${ARCH} /usr/local/bin/sops
sudo chmod +x /usr/local/bin/sops

# kubectl 설치
KUBECTL_VERSION="v1.30.0"
curl -sLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl"
sudo mv kubectl /usr/local/bin/
sudo chmod +x /usr/local/bin/kubectl

# Helm 설치
HELM_VERSION="v3.17.1"
curl -sLo helm.tar.gz https://get.helm.sh/helm-${HELM_VERSION}-linux-${ARCH}.tar.gz
tar -xzf helm.tar.gz
sudo mv linux-${ARCH}/helm /usr/local/bin/helm
sudo chmod +x /usr/local/bin/helm

# Kustomize 설치
KUSTOMIZE_VERSION="v5.6.0"
curl -sLo kustomize.tar.gz https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${KUSTOMIZE_VERSION}/kustomize_${KUSTOMIZE_VERSION}_linux_${ARCH}.tar.gz
tar -xzf kustomize.tar.gz
sudo mv kustomize /usr/local/bin/
sudo chmod +x /usr/local/bin/kustomize

# Kustomize SopsSecretGenerator 설치
PLUGIN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/kustomize/plugin/goabout.com/v1beta1/sopssecretgenerator"
mkdir -p "$PLUGIN_DIR"
curl -kL -o "$PLUGIN_DIR/SopsSecretGenerator" \
  https://github.com/goabout/kustomize-sopssecretgenerator/releases/download/v1.6.0/SopsSecretGenerator_1.6.0_linux_${ARCH}
chmod +x "$PLUGIN_DIR/SopsSecretGenerator"
```

### 2.3 GPG 키 생성 및 SOPS 설정

배포 시 SOPS로 암호화된 Secret을 복호화하려면 GPG 키가 필요합니다.

**신규 키 생성:**
```bash
export KEY_NAME="master"
export KEY_COMMENT="master key for sops"

gpg --batch --full-generate-key <<EOF
%no-protection
Key-Type: 1
Key-Length: 4096
Subkey-Type: 1
Subkey-Length: 4096
Expire-Date: 0
Name-Comment: ${KEY_COMMENT}
Name-Real: ${KEY_NAME}
EOF

# 키 내보내기
mkdir -p .gpg
gpg --export-secret-keys > .gpg/private-master.asc
gpg --export > .gpg/public-master.asc
```

**기존 키 등록:**
```bash
gpg --import .gpg/public-master.asc
gpg --import .gpg/private-master.asc
```

**Fingerprint 확인 및 `.sops.yaml` 설정:**
```bash
gpg --list-keys --keyid-format long
# 출력에서 40자리 Fingerprint 확인
```

```yaml
# .sops.yaml (프로젝트 루트)
creation_rules:
  - path_regex: .*\.enc\.(yaml|yml|env)$
    pgp: <GPG_FINGERPRINT>
```

> **주의**: `.gpg/` 폴더는 `.gitignore`에 등록하여 Git에 커밋되지 않도록 합니다. 개인 키는 안전한 별도 저장소에 보관하세요.

---

## 3. 설치 순서

GitOps 모듈들은 상호 의존성이 있으므로 다음 순서대로 설치합니다.

```bash
git clone https://github.com/cnapcloud/gitops.git
cd gitops
```

모든 모듈의 ServiceMonitor 리소스가 Prometheus CRD에 의존하므로, Prometheus 설치(5-01) 전에 CRD를 먼저 설치합니다.

```bash
# Prometheus CRD만 설치 (Prometheus 본체는 5-01 단계에서 설치)
cd prometheus && make crd && cd ..
```

### 3.1 네트워크 및 인증서 관리

| 순서 | 모듈 | 설명 | 가이드 |
|------|------|------|--------|
| 1-01 | **MetalLB** | LoadBalancer IP 할당 | [1-01-metallb.md](network/metallb.md) |
| 1-02 | **Reflector** | 네임스페이스 간 Secret 복제 | [1-02-reflector.md](network/reflector.md) |
| 1-03 | **cert-manager** | TLS 인증서 자동 발급 및 갱신 | [1-03-cert-manager.md](network/cert-manager.md) |
| 1-04 | **NGINX Ingress Controller** | HTTP/HTTPS 트래픽 라우팅 | [1-04-ingress-nginx.md](network/ingress-nginx.md) |

> **참고**: AWS EKS 환경에서는 MetalLB, NGINX Ingress Controller 설치를 생략할 수 있습니다.

### 3.2 데이터베이스 플랫폼

| 순서 | 모듈 | 설명 | 가이드 |
|------|------|------|--------|
| 2-01 | **Redis HA** | 고가용성 Redis (Proxy, Sentinel) | [2-01-redis-ha.md](data-platform/redis-ha.md) |
| 2-02 | **MinIO** | 객체 스토리지 | [2-02-minio.md](data-platform/minio.md) |
| 2-03 | **CNPG Operator** | CloudNativePG Operator | [2-03-cnpg-operator.md](data-platform/cnpg-operator.md) |
| 2-04 | **CNPG Cluster** | PostgreSQL 클러스터 | [2-04-cnpg-cluster.md](data-platform/cnpg-cluster.md) |
| 2-05 | **ECK Operator** | Elastic Cloud on Kubernetes Operator | [2-05-eck-operator.md](data-platform/eck-operator.md) |
| 2-06 | **ECK Stack** | Elasticsearch, Kibana | [2-06-eck-stack.md](data-platform/eck-stack.md) |
| 2-07 | **OpenSearch Cluster** | OpenSearch 클러스터 | [2-07-opensearch-cluster.md](data-platform/opensearch-cluster.md) |
| 2-08 | **OpenSearch Dashboard** | OpenSearch 대시보드 | [2-08-opensearch-dashboard.md](data-platform/opensearch-dashboard.md) |

### 3.3 인증 및 트래픽 관리 플랫폼

| 순서 | 모듈 | 설명 | 가이드 |
|------|------|------|--------|
| 3-01 | **Keycloak** | 통합 ID 및 액세스 관리 (IAM) | [3-01-keycloak.md](auth-routing/keycloak.md) |
| 3-02 | **OAuth2 Proxy** | 애플리케이션 수준 인증 프록시 | [3-02-oauth2-proxy.md](auth-routing/oauth2-proxy.md) |
| 3-03 | **Kong Gateway** | API 관리 및 보안 정책 | [3-03-kong.md](auth-routing/kong.md) |

### 3.4 CI/CD 플랫폼

| 순서 | 모듈 | 설명 | 가이드 |
|------|------|------|--------|
| 4-01 | **Jenkins** | CI/CD 오케스트레이션 | [4-01-jenkins.md](cicd/jenkins.md) |
| 4-02 | **Harbor** | 컨테이너 이미지 레지스트리 | [4-02-harbor.md](cicd/harbor.md) |
| 4-03 | **ArgoCD** | GitOps 기반 CD | [4-03-argocd.md](cicd/argocd.md) |

### 3.5 관측성 플랫폼

| 순서 | 모듈 | 설명 | 가이드 |
|------|------|------|--------|
| 5-01 | **Prometheus Stack** | 메트릭 수집 / Grafana / AlertManager | [5-01-prometheus.md](observability/prometheus.md) |

### 3.6 애플리케이션

| 순서 | 모듈 | 설명 | 가이드 |
|------|------|------|--------|
| 7-01 | **MSA Demo** | 마이크로서비스 데모 애플리케이션 | [7-01-demo.md](application/demo.md) |

---

## 4. 모듈 배포

### 4.1 GitOps 모듈 폴더 구조

```
module/
├── Makefile                       # 배포 자동화 스크립트
└── kustomize/
    ├── base/                      # 공통 기본 설정 (모든 환경 공유)
    │   ├── configmap/
    │   ├── helm/                  # Helm 차트
    │   ├── patches/
    │   ├── resources/
    │   ├── secrets/               # SOPS 암호화된 Secret
    │   └── kustomization.yaml
    └── overlays/
        └── dev/                   # 환경별 오버레이
            ├── configmap/
            ├── helm/
            │   └── values.yaml    # 환경별 Helm 설정
            ├── patches/
            ├── resources/
            ├── secrets/
            └── kustomization.yaml
```

### 4.2 모듈 배포 설정

각 모듈 배포 전 다음 파일들을 환경에 맞게 수정합니다.

1. **`overlays/dev/helm/values.yaml`**
   - `ingress.hostname`: 실제 도메인으로 변경
   - TLS Secret 이름: `secretName: yourdomain.com-tls`
   - 비밀번호: 기본값(`password`) 강력한 비밀번호로 변경
   - Keycloak 연동: `oidc.clientId`, `oidc.clientSecret` 설정

2. **`overlays/dev/patches/`**
   - Host Aliases: 클러스터 내부 DNS 해석용 IP/호스트명 매핑
   - 리소스 제한, 설정 오버라이드

3. **`base/secrets/sops/`**
   - SOPS 암호화 파일(`.enc.yaml`, `.enc.env`) — GPG 키로 복호화 → 편집 → 재암호화

4. **`overlays/dev/kustomization.yaml`**
   - `namespace` 필드 확인
   - 패치 참조 경로 확인

### 4.3 기본 구성 변경

| 항목 | 기본값 | 변경 필요 |
|------|--------|-----------|
| 도메인 | `모듈명.cnapcloud.com` | 실제 도메인으로 변경 |
| 비밀번호 | `password` | 강력한 비밀번호로 변경 |
| Keycloak Realm | `cnap` | 환경에 맞게 변경 |
| Persistence 크기 | `4Gi` | 환경에 맞게 조정 |

### 4.4 배포 전 확인 사항

- [ ] `make preview`로 dry-run 확인
- [ ] DNS 도메인 해석 확인
- [ ] TLS 인증서 준비 완료 (cert-manager)
- [ ] Keycloak Client Secret 설정 완료
- [ ] GPG 키 SOPS 복호화 가능 확인

### 4.5 배포 방법

```bash
cd <모듈명>

make pull        # Helm Chart 다운로드
make namespace   # 네임스페이스 생성
make preview     # 매니페스트 확인 (dry-run)
make apply       # 배포 실행
```

---

## 5. 도메인 및 인증서 구성

### 5.1 도메인 등록

| 도메인 | 용도 | 모듈 |
|--------|------|------|
| `keycloak.cnapcloud.com` | Keycloak | Keycloak |
| `keycloak-admin.cnapcloud.com` | Keycloak 관리 콘솔 | Keycloak |
| `argocd.cnapcloud.com` | ArgoCD 웹 UI | ArgoCD |
| `harbor.cnapcloud.com` | 컨테이너 이미지 레지스트리 | Harbor |
| `jenkins.cnapcloud.com` | CI/CD 플랫폼 | Jenkins |
| `prometheus.cnapcloud.com` | 모니터링 대시보드 | Prometheus |
| `grafana.cnapcloud.com` | 시각화 대시보드 | Prometheus |
| `kibana.cnapcloud.com` | 로그 분석 | ECK |
| `osd.cnapcloud.com` | OpenSearch 대시보드 | OpenSearch |
| `minio.cnapcloud.com` | 오브젝트 스토리지 콘솔 | MinIO |
| `oauth2-proxy.cnapcloud.com` | 인증 게이트웨이 | OAuth2 Proxy |
| `kong-manager.cnapcloud.com` | Kong 관리 콘솔 | Kong |
| `kong-admin.cnapcloud.com` | Kong Admin API | Kong |
| `kong-proxy.cnapcloud.com` | Kong 프록시 | Kong |
| `httpbin.cnapcloud.com` | HTTP 테스트 서비스 | OAuth2 Proxy |
| `msa-demo.cnapcloud.com` | MSA 데모 | Demo |
| `react-keycloak.cnapcloud.com` | React Keycloak 연동 데모 | Demo |

**로컬 DNS (`/etc/hosts`):**
```bash
sudo tee -a /etc/hosts <<EOF
127.0.0.1 keycloak.cnapcloud.com keycloak-admin.cnapcloud.com
127.0.0.1 argocd.cnapcloud.com harbor.cnapcloud.com jenkins.cnapcloud.com
127.0.0.1 prometheus.cnapcloud.com grafana.cnapcloud.com kibana.cnapcloud.com osd.cnapcloud.com
127.0.0.1 minio.cnapcloud.com oauth2-proxy.cnapcloud.com
127.0.0.1 kong-manager.cnapcloud.com kong-admin.cnapcloud.com kong-proxy.cnapcloud.com
127.0.0.1 httpbin.cnapcloud.com msa-demo.cnapcloud.com react-keycloak.cnapcloud.com
EOF
```

**클러스터 내부 CoreDNS 설정 (로컬 환경):**

클러스터 내부에서 Keycloak 등 Ingress 서비스에 접근하려면 CoreDNS에 Ingress IP를 등록합니다.

```bash
# Ingress IP 확인
kubectl get svc -n ingress-nginx

# CoreDNS ConfigMap 편집
kubectl -n kube-system edit configmap coredns
```

`Corefile`에 추가 (Ingress IP가 `10.0.0.1`인 경우):
```
.:53 {
    hosts {
      10.0.0.1 keycloak.cnapcloud.com
      10.0.0.1 harbor.cnapcloud.com
      fallthrough
    }
    ...
}
```

```bash
kubectl -n kube-system rollout restart deployment coredns
```

### 5.2 TLS 인증서 구성

모든 모듈은 wildcard TLS 인증서(`*.cnapcloud.com`)를 공유합니다. cert-manager + Cloudflare DNS-01로 발급하고, Reflector로 각 네임스페이스에 자동 복제합니다.

- cert-manager 설치 후 `*.cnapcloud.com` 인증서 발급 ([1-04-cert-manager.md](network/cert-manager.md) 참조)
- 각 모듈 Ingress에서 `secretName: cnapcloud.com-tls` 사용
- 도메인 변경 시 Certificate `dnsNames`와 Ingress `secretName` 일괄 수정 필요

> **주의**: Cloudflare DNS-01 ClusterIssuer는 하나만 활성화해야 합니다. 중복 시 DNS Challenge 충돌이 발생합니다.

---

## 6. Keycloak 통합 인증 구성

ArgoCD, Jenkins, Harbor, Kong, OAuth2 Proxy, Grafana는 Keycloak OIDC로 SSO를 구성합니다. Keycloak 배포 완료 후 아래 설정을 진행합니다.

### 6.1 Client Scopes 설정 (공통)

그룹 기반 권한 관리를 위해 `groups` 스코프를 생성합니다.

1. Keycloak 관리 콘솔 → Realm 선택 → **Client scopes** → **Create client scope**
   - Name: `groups` / Type: `Default` / Include in token scope: ON
2. 생성된 스코프 → **Mappers** → **Configure a new mapper** → **Group Membership**
   - Name: `groups` / Token Claim Name: `groups` / Full group path: OFF

### 6.2 각 클라이언트 생성

| Client ID | Root/Home URL | Valid Redirect URIs | Web Origins |
|-----------|----------|---------------------|-------------|
| `argocd` | `https://argocd.cnapcloud.com` | `/auth/callback` | `https://argocd.cnapcloud.com` |
| `jenkins` | `https://jenkins.cnapcloud.com` | `/securityRealm/finishLogin` | `https://jenkins.cnapcloud.com` |
| `harbor` | `https://harbor.cnapcloud.com` | `/c/oidc/callback` | `https://harbor.cnapcloud.com` |
| `oauth2-proxy` | `https://oauth2-proxy.cnapcloud.com` | `/oauth2/callback` | `https://oauth2-proxy.cnapcloud.com` |
| `grafana` | `https://grafana.cnapcloud.com` | `/login/generic_oauth` | `https://grafana.cnapcloud.com` |

> **Kong**: 별도 Keycloak 클라이언트를 만들지 않습니다. Kong Manager/Admin API는 자체 OIDC 클라이언트 대신 `oauth2-proxy`로 보호됩니다([kong.md](auth-routing/kong.md)).

**생성 절차 (각 클라이언트 반복):**

1. **General settings**: Client Type `OpenID Connect`, Client ID 입력
2. **Capability config**: Client authentication `ON`, Standard flow ✓, Direct access grants ✓
3. **Login settings**: Root URL 입력, Valid redirect URIs는 위 표의 정확한 콜백 경로만 등록(와일드카드 금지), Valid post logout redirect URIs `+`, Web origins 입력
4. **Credentials** 탭 → Client secret 복사 → 해당 모듈 `values.yaml`에 설정

---

## 7. 참고 자료

- [Kustomize](https://kustomize.io/)
- [Helm](https://helm.sh/)
- [ArgoCD](https://argo-cd.readthedocs.io/)
- [cert-manager](https://cert-manager.io/)
- [ECK](https://www.elastic.co/guide/en/cloud-on-k8s/current/index.html)
- [Harbor](https://goharbor.io/)
- [Ingress-Nginx](https://kubernetes.github.io/ingress-nginx/)
- [Jenkins](https://www.jenkins.io/)
- [Kong Gateway](https://docs.konghq.com/)
- [Keycloak](https://www.keycloak.org/)
- [MinIO](https://min.io/)
- [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
- [Prometheus](https://prometheus.io/)
- [Redis](https://redis.io/)
- [Reflector](https://github.com/emberstack/kubernetes-reflector)
- [Kind](https://kind.sigs.k8s.io/)
