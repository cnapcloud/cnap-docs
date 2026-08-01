---
title: "Kong Gateway"
sidebar_position: 3
---

Control Plane / Data Plane 분리 모드로 배포하는 고성능 API Gateway입니다.

- **버전**: `3.9.1` (이미지: `cnapcloud/kong-oidc:3.9.1`)
- **Helm Chart 버전**: `2.46.0` (kong/kong)
- **네임스페이스**: `gateway`
- **접속 URL**:
  - Kong Manager: `https://kong-manager.cnapcloud.com`
  - Admin API: `https://kong-admin.cnapcloud.com`
  - Proxy: `https://kong-proxy.cnapcloud.com`
- **의존성**: [CNPG Cluster](../data-platform/cnpg-cluster.md), [Redis HA](../data-platform/redis-ha.md), [oauth2-proxy](oauth2-proxy.md), [cert-manager](../network/cert-manager.md), [Reflector](../network/reflector.md)

---

## 1. 개요

Kong Gateway는 CP/DP Hybrid 모드로 배포됩니다. Control Plane은 PostgreSQL(`pg-cluster-rw.database.svc`)을 백엔드로 서비스·라우트·플러그인 설정을 저장하고, Data Plane은 DB 없이 CP로부터 설정을 수신해 실제 트래픽을 처리합니다. DP는 2 replica로 운영하며 세션을 Redis HA(`redis-ha-haproxy.database.svc`)에 저장합니다.

Admin API 및 Manager UI는 oauth2-proxy로 보호되며, `admin` 그룹 사용자만 쓰기 요청이 허용됩니다. `cnapcloud/kong-oidc` 커스텀 이미지에 `oidc`, `cookies-to-headers` 플러그인이 포함되어 있어 Keycloak OIDC 인증을 서비스 단위로 적용할 수 있습니다.

---

## 2. 사전 요구사항

- **CNPG Cluster**: `database` 네임스페이스에 배포 완료, `kong` DB 및 사용자 생성 완료 ([cnpg-cluster](../data-platform/cnpg-cluster.md))
- **Redis HA**: `database` 네임스페이스에 배포 완료 ([redis-ha](../data-platform/redis-ha.md))
- **oauth2-proxy**: `security` 네임스페이스에 배포 완료 ([oauth2-proxy](oauth2-proxy.md))
- **TLS 인증서**: `cnapcloud.com-tls` Secret이 `gateway` 네임스페이스에 복제되어 있어야 함 (reflector 설정 필요)
- **DNS 등록**:
  - `kong-manager.cnapcloud.com`
  - `kong-admin.cnapcloud.com`
  - `kong-proxy.cnapcloud.com`

---

## 3. 디렉터리 구조

```
kong/
├── Makefile
├── config/
│   └── kong.yaml                              # 서비스·라우트·플러그인 선언적 설정 스냅샷
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml                 # kong-cluster-tls Secret 생성
    │   └── tls/
    │       ├── ecparam.pem                    # EC 파라미터 (secp384r1)
    │       ├── kong-cluster-ca.crt            # CP-DP 클러스터 통신 TLS 인증서
    │       └── kong-cluster-ca.key            # CP-DP 클러스터 통신 TLS 키
    └── overlays/
        └── dev/
            ├── kustomization.yaml             # CP/DP 배포, 이미지 교체, 패치 정의
            ├── helm/
            │   ├── cp/
            │   │   ├── helm-chart.yaml        # CP HelmChartInflationGenerator
            │   │   └── values.yaml            # CP 설정 (Admin API, Manager UI, PostgreSQL)
            │   └── dp/
            │       ├── helm-chart.yaml        # DP HelmChartInflationGenerator
            │       └── values.yaml            # DP 설정 (Proxy, Redis 세션)
            ├── patches/
            │   ├── oauth2-proxy-api.yaml      # Admin API Ingress에 oauth2-proxy + 그룹 RBAC 패치
            │   └── oauth2-proxy-ui.yaml       # Manager UI Ingress에 oauth2-proxy 패치
            └── resources/
                ├── ingress-api.yaml           # kong-manager.cnapcloud.com/admin-api 경로 Ingress
                └── logger/                    # 테스트용 http-logger 서비스
```

| 파일 | 역할 | 주요 설정 |
|------|------|-----------|
| `overlays/dev/helm/cp/values.yaml` | Control Plane | Admin API, Manager UI, PostgreSQL 연결, 클러스터 TLS |
| `overlays/dev/helm/dp/values.yaml` | Data Plane | Proxy, Redis 세션 스토리지, CP 클러스터 연결 |

---

## 4. 사전 설정

### 4.1 PostgreSQL DB 준비

이 환경의 CNPG 클러스터는 initdb 스크립트(`cnpg/cluster/kustomize/overlays/dev/helm/values.yaml`)에 `kong` 사용자와 데이터베이스 생성이 포함되어 있으므로 **별도 작업 없이 skip 가능합니다.**

