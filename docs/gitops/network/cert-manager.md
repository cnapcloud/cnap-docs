---
title: "cert-manager"
sidebar_position: 3
---

Kubernetes에서 TLS 인증서 발급·갱신을 자동화하는 컨트롤러입니다.

- **버전**: v1.19.2
- **Helm Chart 버전**: v1.19.2
- **네임스페이스**: `security`
- **의존성**: [Reflector](reflector.md)

---

## 1. 개요

cert-manager는 ClusterIssuer를 통해 인증서 발급 방식을 정의하고, Certificate 리소스로 실제 TLS Secret을 발급합니다. 이 환경에서는 아래 세 가지 ClusterIssuer를 구성합니다.

| ClusterIssuer | 방식 | 용도 |
|---|---|---|
| `selfsigned-issuer` | CA 서명 (`ca.crt` / `ca.key`) | Kind 내부 도메인 (`nginx.kind.internal` 등) |
| `letsencrypt-dev` | HTTP-01 Staging | 단일 도메인 테스트 (브라우저 미신뢰) |
| `letsencrypt-cloudflare` | DNS-01 Production | `*.cnapcloud.com` 와일드카드 (권장) |

Reflector와 연계하여 `security` 네임스페이스의 TLS Secret을 `cicd`, `gateway`, `database` 등 여러 네임스페이스에 자동 복제합니다.

---

## 2. 사전 요구사항

- **도구**: `kubectl`, `kustomize`, `helm`, `sops`
- **Reflector**: 설치 완료 ([reflector](reflector.md))
- **Cloudflare**: DNS API Token — `cnapcloud.com` Zone에 대한 DNS 편집 권한

> **Cloudflare를 사용하지 않는 경우**: `kustomize/base/resources/cloudflare-letsencrypt.yaml`, `cloudflare-sops-secrets.yaml`, `kustomize/overlays/dev/resources/cnapcloud-certificate.yaml`을 제거하고, 다른 방식으로 와일드카드 인증서를 발급하여 Reflector로 공유하는 구성을 직접 설정합니다.

---

## 3. 디렉터리 구조

```
cert-manager/
├── Makefile
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml                        # ClusterIssuer + CA Secret 구성
    │   ├── helm/
    │   │   ├── cert-manager/                         # make pull 로 다운로드하는 Helm Chart
    │   │   └── values.yaml                           # Helm 렌더링 파라미터 (Prometheus, 리소스)
    │   ├── resources/
    │   │   ├── selfsigned-issuer.yaml                # ClusterIssuer: selfsigned-issuer
    │   │   ├── nginx-letsencrypt-dev.yaml            # ClusterIssuer: letsencrypt-dev (HTTP-01)
    │   │   ├── cloudflare-letsencrypt.yaml           # ClusterIssuer: letsencrypt-cloudflare (DNS-01)
    │   │   ├── cloudflare-sops-secrets.yaml          # SopsSecretGenerator: cloudflare-api-token
    │   │   └── cert/                                 # make root_ca 결과물 (CA 키·인증서)
    │   │       ├── ca.crt
    │   │       └── ca.key
    │   └── secrets/
    │       └── sops/
    │           └── cloudflare-api-token.enc.env      # SOPS 암호화된 Cloudflare API Token
    └── overlays/
        └── dev/
            ├── kustomization.yaml                    # 네임스페이스: security
            └── resources/
                ├── cnapcloud-certificate.yaml        # Certificate: *.cnapcloud.com
                └── nginx-certificate.yaml            # Certificate: nginx.kind.internal
```

---

## 4. 사전 설정

### 4.1 Self-signed Root CA 생성

`selfsigned-issuer`가 내부 도메인 인증서 서명에 사용할 Root CA를 생성합니다.

```bash
make root_ca
```

`kustomize/base/resources/cert/ca.crt`, `ca.key`가 생성됩니다. `kustomization.yaml`의 `secretGenerator`가 이를 `selfsigned-root-ca-secret`으로 패키징합니다.


