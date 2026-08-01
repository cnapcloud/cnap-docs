---
title: "RabbitMQ"
sidebar_position: 1
---

Kubernetes에서 RabbitMQ 3-node HA 클러스터를 운영하는 공식 Cluster Operator와 RabbitmqCluster CR 배포 가이드입니다.

- **Operator 버전**: `rabbitmq/cluster-operator` (latest)
- **네임스페이스**: `messaging`
- **접속 URL**: `https://rabbit.cnapcloud.com`
- **의존성**: [Keycloak](../auth-routing/keycloak.md)

---

## 1. 개요

RabbitMQ Cluster Operator는 `RabbitmqCluster` CRD를 통해 클러스터 생성·운영을 선언적으로 관리합니다. Operator는 `rabbitmq/operator/`에서, RabbitmqCluster CR은 `rabbitmq/cluster/`에서 별도로 관리합니다.

Management UI는 Keycloak OAuth2와 연동하며, `groups` claim 기반으로 admin / editor / viewer 권한을 부여합니다.

---

## 2. 사전 요구사항

- **Keycloak**: `cnap` realm에 `rabbitmq` 클라이언트 생성 완료
- **리소스**: 3-node HA 구성을 위해 3개 노드 이상 권장

---

## 3. 디렉터리 구조

```
rabbitmq/
├── operator/
│   ├── Makefile
│   └── kustomize/
│       ├── base/
│       │   ├── kustomization.yaml
│       │   └── resources/
│       │       └── operator/
│       │           └── cluster-operator.yml    # pull로 다운로드
│       └── overlays/
│           └── dev/
│               ├── kustomization.yaml          # namespace: messaging
│               └── patches/
│                   └── patch-resources.yaml    # Operator 리소스 패치
└── cluster/
    ├── Makefile
    └── kustomize/
        ├── base/
        │   ├── kustomization.yaml
        │   └── resources/
        │       ├── rmq-cluster.yaml            # RabbitmqCluster CR
        │       ├── rmq-ingress.yaml            # Management UI Ingress
        │       └── servicemonitor.yaml         # Prometheus ServiceMonitor
        └── overlays/
            └── dev/
                └── kustomization.yaml          # namespace: messaging
```

---

## 4. 사전 설정

### 4.1. Keycloak 클라이언트 설정

Keycloak Admin → `cnap` realm → Clients → `rabbitmq` 클라이언트를 생성하고 아래와 같이 설정합니다.

**Settings 탭:**

| 항목 | 값 |
|------|---|
| Client authentication | On (Confidential) |
| Standard Flow | Enabled |
| Root URL | `https://rabbit.cnapcloud.com` |
| Valid Redirect URIs | `/js/oidc-oauth/login-callback.html` |
| Web Origins | `https://rabbit.cnapcloud.com` |

**Client Scopes 탭:**

`groups` scope를 Assigned 목록에 추가합니다 (Default로 설정).

`groups` scope의 Mapper가 다음과 같이 구성되어 있는지 확인합니다.

| 항목 | 값 |
|------|---|
| Mapper Type | Group Membership |
| Token Claim Name | `groups` |
| Full group path | Off |

**Audience Mapper 추가 (필수):**

Keycloak이 발급하는 기본 액세스 토큰은 `aud` 클레임이 `account`로 고정되어 있어, RabbitMQ가 자신을 대상으로 발급된 토큰인지 구분하지 못합니다. `rabbitmq` client(또는 `groups`와 같은 전용 client scope)에 Audience Mapper를 추가해 `aud`에 `rabbitmq`를 명시적으로 포함시킵니다.

`rabbitmq` Client → **Client Scopes** → 전용 스코프(또는 `dedicated` scope) → **Mappers** → **Add mapper** → **By configuration** → **Audience**:

| 항목 | 값 |
|------|---|
| Name | `rabbitmq-audience` |
| Included Client Audience | `rabbitmq` |
| Add to ID token | Off |
| Add to access token | On |