CNPG 클러스터를 새로 구성하는 경우에는 아래 SQL을 수동으로 실행합니다.

```bash
kubectl exec -it -n database pg-cluster-1 -- psql -U postgres
```

```sql
CREATE USER kong WITH PASSWORD '<pg-password>';
CREATE DATABASE kong OWNER kong;
GRANT ALL PRIVILEGES ON DATABASE kong TO kong;
\q
```

### 4.2 CP-DP 클러스터 TLS 인증서 생성

CP와 DP 간 통신에 사용할 자체 서명 EC 인증서를 생성합니다.

```bash
make create-tls
```

`kustomize/base/tls/` 하위에 `ecparam.pem`, `kong-cluster-ca.crt`, `kong-cluster-ca.key` 파일이 생성됩니다.

**주의**: TLS 키(`kong-cluster-ca.key`)가 Git에 커밋되어 있습니다. 운영 환경에서는 별도 보안 스토리지 관리를 권장합니다.

### 4.3 민감 정보 SOPS 암호화

아래 파일의 평문 값을 SOPS로 암호화합니다.

`kustomize/overlays/dev/helm/cp/values.yaml`:
- `customEnv.KONG_PG_PASSWORD`

`kustomize/overlays/dev/helm/dp/values.yaml`:
- `customEnv.KONG_X_SESSION_REDIS_PASSWORD`
- `customEnv.KONG_X_SESSION_SECRET`

---

## 5. 배포

### 5.1 Namespace 생성

```bash
make namespace
```

### 5.2 패키지 준비

```bash
make pull
```

Helm Chart `kong/kong 2.46.0`을 `kustomize/base/helm/kong/`에 다운로드합니다.

### 5.3 배포 설정

#### overlays/dev/helm/cp/values.yaml

CP Helm values — Admin API, Manager UI, PostgreSQL 연결, CP 역할을 정의합니다.

```yaml
# kustomize/overlays/dev/helm/cp/values.yaml
customEnv:
  KONG_PG_HOST: "pg-cluster-rw.database.svc"
  KONG_PG_USER: "kong"
  KONG_PG_PASSWORD: "<pg-password>"              # SOPS 암호화 필수
  KONG_PG_DATABASE: "kong"
  KONG_ADMIN_GUI_API_URL: "https://kong-manager.cnapcloud.com/admin-api"
  KONG_ADMIN_GUI_URL: "https://kong-manager.cnapcloud.com"
```

#### overlays/dev/helm/dp/values.yaml

DP Helm values — Proxy, Redis 세션 스토리지, CP 클러스터 연결을 정의합니다.

```yaml
# kustomize/overlays/dev/helm/dp/values.yaml
customEnv:
  KONG_X_SESSION_REDIS_HOST: "redis-ha-haproxy.database.svc"
  KONG_X_SESSION_REDIS_PASSWORD: "<redis-password>"   # SOPS 암호화 필수
  KONG_X_SESSION_SECRET: "<session-secret>"           # SOPS 암호화 필수
```

### 5.4 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

CP Pod 기동 시 PostgreSQL 스키마 마이그레이션 Job이 자동 실행됩니다. CP가 Ready 상태가 된 뒤 DP Pod가 CP에 연결됩니다.

---

## 6. 설치 후 검증

### 6.1 CP-DP 클러스터링 연결 확인

DP 로그에서 CP 연결 성공 메시지를 확인합니다.

```bash
kubectl logs -n gateway deployment/kong-dp -c proxy | grep -E "clustering|connected"
```

예상 결과:

```
[clustering] connected to control plane
```

### 6.2 Admin API 응답 확인

```bash
curl -sk https://kong-admin.cnapcloud.com/ | jq .version
```

예상 결과:

```
"3.9.1"
```

### 6.3 Kong Manager UI 접근 확인

브라우저에서 `https://kong-manager.cnapcloud.com`에 접속합니다. Keycloak 로그인 화면으로 리다이렉트되고, `admin` 그룹 계정으로 로그인 후 Manager 대시보드가 표시되어야 합니다.

### 6.4 Proxy 응답 헤더 확인

```bash
curl -sk -I https://kong-proxy.cnapcloud.com/
```

응답 헤더에 `Via: kong/3.9.1`이 포함되어 있어야 합니다.

---

## 7. 운영

### 7.1 Admin API 액세스 토큰 발급

Admin API는 oauth2-proxy로 보호되어 있어 Keycloak Bearer token이 필요합니다.

```bash
export ACCESS_TOKEN=$(curl -sk -X POST \
  "https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/token" \
  -d grant_type=password \
  -d client_id=oauth2-proxy \
  -d client_secret=raPfyUzdKoICeaELLIUXGpnqwtd0JrqN \
  -d username=<admin-user> \
  -d password=<admin-password> \
  -d scope='openid profile email' \
  | jq -r .access_token)
```

### 7.2 서비스·라우트·플러그인 등록

서비스 등록:

```bash
curl -sk -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -X POST https://kong-admin.cnapcloud.com/services \
  --data "name=<service-name>" \
  --data "url=http://<upstream-host>:<port>"
```

