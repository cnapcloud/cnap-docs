---
title: "Keycloak"
sidebar_position: 1
---

Kubernetes에서 OpenID Connect / OAuth 2.0 기반 SSO 서버를 운영합니다.

- **버전**: Keycloak `26.5.2`, Helm Chart `codecentric/keycloakx` `7.1.9`
- **네임스페이스**: `security`
- **접속 URL**: `https://keycloak.cnapcloud.com` (사용자), `https://keycloak-admin.cnapcloud.com` (관리자)
- **의존성**: [CNPG Cluster](../data-platform/cnpg-cluster.md), [cert-manager](../network/cert-manager.md), [ingress-nginx](../network/ingress-nginx.md)

---

## 1. 개요

Keycloak은 OpenID Connect / OAuth 2.0 / SAML 프로토콜을 지원하는 오픈소스 SSO 서버입니다. 이 환경에서는 Grafana, RabbitMQ 등 모든 서비스의 인증·인가를 단일 `cnap` Realm에서 관리합니다.

공식 Keycloak 이미지(`quay.io/keycloak/keycloak`)와 codecentric/keycloakx Helm Chart를 사용하며, 스토리지는 외부 CNPG PostgreSQL 클러스터에 위임합니다. SPI 확장(keycloak-extensions-spi, keycloak-metrics-spi)은 init container를 통해 공식 이미지의 providers 경로에 주입합니다.

Realm 구성은 `keycloak-config-cli` Job이 담당하며, ArgoCD 환경에서는 PostSync Hook으로 자동 실행됩니다.

---

## 2. 사전 요구사항

- **CNPG Cluster**: `database` 네임스페이스에 `keycloak` 데이터베이스 및 `keycloak` 사용자 생성 완료 ([cnpg-cluster](../data-platform/cnpg-cluster.md))
- **TLS Secret**: `security` 네임스페이스에 `cnapcloud.com-tls` Secret 존재
- **DNS 등록**:
  ```
  <INGRESS_LB_IP>  keycloak.cnapcloud.com
  <INGRESS_LB_IP>  keycloak-admin.cnapcloud.com
  ```

---

## 3. 디렉터리 구조

```
keycloak-x/
├── Makefile
├── config/
│   └── cnap-realm-config.json       # cnap Realm 전체 설정 내보내기 (참고용)
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── keycloakx/           # codecentric/keycloakx Helm Chart (make pull로 다운로드)
    └── overlays/
        └── dev/
            ├── kustomization.yaml   # Kustomize 진입점, namespace: security
            ├── helm/
            │   ├── helm-chart.yaml  # HelmChartInflationGenerator 설정
            │   └── values.yaml      # Keycloak Helm Chart 커스터마이징
            ├── secrets/
            │   └── sops/
            │       └── keycloak.enc.env     # SOPS 암호화된 시크릿 (db-password, admin-password)
            └── resources/
                ├── keycloak-sops-secrets.yaml   # SopsSecretGenerator — keycloak-secrets Secret 생성
                ├── keycloak-config-cli/
                │   ├── configmap.yaml   # Realm JSON 설정 (master, cnap)
                │   └── job.yaml         # keycloak-config-cli Job (ArgoCD PostSync Hook)
                ├── user-storage/
                │   ├── deployment.yaml  # 사용자 스토리지 SPI 서비스
                │   └── service.yaml
                └── inicis-mock/
                    ├── deployment.yaml  # Inicis 결제 Mock 서버 (dev 전용)
                    ├── service.yaml
                    └── ingress.yaml     # inicis.cnapcloud.com
```

---

## 4. 배포

### 4.1 Namespace 생성

```bash
cd keycloak-x
make namespace
```

### 4.2 패키지 준비

codecentric/keycloakx Helm Chart를 로컬에 다운로드합니다.

```bash
make pull
```

`kustomize/base/helm/keycloakx/`에 Chart v7.1.9가 저장됩니다.

### 4.3 배포 설정

`kustomize/overlays/dev/helm/values.yaml`의 주요 설정입니다.

**데이터베이스 연결**

외부 CNPG PostgreSQL 클러스터에 연결합니다. 패스워드는 `keycloak-secrets` Secret을 참조합니다.

