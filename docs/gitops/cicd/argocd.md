---
title: "ArgoCD"
sidebar_position: 3
---

GitOps 방식으로 Kubernetes 클러스터의 애플리케이션 배포 상태를 선언적으로 관리하는 CD 도구입니다.

- **버전**: v2.12.2 (Helm Chart 7.4.5)
- **네임스페이스**: cicd
- **접속 URL**: https://argocd.cnapcloud.com
- **의존성**: cert-manager, reflector, Keycloak, SOPS(GPG)

---

## 1. 개요

ArgoCD는 `argocd/` 디렉터리 기반으로 Kustomize + Helm으로 배포됩니다. `apps/` 디렉터리의 Application YAML로 클러스터 내 모듈들을 GitOps로 관리하며, SOPS로 암호화된 시크릿을 repo-server가 GPG 키로 복호화하여 배포에 활용합니다. Keycloak OIDC SSO와 RBAC 권한 관리를 제공합니다.

---

## 2. 사전 요구사항

- **cert-manager**: TLS 인증서 발급 ([cert-manager](../network/cert-manager.md))
- **reflector**: TLS 인증서 네임스페이스 간 복제 ([reflector](../network/reflector.md))
- **Keycloak**: OIDC SSO 인증 ([keycloak](../auth-routing/keycloak.md))
- **sops**: SOPS 암호화 CLI
- **DNS**: `argocd.cnapcloud.com` 등록 완료

---

## 3. 디렉터리 구조

```
argocd/
├── Makefile                                      # apply, delete, preview, pull 배포 자동화
├── apps/                                         # ArgoCD Application YAML 파일
│   ├── app-project.yaml                          # AppProject 정의
│   ├── cert-manager.yaml
│   ├── harbor.yaml
│   └── ...                                       # 모듈별 Application 파일
└── kustomize/
    ├── base/
    │   ├── configmap/
    │   │   └── .gpg/                             # GPG 키 (gitignore, SOPS 복호화용)
    │   │       ├── private-master.asc
    │   │       └── public-master.asc
    │   ├── helm/argo-cd/                         # Helm Chart 원본
    │   ├── resources/
    │   │   ├── servicemonitor.yaml               # Prometheus ServiceMonitor
    │   │   └── sops-secrets.yaml                 # SOPS Secret 리소스
    │   ├── secrets/sops/
    │   │   └── github-credentials.enc.env        # SOPS 암호화된 GitHub 자격증명
    │   └── kustomization.yaml
    └── overlays/dev/
        ├── helm/
        │   ├── values.yaml                       # dev 환경 ArgoCD 설정 (도메인, OIDC, RBAC)
        │   └── helm-chart.yaml                   # HelmChartInflationGenerator 설정
        ├── patches/
        │   └── add-host-alias.yaml               # Keycloak hairpin 방지 hostAlias 패치
        └── kustomization.yaml
```

---

## 4. 사전 설정

### 4.1 Keycloak Client 생성

Keycloak 관리 콘솔에서 `cnap` Realm에 ArgoCD OIDC Client를 생성합니다.

| 항목 | 값 |
|------|-----|
| Client ID | `argocd` |
| Client type | OpenID Connect |
| Client authentication | On |
| Standard flow | On |
| Valid redirect URIs | `https://argocd.cnapcloud.com/auth/callback` |
| Valid post logout redirect URIs | `https://argocd.cnapcloud.com/` |
| Web origins | `https://argocd.cnapcloud.com` |

Client 생성 후 **Credentials** 탭에서 Client Secret을 확인하고 `values.yaml`의 OIDC 설정에 기록합니다.

**주의**: `clientSecret`은 민감 정보이므로 평문으로 Git에 커밋하지 않습니다. SOPS로 암호화하여 관리합니다.

### 4.2 Keycloak Groups 설정

ArgoCD RBAC 권한 매핑에 사용할 그룹을 Keycloak에 생성하고, groups claim mapper를 추가합니다.

**Client > Client Scopes > 전용 스코프 추가**

| 항목 | 값 |
|------|-----|
| Mapper type | Group Membership |
| Token Claim Name | `groups` |
| Add to ID token | On |
| Add to access token | On |
| Add to userinfo | On |
| Full group path | Off |

**Groups 생성 (Keycloak 관리 콘솔 > Groups)**

| 그룹명 | ArgoCD 역할 |
|--------|------------|
| `admin` | admin |
| `viewer` | readonly |

### 4.3 GPG 키 생성 (SOPS용)

ArgoCD repo-server가 SOPS 암호화 시크릿을 복호화하려면 GPG 키가 필요합니다. GPG 키는 `.gitignore`로 관리되며 Git에 커밋하지 않습니다.

**Step 1: GPG 키 생성 및 내보내기**

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

