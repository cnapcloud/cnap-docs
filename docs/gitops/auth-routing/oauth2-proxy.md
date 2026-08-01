---
title: "OAuth2-Proxy"
sidebar_position: 2
---

Keycloak OIDC와 연동하여 Kubernetes Ingress에 인증 레이어를 제공하는 리버스 프록시입니다.

- **버전**: v7.11.0 (Helm Chart: oauth2-proxy 7.14.1)
- **네임스페이스**: security
- **접속 URL**: https://oauth2-proxy.cnapcloud.com
- **의존성**: [Keycloak](keycloak.md), [Redis HA](../data-platform/redis-ha.md), [cert-manager](../network/cert-manager.md), [Reflector](../network/reflector.md)

---

## 1. 개요

OAuth2-Proxy는 Nginx Ingress의 `auth-url` annotation과 연동하여 업스트림 서비스에 대한 인증 게이트웨이 역할을 합니다. 트래픽을 직접 프록시하지 않고(`upstreams = ["file:///dev/null"]`) 인증 여부만 판단하는 reverse proxy 모드로 동작합니다.

OIDC 프로바이더로 Keycloak(`keycloak.cnapcloud.com/realms/cnap`)을 사용하며, 브라우저 기반 인증(로그인 리다이렉트)과 API 기반 인증(Bearer token 검증)을 모두 지원합니다. 세션은 외부 Redis HA(`redis-ha-haproxy.database.svc`)에 저장합니다.

---

## 2. 사전 요구사항

- **Keycloak**: `cnap` realm에 `oauth2-proxy` client 생성 완료, client scopes에 `groups` 포함 ([keycloak](keycloak.md))
- **Redis HA**: `database` 네임스페이스에 배포 완료 ([redis-ha](../data-platform/redis-ha.md))
- **TLS 인증서**: `cnapcloud.com-tls` Secret이 `security` 네임스페이스에 복제되어 있어야 함 (reflector 설정 필요)
- **DNS 등록**:
  - `oauth2-proxy.cnapcloud.com`
  - `httpbin.cnapcloud.com`
  - `httpbin-api.cnapcloud.com`

---

## 3. 디렉터리 구조

```
oauth2-proxy/
├── Makefile                                # pull / preview / apply / delete 자동화
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── oauth2-proxy/               # Helm Chart v7.14.1 (make pull로 다운로드)
    └── overlays/
        └── dev/
            ├── kustomization.yaml          # namespace, generators, resources, images 지정
            ├── helm/
            │   ├── helm-chart.yaml         # HelmChartInflationGenerator 설정
            │   └── values.yaml             # OAuth2-Proxy 커스텀 값
            ├── patches/
            │   └── add-host-alias.yaml     # Keycloak DNS 해소용 hostAlias 패치 (선택)
            └── resources/
                └── httpbin/                # 인증 테스트용 httpbin 리소스
                    ├── deployment.yaml
                    ├── service.yaml
                    ├── serviceaccount.yaml
                    ├── ingress.yaml        # 브라우저 인증 테스트용 (auth-signin 포함)
                    └── ingress-api.yaml    # API 인증 테스트용 (Bearer token)
```

---

## 4. 사전 설정

### 4.1 Keycloak Client 설정

Keycloak Admin Console(`https://keycloak.cnapcloud.com`)에서 `cnap` realm에 아래 설정으로 Client를 생성합니다.

| 항목 | 값 |
|------|----|
| Client ID | `oauth2-proxy` |
| Client authentication | On |
| Root URL | `https://oauth2-proxy.cnapcloud.com` |
| Valid redirect URIs | `/oauth2/callback` |
| Client scopes | `openid`, `profile`, `email`, `groups` |

Client 생성 후 Credentials 탭에서 Client Secret을 확인합니다.

### 4.2 cookieSecret 생성

32바이트 랜덤 값을 생성합니다.