이 매퍼가 있어야 다른 client(argocd, grafana 등)용으로 발급된 토큰이 RabbitMQ에서 그대로 통용되는 것을 막을 수 있습니다.

### 4.2. Keycloak 그룹 생성

Keycloak Admin → `cnap` realm → Groups에서 아래 3개 그룹을 생성하고 사용자를 할당합니다.

| 그룹 | RabbitMQ 권한 |
|------|--------------|
| `admin` | administrator 태그 + 전체 vhost read/write/configure |
| `editor` | management 태그 + 전체 vhost read/write |
| `viewer` | monitoring 태그 + 전체 vhost read |

그룹명과 권한 매핑은 RabbitMQ `advancedConfig`의 `scope_aliases`에서 관리합니다. Keycloak 그룹명은 단순 이름만 사용하면 됩니다.

### 4.3. TLS Secret 복사

Management UI Ingress에서 사용하는 TLS Secret을 `messaging` 네임스페이스로 복사합니다.

```bash
kubectl -n default get secret cnapcloud.com-tls -o json \
  | jq 'del(.metadata.namespace, .metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp, .metadata.managedFields)' \
  | kubectl apply -n messaging -f -
```

---

## 5. 배포

### 5.1. Operator 배포

#### 5.1.1. 매니페스트 다운로드

```bash
cd rabbitmq/operator
make pull
```

GitHub Releases에서 `cluster-operator.yml`을 `kustomize/base/resources/operator/`에 다운로드합니다.

특정 버전을 지정하려면 `OPERATOR_VERSION` 변수를 사용합니다.

```bash
make pull OPERATOR_VERSION=v2.11.0
```

#### 5.1.2. 배포 실행

```bash
make preview   # 적용 전 매니페스트 확인
make apply     # Operator 설치
```

`apply`는 `pull`을 포함하므로 별도로 `pull`을 실행하지 않아도 됩니다.

Operator 리소스는 `patches/patch-resources.yaml`에서 패치합니다.

```yaml
# overlays/dev/patches/patch-resources.yaml
resources:
  limits:
    cpu: 200m
    memory: 500Mi
  requests:
    cpu: 100m
    memory: 256Mi
```

### 5.2. 클러스터 배포

#### 5.2.1. 배포 설정

`base/resources/rmq-cluster.yaml`의 주요 설정입니다.

```yaml
spec:
  replicas: 3
  persistence:
    storage: 1Gi
  resources:
    limits:
      cpu: "1"
      memory: 2Gi
    requests:
      cpu: "250m"
      memory: 512Mi
  rabbitmq:
    additionalConfig: |
      default_user=admin
      default_pass=<password>

      # oauth2 / keycloak
      auth_backends.1=rabbit_auth_backend_oauth2
      auth_backends.2=rabbit_auth_backend_internal
      management.oauth_enabled=true
      management.oauth_client_id=rabbitmq
      management.oauth_client_secret=<client-secret>
      management.oauth_provider_url=https://keycloak.cnapcloud.com/realms/cnap
      management.oauth_scopes=openid profile email groups
      auth_oauth2.resource_server_id=rabbitmq
      auth_oauth2.verify_aud=true
      auth_oauth2.issuer=https://keycloak.cnapcloud.com/realms/cnap
      auth_oauth2.jwks_url=https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/certs
      auth_oauth2.additional_scopes_key=groups
      auth_oauth2.https.peer_verification=verify_peer
      auth_oauth2.https.cacertfile=/etc/ssl/certs/ca-certificates.crt
      auth_oauth2.https.hostname_verification=wildcard

    advancedConfig: |
      [
        {rabbitmq_auth_backend_oauth2, [
          {scope_aliases, #{
            <<"admin">>  => [<<"rabbitmq.tag:administrator">>, <<"rabbitmq.read:*/*/*">>, <<"rabbitmq.write:*/*/*">>, <<"rabbitmq.configure:*/*/*">>],
            <<"editor">> => [<<"rabbitmq.tag:management">>,     <<"rabbitmq.read:*/*/*">>, <<"rabbitmq.write:*/*/*">>],
            <<"viewer">> => [<<"rabbitmq.tag:monitoring">>,     <<"rabbitmq.read:*/*/*">>]
          }}
        ]}
      ].

    additionalPlugins:
      - rabbitmq_top
      - rabbitmq_tracing
      - rabbitmq_auth_backend_oauth2
```