### 4.2 Cloudflare API Token SOPS 암호화

**Step 1**: Cloudflare Dashboard에서 API Token 생성
- My Profile → API Tokens → Create Token
- Template: "Edit zone DNS" 선택
- Zone Resources: `cnapcloud.com` 지정

**Step 2**: SOPS 암호화

```bash
# 임시 파일 작성
echo "api-token=<Cloudflare API Token>" > cloudflare-api-token.env

# SOPS 암호화 후 원본 삭제
sops -e --output kustomize/base/secrets/sops/cloudflare-api-token.enc.env cloudflare-api-token.env
rm cloudflare-api-token.env
```

### 4.3 ClusterIssuer 리소스 확인

`kustomize/base/resources/` 에 세 가지 ClusterIssuer가 정의되어 있습니다. 각 파일의 역할을 확인하고 환경에 맞게 조정합니다.

#### selfsigned-issuer.yaml

`selfsigned-issuer` — Root CA(`selfsigned-root-ca-secret`)로 서명하는 내부 전용 Issuer입니다.

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  ca:
    secretName: selfsigned-root-ca-secret
```

- Kind 내부 도메인(`nginx.kind.internal` 등) 인증서 서명에 사용
- 브라우저에서 신뢰하지 않음 — 내부 서비스 전용

#### nginx-letsencrypt-dev.yaml

`letsencrypt-dev` — Let's Encrypt **Staging** 서버를 HTTP-01 방식으로 사용합니다.

```yaml
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
```

- HTTP-01: Let's Encrypt가 `http://도메인/.well-known/...` 경로로 소유권 확인
- **제한**: 공개 접근 가능한 도메인만 가능, 와일드카드 불가
- Rate Limit 없음 — 설정 테스트용

#### cloudflare-letsencrypt.yaml

`letsencrypt-cloudflare` — Let's Encrypt **Production** 서버를 Cloudflare DNS-01 방식으로 사용합니다. **권장.**

```yaml
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
```

- DNS-01: `_acme-challenge.<도메인>` TXT 레코드로 소유권 확인
- 내부망 가능, 와일드카드(`*.cnapcloud.com`) 발급 가능

> **Cloudflare를 사용하지 않는 경우**: `cloudflare-letsencrypt.yaml`, `cloudflare-sops-secrets.yaml`, `overlays/dev/resources/cnapcloud-certificate.yaml` 세 파일을 제거합니다. 이 GitOps 환경의 모든 모듈은 와일드카드 인증서를 공유하므로, 다른 방식으로 발급한 인증서를 Reflector로 공유하는 구성을 직접 설정해야 합니다.

### 4.4 dev overlay Certificate 리소스

`kustomize/overlays/dev/resources/` 에 dev 환경에서 실제 발급할 Certificate 리소스가 정의되어 있습니다.

#### cnapcloud-certificate.yaml

`*.cnapcloud.com` 와일드카드 인증서를 발급하고, `secretTemplate`의 Reflector annotation으로 여러 네임스페이스에 자동 복제합니다.

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: cnapcloud-com
  namespace: security
spec:
  secretName: cnapcloud.com-tls
  secretTemplate:
    annotations:
      reflector.v1.k8s.emberstack.com/reflection-allowed: "true"
      reflector.v1.k8s.emberstack.com/reflection-auto-enabled: "true"
      reflector.v1.k8s.emberstack.com/reflection-allowed-namespaces: "dashboard,security,cicd,default,gateway,database,lma,storage,demo"
  issuerRef:
    name: letsencrypt-cloudflare
    kind: ClusterIssuer
  dnsNames:
    - "*.cnapcloud.com"