gpg --export-secret-keys > kustomize/base/configmap/.gpg/private-master.asc
gpg --export > kustomize/base/configmap/.gpg/public-master.asc
```

**Step 2: Fingerprint 확인 및 `.sops.yaml` 설정**

```bash
gpg --list-keys --keyid-format long
# pub   rsa4096/6A08**********0E7D 2024-08-26 [SCEA]
#       9A7968E2B********************30CE0E7D   <-- Fingerprint (40자리)
```

```yaml
# .sops.yaml (프로젝트 루트)
creation_rules:
  - path_regex: .*\.enc\.(yaml|yml|env)$
    pgp: <GPG_FINGERPRINT>
```

**다른 환경에서 키 import 시**

```bash
gpg --import kustomize/base/configmap/.gpg/public-master.asc
gpg --import kustomize/base/configmap/.gpg/private-master.asc
```

**주의**: `.gpg/` 폴더는 `.gitignore`에 등록되어 있습니다. 키 파일은 별도 안전한 저장소에 보관합니다.

### 4.4 GitHub Credentials 설정 (선택)

Private GitHub 저장소를 ArgoCD로 관리하는 경우 GitHub Personal Access Token을 SOPS로 암호화하여 저장합니다.

```bash
# github-credentials.env 작성
cat > github-credentials.env <<EOF
GITHUB_TOKEN=<GitHub Personal Access Token>
EOF

# SOPS 암호화 후 원본 삭제
sops -e --output kustomize/base/secrets/sops/github-credentials.enc.env github-credentials.env
rm github-credentials.env
```

### 4.5 hostAlias 설정 (hairpin 이슈 대응)

ArgoCD repo-server가 내부에서 Keycloak에 접근할 때 Ingress를 거쳐 자신에게 돌아오는 hairpin 순환이 발생할 수 있습니다. `patches/add-host-alias.yaml`은 Pod의 `/etc/hosts`에 Keycloak 도메인을 Ingress Service ClusterIP로 직접 매핑하여 이를 방지합니다.

```yaml
# overlays/dev/patches/add-host-alias.yaml
- op: add
  path: /spec/template/spec/hostAliases
  value:
    - ip: "10.96.224.39"  # ingress-nginx Service ClusterIP
      hostnames:
        - "keycloak.cnapcloud.com"
```

실제 IP는 배포 환경의 ingress-nginx Service ClusterIP로 수정합니다.

```bash
kubectl get svc -n ingress-nginx
```

CNI 플러그인(Calico, Cilium 등)이 hairpin 모드를 지원하는 환경에서는 이 패치 없이도 정상 동작합니다.

---

## 5. 배포

### 5.1 Namespace 생성

```bash
kubectl create namespace cicd || true
```

### 5.2 Helm Chart 준비

```bash
make pull
```

### 5.3 배포 설정

`kustomize/overlays/dev/helm/values.yaml`에서 환경에 맞게 수정이 필요한 항목입니다.

#### 5.3.1 Ingress 설정

ArgoCD server는 `--insecure` 모드로 동작하고, TLS는 ingress-nginx의 ssl-passthrough로 처리합니다.

```yaml
server:
  extraArgs:
  - --insecure
  ingress:
    enabled: true
    ingressClassName: nginx
    tls: false
    annotations:
      nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
      nginx.ingress.kubernetes.io/ssl-passthrough: "true"
    extraTls:
    - hosts:
      - argocd.cnapcloud.com
      secretName: cnapcloud.com-tls
```

#### 5.3.2 Keycloak OIDC 설정

```yaml
configs:
  cm:
    oidc.config: |
      name: keycloak
      issuer: https://keycloak.cnapcloud.com/realms/cnap
      clientID: argocd
      clientSecret: <4.1에서 발급한 Client Secret>
      requestedScopes: ["openid", "profile", "email", "groups"]
      logoutURL: https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/logout?client_id=argocd&id_token_hint={{token}}&post_logout_redirect_uri=https://argocd.cnapcloud.com/