```bash
python3 -c 'import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

---

## 5. 배포

### 5.1 Namespace 생성

```bash
make namespace DEPLOY_ENV=dev
```

### 5.2 Helm Chart 다운로드

```bash
make pull DEPLOY_ENV=dev
```

`kustomize/base/helm/oauth2-proxy/` 디렉터리에 Chart v7.14.1이 다운로드됩니다.

### 5.3 배포 설정

#### values.yaml 주요 설정

`kustomize/overlays/dev/helm/values.yaml`의 핵심 항목을 환경에 맞게 수정합니다.

```yaml
config:
  clientID: "oauth2-proxy"
  clientSecret: "<keycloak-client-secret>"
  cookieSecret: "<32바이트-base64-인코딩값>"

  configFile: |-
    # 쿠키 설정
    cookie_domains=".cnapcloud.com"
    cookie_expire="0s"
    cookie_refresh="3m"
    cookie_secure=true
    whitelist_domains=[".cnapcloud.com"] # 로그인 후 되돌아갈 redirect 대상 도메인 제한
    email_domains=["<허용할 이메일 도메인, 예: your-company.com>"]   # ID 토큰 email 클레임 도메인 허용 목록

    # 세션 스토리지
    session_store_type="redis"

    # OIDC 프로바이더
    provider="oidc"
    provider_display_name="Keycloak"
    oidc_issuer_url="https://keycloak.cnapcloud.com/realms/cnap"
    redirect_url="https://oauth2-proxy.cnapcloud.com/oauth2/callback"
    backend_logout_url="https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/logout?client_id=oauth2-proxy&id_token_hint={id_token}"
    scope="openid profile email groups"

    # 리버스 프록시 모드 (트래픽 프록시 없이 인증만 처리)
    reverse_proxy=true
    upstreams=["file:///dev/null"]

    # 인증 헤더 전달
    set_xauthrequest=true
    set_authorization_header=true
    pass_access_token=true
    pass_authorization_header=true
    pass_user_headers=true

    # OIDC 클레임 매핑
    oidc_email_claim="email"
    oidc_groups_claim="groups"

    # Bearer token 검증 위임 (API 인증용)
    skip_jwt_bearer_tokens=true
    oidc_extra_audiences=["account"]

    # 인증 제외 경로 (헬스체크/상태 확인용만 허용, /actuator 전체 노출 금지)
    skip_auth_routes=["GET=^/api/token", "GET=.*/actuator/health$", "GET=^/status"]

sessionStorage:
  type: redis
  redis:
    password: "<redis-password>"
    clientType: standalone
    standalone:
      connectionUrl: redis://redis-ha-haproxy.database.svc

redis:
  enabled: false   # 외부 Redis HA 사용, 내장 Redis 비활성화
```

#### hostAlias 패치 (선택)

내부 Ingress Controller를 통해 Keycloak에 접근하는 경우 `patches/add-host-alias.yaml`에 ingress-nginx-controller의 ClusterIP를 지정합니다.

```bash
# ingress-nginx-controller ClusterIP 확인
kubectl get svc ingress-nginx-controller -n ingress-nginx -o jsonpath='{.spec.clusterIP}'
```

```yaml
# patches/add-host-alias.yaml
- op: add
  path: /spec/template/spec/hostAliases
  value:
    - ip: "<ingress-nginx-controller-cluster-ip>"
      hostnames:
        - "keycloak.cnapcloud.com"
```

패치를 적용하려면 `kustomization.yaml`에 추가합니다.

```yaml
patches:
  - target:
      kind: Deployment
      name: oauth2-proxy
    path: patches/add-host-alias.yaml
```

### 5.4 배포 실행

```bash
make preview DEPLOY_ENV=dev
make apply DEPLOY_ENV=dev
```

---

## 6. 설치 후 검증

### 6.1 health check

OAuth2-Proxy의 `/ping` 엔드포인트로 정상 동작을 확인합니다.

```bash
curl -s https://oauth2-proxy.cnapcloud.com/ping
```

**예상 결과**

```
OK
```

### 6.2 브라우저 기반 인증 테스트

httpbin Ingress는 `auth-signin`과 `auth-url` annotation으로 OAuth2-Proxy와 연동됩니다.

```yaml
# resources/httpbin/ingress.yaml
annotations:
  nginx.ingress.kubernetes.io/auth-url: http://oauth2-proxy.security.svc.cluster.local/oauth2/auth
  nginx.ingress.kubernetes.io/auth-signin: https://oauth2-proxy.cnapcloud.com/oauth2/start
  nginx.ingress.kubernetes.io/auth-response-headers: X-Auth-Request-User,X-Auth-Request-Email,X-Auth-Request-Access-Token