라우트 등록:

```bash
curl -sk -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -X POST https://kong-admin.cnapcloud.com/services/<service-name>/routes \
  --data "name=<route-name>" \
  --data "paths[]=/" \
  --data "hosts[]=<domain>"
```

OIDC 플러그인 추가:

```bash
curl -sk -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -X POST https://kong-admin.cnapcloud.com/services/<service-name>/plugins \
  -d name=oidc \
  -d config.client_id=<keycloak-client-id> \
  -d config.client_secret=<keycloak-client-secret> \
  -d config.discovery=https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration \
  -d config.logout_path=/logout \
  -d config.redirect_after_logout_uri=https://<domain> \
  | jq
```

### 7.3 설정 스냅샷 내보내기

현재 Kong 설정을 `config/kong.yaml`로 내보냅니다. DB 모드에서는 `/config` 엔드포인트가 지원되지 않으므로 `deck`을 사용합니다.

**deck 설치**

macOS:

```bash
brew install kong/deck/deck
```

Linux:

```bash
curl -sL https://github.com/Kong/deck/releases/latest/download/deck_linux_amd64.tar.gz \
  | tar -xz -C /usr/local/bin deck
```

**스냅샷 생성** 

```bash
deck gateway dump \
  --kong-addr https://kong-admin.cnapcloud.com \
  --headers "Authorization: Bearer ${ACCESS_TOKEN}" \
  --output-file kong/config/kong.yaml
```

**주의**: 내보낸 파일에 `client_secret` 등 민감 정보가 포함됩니다. Git 커밋 전 SOPS로 암호화하거나 민감 필드를 제거합니다.

---

## 8. Troubleshooting

### 8.1 CP Pod CrashLoopBackOff — PostgreSQL 연결 실패

**증상**: `kong-cp` Pod가 CrashLoopBackOff 상태

**원인**: DB 설정 오류 또는 CNPG 클러스터 미준비

**해결**:

```bash
kubectl logs -n gateway deployment/kong-cp -c proxy | grep -iE "database|postgres|error"
```

로그를 확인한 뒤 `cp/values.yaml`의 `KONG_PG_HOST`, `KONG_PG_USER`, `KONG_PG_PASSWORD`, `KONG_PG_DATABASE`를 교정하고 `make apply`를 재실행합니다.

### 8.2 DP가 CP에 연결 실패

**증상**: `kong-dp` 로그에 `failed to connect to control plane` 반복

**원인**: `kong-cluster-tls` Secret의 인증서 불일치 또는 CP 클러스터 포트(8005) 미노출

**해결**:

```bash
kubectl get svc -n gateway kong-cp-cluster
kubectl get secret -n gateway kong-cluster-tls -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -fingerprint
```

Secret 불일치 시 `make create-tls`로 인증서를 재생성하고 `make apply`를 재실행합니다.

### 8.3 Manager UI에서 Admin API 요청 실패 (CORS / 401)

**증상**: Manager UI 로그인 후 데이터 미로드 또는 401 반환

**원인**: `KONG_ADMIN_GUI_API_URL` 값이 실제 Admin API Ingress 경로(`/admin-api`)와 불일치

**해결**:

`cp/values.yaml`에서 아래 두 값이 일치하는지 확인합니다.

```yaml
KONG_ADMIN_GUI_API_URL: "https://kong-manager.cnapcloud.com/admin-api"
KONG_ADMIN_GUI_URL: "https://kong-manager.cnapcloud.com"
```

---

## 9. 업그레이드

Kong은 버전 간 DB 스키마 마이그레이션이 필요하므로 아래 순서를 따릅니다.

1. `cp/values.yaml`, `dp/values.yaml`의 이미지 tag와 Makefile의 Helm Chart 버전을 업데이트합니다.
2. `make pull`로 신규 Chart를 내려받습니다.
3. `make preview`로 변경 매니페스트를 확인합니다.
4. `make apply`를 실행합니다. CP 기동 시 migrations Job이 자동 실행되어 스키마를 업그레이드합니다.
5. CP가 Ready 상태가 된 뒤 DP rolling update가 진행됩니다.

**주의**: migrations Job 완료 전에 DP가 먼저 기동되면 스키마 불일치가 발생할 수 있습니다. 아래 명령으로 Job 완료를 확인합니다.

```bash
kubectl wait --for=condition=complete job \
  -l app.kubernetes.io/component=migrations \
  -n gateway --timeout=300s
```

---

## 10. 제거

```bash
make delete
```

Kong CRD는 Helm 삭제 후에도 클러스터에 잔류합니다. 완전 제거 시 수동으로 삭제합니다.

```bash
kubectl get crd | grep konghq.com | awk '{print $1}' | xargs kubectl delete crd
```

**주의**: CRD 삭제 시 클러스터 내 모든 Kong 커스텀 리소스(KongPlugin, KongIngress 등)가 함께 삭제됩니다.