**`auth_oauth2.verify_aud=true`**: `resource_server_id=rabbitmq`가 토큰의 `aud` 클레임에 포함되어 있는지 검증합니다. 4.1의 Audience Mapper(`Included Client Audience: rabbitmq`)가 반드시 함께 설정되어 있어야 하며, 없으면 다른 client용 토큰(`aud=account`)도 그대로 통과되어 서비스 간 토큰 재사용이 가능해집니다.

> **비활성화하려면 (권장하지 않음)**: Audience Mapper를 구성할 수 없는 등 불가피한 경우에만 `auth_oauth2.verify_aud=false`로 되돌립니다. 이 경우 `cnap` realm에서 발급된 어떤 client의 토큰이든(`aud` 값과 무관하게) `groups` 클레임만 맞으면 RabbitMQ 접근이 허용되므로, 다른 서비스에서 유출된 토큰이 RabbitMQ 권한 탈취로 이어질 수 있다는 점을 감수해야 합니다.

**`auth_oauth2.https.peer_verification=verify_peer` + `hostname_verification=wildcard`**: JWKS 조회 시 인증서 체인 검증은 유지하면서, Erlang TLS가 와일드카드 인증서(`*.cnapcloud.com`)의 hostname 매칭만 정확히 처리하도록 합니다. `peer_verification=verify_none`으로 검증 자체를 끄면 MITM으로 위조된 JWKS를 받아들일 수 있으므로 지양합니다. `cacertfile`은 `cnapcloud.com` 인증서를 발급한 CA(Let's Encrypt 사용 시 시스템 CA 번들, 사내 Root CA 사용 시 해당 CA 인증서 경로)를 가리켜야 합니다.

> **무효화하려면 (권장하지 않음)**: `cacertfile` 경로가 맞지 않거나 사내 Root CA를 배포하기 어려운 등 불가피한 경우에만 `auth_oauth2.https.peer_verification=verify_none`으로 되돌립니다. 이 경우 RabbitMQ는 어떤 CA로 서명됐는지, hostname이 맞는지 전혀 확인하지 않고 JWKS 응답을 그대로 신뢰하므로, 네트워크 경로상 MITM 공격자가 위조된 서명키를 내려줘도 RabbitMQ가 그 키로 서명된 위조 토큰을 정상 토큰처럼 받아들이게 됩니다.

**`scope_aliases`**: Keycloak `groups` claim의 그룹명을 RabbitMQ 권한 목록으로 확장합니다. `rabbitmq.` prefix는 RabbitMQ 내부 파싱에 사용되며 Keycloak 그룹명과 무관합니다.

#### 5.2.2. 배포 실행

```bash
cd rabbitmq/cluster
make preview   # 적용 전 매니페스트 확인
make apply
```

---

## 6. 설치 후 검증

### 6.1. Operator 동작 확인

```bash
kubectl get crd rabbitmqclusters.rabbitmq.com
```

CRD가 등록되면 Operator가 정상 설치된 것입니다.

### 6.2. 클러스터 상태 확인

```bash
kubectl get rabbitmqcluster -n messaging
```

예상 결과:

```
NAME       ALLREPLICASREADY   RECONCILESUCCESS   AGE
rabbitmq   True               True               5m
```

`ALLREPLICASREADY`와 `RECONCILESUCCESS`가 모두 `True`이면 정상입니다.

### 6.3. 클러스터 피어 연결 확인

```bash
kubectl -n messaging exec rabbitmq-server-0 -- rabbitmqctl cluster_status
```

예상 결과 (3개 노드 모두 running):

```
Disk Nodes
rabbit@rabbitmq-server-0.rabbitmq-nodes.messaging
rabbit@rabbitmq-server-1.rabbitmq-nodes.messaging
rabbit@rabbitmq-server-2.rabbitmq-nodes.messaging

Running Nodes
rabbit@rabbitmq-server-0.rabbitmq-nodes.messaging
rabbit@rabbitmq-server-1.rabbitmq-nodes.messaging
rabbit@rabbitmq-server-2.rabbitmq-nodes.messaging
```

### 6.4. Keycloak OAuth2 로그인 확인

`https://rabbit.cnapcloud.com`에 접속하여 **Click here to log in** 버튼으로 Keycloak 로그인 후 Management UI에 진입합니다.

그룹별 권한 확인:
- `admin` 그룹 사용자: Admin 탭 포함 전체 메뉴 접근
- `editor` 그룹 사용자: 큐/exchange 생성·삭제 가능
- `viewer` 그룹 사용자: 읽기 전용 (Overview, Queues 조회만 가능)

### 6.5. 기본 credential 확인

OAuth2 미사용 시 Operator가 생성한 기본 Secret을 사용합니다.

```bash
kubectl -n messaging get secret rabbitmq-default-user \
  -o jsonpath='{.data.username}' | base64 -d
kubectl -n messaging get secret rabbitmq-default-user \
  -o jsonpath='{.data.password}' | base64 -d
```

---

## 7. Troubleshooting

### 7.1. BOOT FAILED — `no_configuration_schema_found`

**증상**: Pod가 CrashLoopBackOff, 로그에 `no_configuration_schema_found`

**원인**: `PLUGINS_DIR`이 Bitnami 경로(`/opt/bitnami/rabbitmq/plugins`)로 설정되어 있음. 공식 Operator는 Bitnami 이미지를 사용하지 않으므로 플러그인 경로가 존재하지 않음

**해결**: `envConfig`에서 `PLUGINS_DIR` 항목을 제거합니다.

### 7.2. BOOT FAILED — `log.dir invalid`

**증상**: Pod가 CrashLoopBackOff, 로그에 `log.dir invalid, Directory must be writable`

**원인**: `additionalConfig`에 `log.dir=/var/log/rabbitmq` 설정. 공식 이미지에서 해당 경로가 쓰기 불가

**해결**: `additionalConfig`에서 `log.dir`, `log.file.*` 파일 로깅 설정을 제거하고 콘솔 로깅만 사용합니다.

```
log.console=true
log.console.level=info
```

### 7.3. Management UI — `TypeError: Failed to fetch`

**증상**: OAuth2 로그인 시도 시 브라우저에서 `TypeError: Failed to fetch` 오류

**원인**: Keycloak 클라이언트의 **Web Origins**에 `https://rabbit.cnapcloud.com`이 미등록되어 CORS 차단. 또는 입력값에 오타(`https:/rabbit...` — 슬래시 1개)

**해결**: Keycloak → `rabbitmq` 클라이언트 → Settings → Web Origins에 `https://rabbit.cnapcloud.com`을 정확히 입력합니다.

### 7.4. Management UI — `Not authorized`

**증상**: Keycloak 로그인은 성공하나 RabbitMQ에서 `Not authorized` 오류

**원인 1**: RabbitMQ가 JWKS 서명키 다운로드 시 TLS 오류 발생. Erlang TLS가 와일드카드 인증서(`*.cnapcloud.com`)의 hostname 검증을 거부

로그 확인:

```bash
kubectl -n messaging logs rabbitmq-server-0 | grep "Failed to download signing keys"
```

**해결 1**: `peer_verification=verify_none`으로 검증을 끄지 않습니다 — `additionalConfig`에 아래 설정을 추가해 hostname 매칭만 고칩니다.

```
auth_oauth2.https.peer_verification=verify_peer
auth_oauth2.https.cacertfile=/etc/ssl/certs/ca-certificates.crt
auth_oauth2.https.hostname_verification=wildcard
```

**원인 2**: JWT의 `aud` 클레임에 `rabbitmq`가 없어서 audience 불일치 (Keycloak 기본 토큰은 `aud=account`)

로그 확인:

```bash
kubectl -n messaging logs rabbitmq-server-0 | grep "invalid credentials"
```

**해결 2**: `auth_oauth2.verify_aud=false`로 검증을 끄지 않습니다 — 다른 client용 토큰까지 통과시키는 audience confusion 위험이 있습니다. 대신 4.1에서 안내한 대로 `rabbitmq` client에 Audience Mapper(`Included Client Audience: rabbitmq`)를 추가해 토큰의 `aud`에 `rabbitmq`가 실제로 포함되도록 고칩니다.

### 7.5. Management UI — `Not management user`

**증상**: 로그인 후 Management UI 접근 불가, 로그에 `Not management user`

**원인**: JWT의 `groups` claim이 토큰에 포함되지 않거나, Keycloak 사용자가 `admin`/`editor`/`viewer` 그룹에 미속함

JWT `groups` claim 확인:

```bash
TOKEN=$(curl -s -X POST \
  "https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/token" \
  -d "grant_type=password&client_id=rabbitmq&client_secret=<secret>" \
  -d "username=<user>&password=<pass>&scope=openid groups" \
  | jq -r .access_token)

echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq '.groups'
```

`groups` 배열에 `admin`, `editor`, `viewer` 중 하나가 있어야 합니다.

**해결**:
1. Keycloak에서 해당 사용자를 그룹에 추가합니다.
2. Keycloak `rabbitmq` 클라이언트의 Client Scopes에 `groups`가 Default로 할당되어 있는지 확인합니다.

---

## 8. 제거

```bash
cd rabbitmq/cluster && make delete
cd rabbitmq/operator && make delete
```

**주의**: Operator를 삭제하기 전에 반드시 클러스터를 먼저 삭제합니다. Operator가 없으면 `RabbitmqCluster` CR Finalizer를 처리할 수 없어 리소스가 Terminating 상태로 남습니다.

CRD를 완전히 제거하려면 아래 명령을 실행합니다.

```bash
kubectl delete crd rabbitmqclusters.rabbitmq.com
```

---

## 부록. 체크리스트

**Operator 배포 전:**
- [ ] `messaging` 네임스페이스 생성 (`kubectl create namespace messaging`)
- [ ] `cnapcloud.com-tls` Secret을 `messaging` 네임스페이스로 복사 완료

**Keycloak 설정:**
- [ ] `rabbitmq` 클라이언트 생성 (Client authentication: On)
- [ ] Root URL: `https://rabbit.cnapcloud.com`, Valid Redirect URIs: `/js/oidc-oauth/login-callback.html`
- [ ] Web Origins: `https://rabbit.cnapcloud.com` (슬래시 2개 확인)
- [ ] `groups` Client Scope 할당 (Default)
- [ ] Group Membership mapper 설정 (Full group path: Off)
- [ ] `admin` / `editor` / `viewer` 그룹 생성 및 사용자 할당

**Operator 배포:**
- [ ] `make pull` — 매니페스트 다운로드
- [ ] `make preview` — 네임스페이스 `messaging` 적용 확인
- [ ] `make apply` — Operator 설치
- [ ] `kubectl get crd rabbitmqclusters.rabbitmq.com` — CRD 등록 확인

**클러스터 배포:**
- [ ] `rmq-cluster.yaml` — `management.oauth_client_secret` 설정
- [ ] `make preview` 확인
- [ ] `make apply` — 클러스터 생성
- [ ] `kubectl get rabbitmqcluster -n messaging` — `ALLREPLICASREADY: True` 확인

**검증:**
- [ ] `rabbitmqctl cluster_status` — 3개 노드 모두 running 확인
- [ ] Keycloak OAuth2 로그인 성공 확인
- [ ] 그룹별 권한 동작 확인 (admin/editor/viewer)