```

- `secretName: cnapcloud.com-tls` — 발급된 TLS Secret 이름
- `reflection-auto-enabled: "true"` — 원본 Secret 생성·갱신 시 복제본도 자동 업데이트
- `reflection-allowed-namespaces` — 복제 대상 네임스페이스 목록. 새 네임스페이스가 추가되면 이 목록에 추가합니다
  - `security` (원본), `gateway` (Ingress/Kong), `cicd` (Jenkins), `database` (PostgreSQL/Redis), `lma` (Prometheus/OpenSearch), `storage` (MinIO), `dashboard`, `default`, `demo`

#### nginx-certificate.yaml

`nginx.kind.internal` 도메인용 자체 서명 인증서입니다. Kind 클러스터 내부에서 nginx Ingress에 TLS를 적용할 때 사용합니다.

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: nginx.kind.internal-tls
  namespace: security
spec:
  secretName: nginx.kind.internal-tls
  duration: 87600h     # 10년
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer
  dnsNames:
    - nginx.kind.internal
```

- `duration: 87600h` — 10년 유효기간. 내부 전용이므로 갱신 주기를 길게 설정
- `selfsigned-issuer` 사용 — 4.1에서 생성한 Root CA로 서명

---

## 5. 배포

### 5.1 패키지 준비

```bash
make pull
```

### 5.2 배포 설정

#### helm/values.yaml

`kustomize/base/helm/values.yaml` — `make apply-helm` 시 Helm 렌더링에 사용합니다. Prometheus ServiceMonitor를 활성화하고 dev 환경 리소스 제한을 설정합니다.

```yaml
# kustomize/base/helm/values.yaml
replicaCount: 2

prometheus:
  enabled: true
  servicemonitor:
    enabled: true
    namespace: security
    labels:
      prometheus: main

# dev 환경 리소스 설정
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 200m
    memory: 256Mi

webhook:
  resources:
    requests:
      cpu: 20m
      memory: 32Mi
    limits:
      cpu: 100m
      memory: 128Mi

cainjector:
  resources:
    requests:
      cpu: 20m
      memory: 64Mi
    limits:
      cpu: 100m
      memory: 256Mi
```

### 5.3 배포 실행

cert-manager는 Webhook 초기화 순서 문제로 **두 단계로 나누어** 배포합니다.

**Step 1**: cert-manager 설치 (Helm)

```bash
make apply-helm
```

cert-manager Pod가 모두 Ready 상태가 될 때까지 대기합니다.

```bash
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/instance=cert-manager \
  -n security --timeout=120s
```

**Step 2**: ClusterIssuer 및 Certificate 배포

```bash
make preview  # 적용 전 매니페스트 확인
make apply
```

**주의**  
Step 2는 cert-manager Webhook이 Ready 상태인 후에만 실행합니다. Webhook 준비 전 ClusterIssuer를 적용하면 validation 오류가 발생합니다.

---

## 6. 설치 후 검증

### 6.1 ClusterIssuer Ready 확인

```bash
kubectl get clusterissuer
```

예상 결과:

```
NAME                      READY   AGE
letsencrypt-cloudflare    True    <n>m
letsencrypt-dev           True    <n>m
selfsigned-issuer         True    <n>m
```

세 개 모두 `READY: True`이면 정상입니다.

### 6.2 Certificate 발급 확인

```bash
kubectl get certificate -n security
```

예상 결과:

```
NAME                      READY   SECRET                    AGE
cnapcloud-com             True    cnapcloud.com-tls         <n>m
nginx.kind.internal-tls   True    nginx.kind.internal-tls   <n>m
```

`READY: True`가 되기까지 DNS-01 챌린지 완료에 수 분이 걸릴 수 있습니다.

### 6.3 Secret Reflector 복제 확인

```bash
kubectl get secret cnapcloud.com-tls -n gateway
kubectl get secret cnapcloud.com-tls -n cicd
```

지정된 네임스페이스에 Secret이 복제되면 정상입니다.

---

## 7. 운영

### 7.1 Staging → Production 전환

최초 구성 시 Staging 서버로 테스트한 뒤 Production으로 전환합니다.