```yaml
database:
  vendor: postgres
  hostname: pg-cluster-rw.database.svc
  port: 5432
  database: keycloak
  username: keycloak
  existingSecret: keycloak-secrets
  existingSecretKey: db-password
```

**관리자 계정**

Keycloak 26.x 이상에서는 bootstrap 환경 변수로 초기 관리자를 설정합니다. 이 계정은 최초 기동 시에만 생성되며, 이후에는 DB에서 직접 관리됩니다. 패스워드는 `keycloak-secrets` Secret을 참조합니다.

```yaml
extraEnv: |
  - name: KC_BOOTSTRAP_ADMIN_USERNAME
    value: "admin"
  - name: KC_BOOTSTRAP_ADMIN_PASSWORD
    valueFrom:
      secretKeyRef:
        name: keycloak-secrets
        key: admin-password
  - name: KC_HOSTNAME
    value: "https://keycloak.cnapcloud.com"
  - name: KC_HOSTNAME_ADMIN
    value: "https://keycloak-admin.cnapcloud.com"
```

**KC_OPTIMIZED 설정**

`KC_OPTIMIZED=false`는 기동 시 빌드 단계를 실행합니다. 환경 변수나 proxy 설정을 변경할 때는 `false`로 유지하고, 설정이 안정화된 후 `true`로 변경하면 기동 시간이 단축됩니다.

**SPI 확장 주입**

init container가 공식 이미지의 `/opt/keycloak/providers/`에 JAR을 복사합니다.

```yaml
extraInitContainers: |
  - name: keycloak-extensions-spi
    image: cnapcloud/keycloak-extensions-spi:26.5.2-1
    command:
      - sh
      - -c
      - |
        cp /resources/spi/keycloak-extensions-spi-1.0.0-SNAPSHOT.jar /opt/keycloak/providers/
        cp /resources/spi/keycloak-metrics-spi-7.0.0.jar /opt/keycloak/providers/
    volumeMounts:
      - name: providers
        mountPath: /opt/keycloak/providers
```

**Realm 구성 (keycloak-config-cli)**

`resources/keycloak-config-cli/configmap.yaml`에 Realm JSON을 정의합니다.

```json
// master.json — frontendUrl은 관리자 콘솔 도메인
{ "realm": "master", "enabled": true,
  "attributes": { "frontendUrl": "https://keycloak-admin.cnapcloud.com" } }

// cnap.json — frontendUrl은 사용자 도메인
{ "realm": "cnap", "enabled": true,
  "attributes": { "frontendUrl": "https://keycloak.cnapcloud.com" } }
```

`resources/keycloak-config-cli/job.yaml`의 Job이 위 ConfigMap을 Keycloak에 적용합니다. ArgoCD 환경에서는 PostSync Hook으로 자동 실행되며, 그 외 환경에서는 `make apply` 후 Job을 수동으로 재실행합니다.

### 4.4 시크릿 암호화

`secrets/sops/keycloak.enc.env`에 평문으로 작성 후 SOPS로 암호화합니다.

```env
db-password=<DB 패스워드>
admin-password=<Keycloak 관리자 패스워드>
```

```bash
cd kustomize/overlays/dev/secrets/sops
sops --encrypt --pgp <GPG_FINGERPRINT> \
  --unencrypted-suffix _unencrypted \
  --in-place keycloak.enc.env
```

> **참고**: GPG Fingerprint는 `gpg --list-secret-keys`로 확인합니다. ArgoCD가 사용하는 키와 동일한 키를 사용해야 합니다.

암호화된 파일은 Git에 커밋하고, 평문 패스워드는 커밋하지 않습니다.

### 4.5 배포 실행

```bash
cd keycloak-x
make preview   # 생성될 매니페스트 확인
make apply     # 배포
```

---

## 5. 설치 후 검증

### 5.1 Realm 생성 확인

keycloak-config-cli Job 완료 여부를 확인합니다.

```bash
kubectl get job keycloak-config-cli -n security
```

예상 결과: `COMPLETIONS: 1/1`