```

브라우저에서 `https://httpbin.cnapcloud.com`에 접근하여 아래를 확인합니다.

- Keycloak 로그인 페이지로 리다이렉트
- 인증 성공 후 `https://httpbin.cnapcloud.com`으로 복귀
- 세션 쿠키(`_oauth2_proxy`) 생성

### 6.3 API 기반 인증 테스트

`httpbin-api` Ingress는 `auth-url`만 설정되어 Bearer token을 직접 검증합니다.

```yaml
# resources/httpbin/ingress-api.yaml
annotations:
  nginx.ingress.kubernetes.io/auth-url: http://oauth2-proxy.security.svc.cluster.local/oauth2/auth
```

**1. Keycloak에서 Access Token 발급**

```bash
export ACCESS_TOKEN=$(curl -sk -X POST \
  "https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/token" \
  -d grant_type=password \
  -d client_id=oauth2-proxy \
  -d client_secret=<keycloak-client-secret> \
  -d username=<user> \
  -d password=<password> \
  -d scope='openid profile email' \
  | jq -r .access_token)
```

**2. Bearer token으로 API 호출**

```bash
curl -sk -H "Authorization: Bearer ${ACCESS_TOKEN}" \
     -H "accept: application/json" \
     https://httpbin-api.cnapcloud.com/ip
```

**예상 결과**

```json
{
  "origin": "10.x.x.x"
}
```

---

## 7. Troubleshooting

### 7.1 Pod 시작 실패

**증상**: Pod가 `CrashLoopBackOff` 또는 `Error` 상태

**원인**: `clientSecret`, `cookieSecret` 누락 또는 `oidc_issuer_url` 접근 불가

`oidc_issuer_url`의 `.well-known/openid-configuration` 엔드포인트 응답을 확인합니다.

```bash
kubectl exec -n security deploy/oauth2-proxy -- \
  wget -qO- https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration \
  | jq .issuer
```

내부 DNS로 Keycloak에 접근 불가능한 경우 [hostAlias 패치](#hostalias-패치-선택)를 적용합니다.

### 7.2 인증 리다이렉트 루프

**증상**: 로그인 성공 후 계속 Keycloak으로 리다이렉트

**원인**: `cookie_domains` 설정 불일치 또는 `cookieSecret` 길이 오류

`cookieSecret`이 정확히 32바이트 base64url 인코딩 값인지 확인합니다.

```bash
echo -n "<cookieSecret>" | base64 -d | wc -c
```

출력값이 `32`여야 합니다.

### 7.3 Bearer token 인증 실패 (403)

**증상**: `Authorization: Bearer <token>`으로 API 호출 시 403 응답

**원인**: `skip_jwt_bearer_tokens=true` 미설정 또는 `oidc_extra_audiences` 미포함

`values.yaml`에 아래 설정이 있는지 확인합니다.

```
skip_jwt_bearer_tokens=true
oidc_extra_audiences=["account"]
```

Keycloak token의 `aud` 클레임에 `account`가 포함되어 있어야 합니다.

```bash
echo "${ACCESS_TOKEN}" | cut -d. -f2 | base64 -d 2>/dev/null | jq .aud
```

### 7.4 대용량 헤더로 인한 502

**증상**: 인증 후 upstream 호출 시 502 응답

**원인**: JWT 토큰 크기가 Nginx 프록시 버퍼 한도 초과

`values.yaml`의 Ingress annotation과 httpbin Ingress annotation에 버퍼 설정이 적용되어 있는지 확인합니다.

```yaml
nginx.ingress.kubernetes.io/proxy-buffer-size: "16k"
nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
```