| 환경 | ACME 서버 | 특징 |
|---|---|---|
| Staging | `https://acme-staging-v02.api.letsencrypt.org/directory` | Rate Limit 없음, 브라우저 미신뢰 |
| Production | `https://acme-v02.api.letsencrypt.org/directory` | Rate Limit 엄격 (동일 도메인 주당 5개) |

전환 절차:

1. `kustomize/base/resources/cloudflare-letsencrypt.yaml`의 `server` URL을 Production으로 변경
2. 기존 인증서 Secret 삭제 (강제 재발급)

```bash
kubectl delete secret cnapcloud.com-tls -n security
make apply
```

> **주의**: Production에서 발급 실패를 반복하면 계정 전체가 일시 제한됩니다. Staging에서 `Certificate READY: True`를 확인한 뒤 전환하세요.

### 7.2 Cloudflare API Token 교체

```bash
# 새 토큰으로 enc.env 재생성
sops -e --output kustomize/base/secrets/sops/cloudflare-api-token.enc.env cloudflare-api-token.env
rm cloudflare-api-token.env

# Secret 재적용
make apply
```

---

## 8. Troubleshooting

### 8.1 Certificate Pending — DNS-01 Challenge 실패

```bash
kubectl get challenges -n security
kubectl describe challenge <challenge-name> -n security
```

**원인 1**: `cloudflare-api-token` Secret 누락 또는 Token 권한 부족.

```bash
kubectl get secret cloudflare-api-token -n security
dig TXT _acme-challenge.cnapcloud.com
```

**원인 2**: Kind 환경에서 CoreDNS SOA 조회 실패.

cert-manager DNS-01은 SOA 레코드 조회가 필수입니다. Kind의 기본 CoreDNS는 SOA 질의를 처리하지 못해 `SERVFAIL`이 발생합니다. CoreDNS를 Cloudflare DNS로 직접 forward하도록 수정합니다.

```bash
kubectl edit configmap coredns -n kube-system
```

`forward . /etc/resolv.conf` 를 아래로 교체:

```
forward . 1.1.1.1 1.0.0.1 {
    max_concurrent 1000
}
```

```bash
kubectl rollout restart deployment coredns -n kube-system
```

### 8.2 Webhook CA 인증서 갱신 오류

**증상**:

```
Internal error occurred: failed calling webhook "webhook.cert-manager.io"
```

**원인**: cainjector가 webhook CA 인증서를 제때 갱신하지 못함.

**해결**:

```bash
kubectl delete secret cert-manager-webhook-ca -n security
make apply-helm
```

### 8.3 Reflector 복제본 누락

대상 네임스페이스의 Secret이 수동 삭제된 경우 Reflector가 자동으로 재생성하지 않습니다. 원본 Secret에 변경 이벤트를 발생시켜 재복제를 유도합니다.

```bash
kubectl annotate secret cnapcloud.com-tls -n security \
  reflector.v1.k8s.emberstack.com/force-refresh="$(date +%s)" --overwrite
```

```bash
kubectl get secret cnapcloud.com-tls -n gateway
```

---

## 부록. 체크리스트

**설치 전:**
- [ ] Reflector 설치 완료
- [ ] `make root_ca` 실행 (Self-signed Root CA 생성)
- [ ] Cloudflare API Token 생성 및 SOPS 암호화 완료

**배포:**
- [ ] `make pull` 실행
- [ ] `kustomize/base/helm/values.yaml` 리소스 설정 확인
- [ ] `make apply-helm` 실행
- [ ] cert-manager Pod Ready 확인
- [ ] `make preview` 확인 후 `make apply` 실행

**검증:**
- [ ] 3개 ClusterIssuer `READY: True` 확인
- [ ] Certificate `READY: True` 확인
- [ ] Secret Reflector 복제 확인 (`cicd`, `gateway` 등)
- [ ] Staging 테스트 완료 후 Production 전환

---

## 참고 자료

- [cert-manager 공식 문서](https://cert-manager.io/docs/)
- [Let's Encrypt Rate Limits](https://letsencrypt.org/docs/rate-limits/)
- [Cloudflare API Tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