`https://keycloak-admin.cnapcloud.com`에 접속하여 좌측 드롭다운에서 `master`와 `cnap` Realm이 생성되었는지 확인합니다.

### 5.2 OIDC Well-Known 엔드포인트 확인

```bash
curl -s https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration \
  | jq '{issuer, authorization_endpoint, token_endpoint}'
```

`issuer`, `authorization_endpoint`, `token_endpoint`가 반환되면 정상입니다.

### 5.3 액세스 토큰 발급 테스트

`admin-cli` (public client)로 cnap realm 사용자 인증을 확인합니다.

```bash
curl -s -X POST \
  -d "client_id=admin-cli" \
  -d "grant_type=password" \
  -d "username=<username>" \
  -d "password=<password>" \
  https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/token \
  | jq '{expires_in, token_type}'
```

예상 결과: `"expires_in": 300, "token_type": "Bearer"`

### 5.4 Metrics 엔드포인트 확인

```bash
curl -s https://keycloak.cnapcloud.com/realms/master/metrics | head -5
```

`jvm_memory_objects_pending_finalization`, `keycloak_user_event_*` 등 Prometheus 형식 메트릭이 반환되면 정상입니다.

---

## 6. 운영

### 6.1 Client 등록 (Grafana 연동 예시)

Keycloak Admin → `cnap` realm → **Clients** → **Create client**

**Settings 탭**

| 항목 | 값 |
|------|---|
| Client ID | `grafana` |
| Client type | `OpenID Connect` |
| Client authentication | On |
| Root URL | `https://grafana.cnapcloud.com` |
| Home URL | `https://grafana.cnapcloud.com` |
| Valid redirect URIs | `/login/generic_oauth` |
| Valid post logout redirect URIs | `+` |
| Web origins | `https://grafana.cnapcloud.com` |

**Credentials** 탭에서 Client Secret을 복사합니다.

### 6.2 Groups Mapper 설정

**Client Scope 생성**

Keycloak Admin → `cnap` realm → **Client scopes** → **Create client scope**

| 항목 | 값 |
|------|---|
| Name | `groups` |
| Type | `Default` |
| Protocol | `OpenID Connect` |
| Include in token scope | On |

**Mapper 추가**

`groups` scope → **Mappers** → **Add mapper** → **By configuration** → **Group Membership**

| 항목 | 값 |
|------|---|
| Name | `groups` |
| Token Claim Name | `groups` |
| Full group path | Off |
| Add to ID token | On |
| Add to access token | On |
| Add to userinfo | On |

**Client에 Scope 추가**

`groups` scope를 Default로 설정하면 이후 생성하는 Client에는 자동으로 포함됩니다. Scope 생성 이전에 만든 Client(예: `grafana`)에는 수동으로 추가합니다.

**Clients** → `grafana` → **Client scopes** → **Add client scope** → `groups` → **Default**

### 6.3 그룹 생성

**Groups** → **Create group**에서 아래 그룹을 생성합니다.

| 그룹 | 용도 |
|------|------|
| `admin` | 관리자 권한 |
| `editor` | 편집 권한 |
| `viewer` | 읽기 권한 |

신규 사용자의 기본 그룹을 지정하려면: **Realm settings** → **User registration** → **Default groups** → `viewer` 추가

### 6.4 사용자 생성

**Users** → **Create new user**

| 항목 | 값 |
|------|---|
| Username | `alice` |
| Email | `alice@cnapcloud.com` |
| Email verified | On |

사용자 생성 후:
- **Groups** 탭 → **Join Group** → 원하는 그룹 선택
- **Credentials** 탭 → **Set password** → Temporary: `Off`

### 6.5 Metrics Event Listener 설정

keycloak-metrics-spi를 통해 이벤트 기반 메트릭을 수집하려면 Realm별로 설정합니다.

Keycloak Admin → `cnap` realm → **Realm settings** → **Events** → **Event listeners** → `metrics-listener` 추가

이 설정은 `cnapcloud/keycloak-extensions-spi` SPI가 설치된 경우에만 적용됩니다.

---

## 7. Troubleshooting

### 7.1 keycloak-config-cli Job 실패

**증상**: Job이 `BackoffLimitExceeded` 또는 `Error` 상태