```

**주의**: `clientSecret`은 평문으로 Git에 커밋하지 않습니다. SOPS로 암호화하여 관리합니다.

#### 5.3.3 RBAC 설정

Keycloak groups claim 값을 ArgoCD 역할에 매핑합니다. 커스텀 역할(editor, viewer, demo)의 권한은 `policy.csv`에 직접 정의합니다.

```yaml
configs:
  rbac:
    policy.csv: |
      g, admin, role:admin
      g, editor, role:editor
      g, viewer, role:viewer
      g, demo, role:demo

      p, role:editor, applications, create, */*, allow
      p, role:editor, applications, get, */*, allow
      p, role:editor, applications, update, */*, allow
      p, role:editor, applications, delete, */*, allow

      p, role:viewer, applications, get, */*, allow
      p, role:viewer, clusters, get, *, allow
      p, role:viewer, repositories, get, *, allow
      p, role:viewer, logs, get, *, allow

      p, role:demo, applications, *, demo/*, allow
      p, role:demo, exec, create, demo/*, allow
```

#### 5.3.4 Admin 계정 설정

admin 계정 비밀번호는 bcrypt 해시값으로 설정합니다.

```bash
htpasswd -nbBC 10 "" <비밀번호> | tr -d ':\n' | sed 's/$2y/$2a/'
```

```yaml
configs:
  secret:
    argocdServerAdminPassword: "<위 명령 출력값>"
  cm:
    admin.enabled: true
    accounts.admin: apiKey, login
```

#### 5.3.5 리소스 설정

```yaml
controller:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 250m
      memory: 256Mi

server:
  resources:
    limits:
      cpu: 100m
      memory: 128Mi
    requests:
      cpu: 50m
      memory: 64Mi

repoServer:
  resources:
    limits:
      cpu: 50m
      memory: 128Mi
    requests:
      cpu: 10m
      memory: 64Mi

applicationSet:
  resources:
    limits:
      cpu: 100m
      memory: 128Mi
    requests:
      cpu: 100m
      memory: 128Mi
```

**참고**: `controller`만 현재 `values.yaml`에 설정되어 있습니다. `server`, `repoServer`, `applicationSet`은 Helm Chart 기본값(주석 예시)입니다.

### 5.4 배포 실행

```bash
make preview DEPLOY_ENV=dev
make apply DEPLOY_ENV=dev
```

---

## 6. 설치 후 검증

### 6.1 웹 UI 접속

- URL: https://argocd.cnapcloud.com
- 로그인:
  - Keycloak OIDC: "LOGIN VIA KEYCLOAK" 버튼 클릭
  - 또는 초기 admin 계정 (username: admin, password: values.yaml에서 설정)

### 6.2 Keycloak OIDC 연동 확인

1. ArgoCD UI에서 "LOGIN VIA KEYCLOAK" 클릭
2. Keycloak 로그인 페이지 리다이렉트 확인
3. 사용자 로그인 후 ArgoCD로 리다이렉트 및 RBAC 권한 적용 확인

### 6.3 초기 Admin 비밀번호 확인 (OIDC 미사용 시)

```bash
kubectl get secret argocd-initial-admin-secret -n cicd -o jsonpath="{.data.password}" | base64 -d
```

---

## 7. 운영

### 7.1 AppProject 배포

ArgoCD에서 Application을 배포하기 전에 먼저 AppProject를 생성해야 합니다.

```bash
kubectl apply -f apps/app-project.yaml -n cicd
```

`app-project.yaml` 주요 내용:
- `database`, `backend`, `frontend` 등 여러 AppProject 정의
- 각 프로젝트별 클러스터/네임스페이스/저장소 접근 권한 정의
- Application 배포 시 프로젝트 선택 필수

AppProject 상태 확인:

```bash
kubectl get appproject -n cicd
kubectl describe appproject database -n cicd
```

### 7.2 Application 배포

AppProject 생성 후, 실제 애플리케이션을 배포합니다.

```bash
kubectl apply -f apps/msa-demo.yaml -n cicd
```

Application 상태 확인:

```bash
kubectl get application -n cicd
argocd app list
argocd app info msa-demo
```

### 7.3 Sync 수행

ArgoCD에서 애플리케이션을 동기화하는 방법에는 수동 sync와 자동 sync가 있습니다.

#### 7.3.1 수동 Sync

수동으로 애플리케이션을 즉시 동기화할 수 있습니다.

**CLI를 통한 수동 Sync**

```bash
# 기본 수동 sync
argocd app sync msa-demo

# 강제 sync (기존 리소스 무시)
argocd app sync msa-demo --force

# Prune 옵션 (Git에 없는 리소스 삭제)
argocd app sync msa-demo --prune

# Dry-run (실제 적용 없이 미리보기)
argocd app sync msa-demo --dry-run
```

**웹 UI를 통한 수동 Sync**
1. ArgoCD 웹 UI 접속 (https://argocd.cnapcloud.com)
2. 대상 애플리케이션 선택
3. **SYNC** 버튼 클릭
4. 옵션 선택:
   - **Force**: 기존 리소스 무시
   - **Prune**: 불필요한 리소스 삭제
5. **SYNCHRONIZE** 클릭

#### 7.3.2 자동 Sync

ArgoCD는 Git 변경을 감지하여 자동으로 애플리케이션을 동기화할 수 있습니다.

**기본 동작**
- Git 리포지토리 폴링 주기: 3분 (180초)
- 변경 감지 → 상태 계산 → auto-sync 실행
- Git 커밋 후 1~3분 내 자동 sync (정상 동작)

**자동 Sync 지연 문제 해결**
- **현재 설정 확인**:
  ```bash
  kubectl -n cicd get configmap argocd-cm -o yaml
  ```
- **폴링 주기 줄이기 (예: 30초)**:
  ```yaml
  data:
    timeout.reconciliation: 30s
  ```
- **적용**:
  ```bash
  kubectl -n cicd rollout restart deployment argocd-application-controller
  ```

**주의**: 너무 짧게 설정하면 Git 서버 부하가 증가합니다.

### 7.4 API Token 발행

로컬 사용자 admin에 대한 API Token을 발행합니다.

```bash
kubectl -n cicd exec -it <argocd-server-pod> -- bash
argocd login localhost:8080 --username admin --password <admin-password>
argocd account generate-token --account admin --expires-in 720h
```

---

## 8. Troubleshooting

### 8.1 Keycloak OIDC 로그인 실패

```bash
# 1. oidc.config 설정 확인
kubectl get cm argocd-cm -n cicd -o yaml | grep oidc.config

# 2. argocd-server 로그 확인
kubectl logs -n cicd <argocd-server-pod> | grep oidc

# 3. DNS 해석 확인
kubectl exec -it <argocd-server-pod> -n cicd -- nslookup keycloak.cnapcloud.com
```

### 8.2 SOPS 시크릿 복호화 오류

```bash
export SOPS_PGP_FP=<PGP fingerprint>
sops -d kustomize/base/secrets/sops/github-credentials.enc.env
```

### 8.3 Ingress 접속 불가

```bash
# Ingress 상태 확인
kubectl get ingress -n cicd -o wide
kubectl describe ingress argocd-server-ingress -n cicd

# TLS 인증서 확인
kubectl get secret cnapcloud.com-tls -n cicd -o jsonpath="{.data.tls\.crt}" | base64 -d | openssl x509 -noout -dates
```

### 8.4 admin 패스워드 분실 시 재설정

admin 패스워드를 분실한 경우 bcrypt 해시를 새로 생성하여 Secret을 업데이트합니다.

```bash
argocd account bcrypt --password <원하는 패스워드>
```

출력된 해시값으로 `argocd-secret`을 패치합니다.

```bash
kubectl -n cicd patch secret argocd-secret \
  -p '{"stringData": {
    "admin.password": "<bcrypt 해시값>",
    "admin.passwordMtime": "'$(date +%FT%T%Z)'"
  }}'

kubectl -n cicd rollout restart deployment argocd-server
```

---

## 부록. 체크리스트

**사전 설정**
- [ ] Keycloak `argocd` Client 생성 완료 (redirect URI, Web origins 포함)
- [ ] Client Secret 확인 및 `values.yaml` 기록 완료
- [ ] groups claim mapper 추가 완료 (Token Claim Name: `groups`)
- [ ] `admin`, `viewer` 그룹 생성 완료
- [ ] GPG 키 생성 및 `kustomize/base/configmap/.gpg/` 저장 완료
- [ ] `.sops.yaml` Fingerprint 설정 완료
- [ ] `clientSecret` SOPS 암호화 완료 (평문 커밋 금지)
- [ ] GitHub Credentials SOPS 암호화 완료 (선택)
- [ ] `add-host-alias.yaml` ingress-nginx ClusterIP 확인 및 수정
- [ ] DNS `argocd.cnapcloud.com` 등록 완료

**배포**
- [ ] `kubectl create namespace cicd` 실행
- [ ] `make pull` 실행
- [ ] `make preview DEPLOY_ENV=dev` 확인
- [ ] `make apply DEPLOY_ENV=dev` 실행

**검증**
- [ ] https://argocd.cnapcloud.com 웹 UI 접속 확인
- [ ] "LOGIN VIA KEYCLOAK" 버튼 표시 확인
- [ ] Keycloak OIDC 로그인 후 RBAC 권한 적용 확인
- [ ] AppProject 배포 및 상태 확인 (`kubectl get appproject -n cicd`)
- [ ] Application sync 정상 동작 확인 (`argocd app list`)

---

## 9. 참고 자료

- [ArgoCD 공식 문서](https://argo-cd.readthedocs.io/)
- [ArgoCD Helm Chart](https://github.com/argoproj/argo-helm)
- [Keycloak OIDC 연동](https://argo-cd.readthedocs.io/en/stable/operator-manual/user-management/keycloak/)
- [ArgoCD RBAC](https://argo-cd.readthedocs.io/en/stable/operator-manual/rbac/)
- [Kustomize 문서](https://kubectl.docs.kubernetes.io/)

---
