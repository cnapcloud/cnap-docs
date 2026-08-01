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
| Valid Redirect URIs | `https://rabbit.cnapcloud.com/*` |
| Web Origins | `https://rabbit.cnapcloud.com` |

**Client Scopes 탭:**

`groups` scope를 Assigned 목록에 추가합니다 (Default로 설정).

`groups` scope의 Mapper가 다음과 같이 구성되어 있는지 확인합니다.

| 항목 | 값 |
|------|---|
| Mapper Type | Group Membership |
| Token Claim Name | `groups` |
| Full group path | Off |

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
      auth_oauth2.verify_aud=false
      auth_oauth2.issuer=https://keycloak.cnapcloud.com/realms/cnap
      auth_oauth2.jwks_url=https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/certs
      auth_oauth2.additional_scopes_key=groups
      auth_oauth2.https.peer_verification=verify_none

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

**`auth_oauth2.verify_aud=false`**: Keycloak이 발급하는 토큰의 `aud` 클레임이 `account`로 설정되어 있어 audience 검증을 비활성화합니다.

**`auth_oauth2.https.peer_verification=verify_none`**: Erlang TLS가 와일드카드 인증서(`*.cnapcloud.com`)의 hostname 검증을 거부하는 문제를 우회합니다.

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

**해결 1**: `additionalConfig`에 아래 설정을 추가합니다.

```
auth_oauth2.https.peer_verification=verify_none
```

**원인 2**: JWT의 `aud` 클레임이 `account`이나 `resource_server_id=rabbitmq`로 설정되어 audience 불일치

로그 확인:

```bash
kubectl -n messaging logs rabbitmq-server-0 | grep "invalid credentials"
```

**해결 2**: `additionalConfig`에 아래 설정을 추가합니다.

```
auth_oauth2.verify_aud=false
```

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
- [ ] Valid Redirect URIs: `https://rabbit.cnapcloud.com/*`
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