**원인 1**: Keycloak 기동 대기 시간 초과. Job의 가용성 체크 타임아웃은 120s이며 `backoffLimit: 3`이므로, Keycloak 기동이 늦어지면 모든 재시도가 소진될 수 있음

**해결 1**: Job을 삭제 후 재적용합니다.

```bash
kubectl delete job keycloak-config-cli -n security
kubectl apply -f kustomize/overlays/dev/resources/keycloak-config-cli/job.yaml -n security
```

**원인 2**: 관리자 계정 불일치. Job의 `KEYCLOAK_USER` / `KEYCLOAK_PASSWORD`와 `values.yaml`의 `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`가 다름

### 7.2 Provider JAR 미로드

**증상**: Realm settings → Events → Event listeners에 `metrics-listener`가 목록에 없음

**원인**: `KC_OPTIMIZED=true` 상태에서 providers가 변경된 경우 재빌드 없이 변경사항이 반영되지 않음

**해결**: `KC_OPTIMIZED=false`로 변경 후 재배포합니다.

```yaml
extraEnv: |
  - name: KC_OPTIMIZED
    value: "false"
```

Keycloak 재기동 후 providers를 다시 스캔하면 `metrics-listener`가 목록에 나타납니다.

### 7.3 관리자 계정 로그인 실패

**증상**: `https://keycloak-admin.cnapcloud.com`에서 `admin` 로그인 실패

**원인**: bootstrap 관리자 계정은 최초 기동 시에만 생성되며 이후 `values.yaml` 변경이 반영되지 않음. DB에 저장된 비밀번호와 불일치

**해결**: kcadm.sh로 비밀번호를 재설정합니다.

```bash
kubectl exec -it keycloak-0 -n security -- /opt/keycloak/bin/kcadm.sh \
  config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user admin \
  --password <현재_비밀번호>

kubectl exec -it keycloak-0 -n security -- /opt/keycloak/bin/kcadm.sh \
  set-password \
  --username admin \
  --new-password <새_비밀번호>
```

### 7.4 사용자 ingress 루트 접근 시 403

**증상**: `https://keycloak.cnapcloud.com/`에 접속 시 403 응답

**원인**: 정상 동작. `values.yaml`의 nginx `configuration-snippet`에서 루트(`/`) 접근을 의도적으로 차단. 루트 접근 시 `/admin`으로 리다이렉트되는 것을 방지하기 위한 설정

사용자는 연동된 애플리케이션에서 `/realms/cnap/...` 경로로 리다이렉트되어 접근합니다.

---

## 8. 제거

**주의**: Keycloak 데이터는 외부 CNPG 클러스터에 저장됩니다. Keycloak을 삭제해도 DB 데이터는 유지됩니다. DB까지 완전히 삭제하려면 CNPG에서 별도로 처리합니다.

```bash
cd keycloak-x
make delete
```

`security` 네임스페이스의 다른 서비스가 없을 경우에만 네임스페이스를 삭제합니다.

```bash
kubectl delete namespace security
```

---

## 부록. 체크리스트

**배포 전:**
- [ ] CNPG `keycloak` 데이터베이스 및 사용자 생성 완료
- [ ] `security` 네임스페이스에 `cnapcloud.com-tls` Secret 존재
- [ ] DNS 등록 완료 (`keycloak.cnapcloud.com`, `keycloak-admin.cnapcloud.com`)

**검증:**
- [ ] `kubectl get job keycloak-config-cli -n security` — `COMPLETIONS: 1/1` 확인
- [ ] `https://keycloak-admin.cnapcloud.com` 접속 — `master`, `cnap` Realm 생성 확인
- [ ] OIDC Well-Known 엔드포인트 응답 확인
- [ ] Metrics 엔드포인트 응답 확인

**Keycloak 설정:**
- [ ] Client 등록 (각 서비스별)
- [ ] `groups` Client Scope 설정 및 Client에 할당
- [ ] 그룹 생성 (`admin`, `editor`, `viewer`)
- [ ] 사용자 생성 및 그룹 할당
- [ ] Metrics Event Listener (`metrics-listener`) 활성화
