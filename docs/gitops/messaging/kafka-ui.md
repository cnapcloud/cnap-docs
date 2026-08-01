---
title: "Kafka UI (Kafbat)"
sidebar_position: 3
---

Kafbat UI Helm chart를 사용한 Kafka 클러스터 웹 UI 배포 가이드입니다.

- **chart**: `kafka-ui` 1.0.0 (kafbat.github.io/helm-charts)
- **네임스페이스**: `messaging`
- **URL**: https://kafka.cnapcloud.com
- **SSO**: Keycloak `cnap` realm — `kafka-ui` client

---

## 1. 개요

Kafbat UI는 Kafka 클러스터의 토픽, 컨슈머 그룹, 브로커 상태를 웹 브라우저에서 조회·관리할 수 있는 오픈소스 UI입니다. Kafka 클러스터(`kafka` 네임스페이스)와 별개로 `messaging` 네임스페이스에 배포하며, Keycloak OIDC를 통해 인증합니다.

---

## 2. 사전 요구사항

- **Kafka 클러스터**: `kafka-kafka-bootstrap.messaging.svc.cluster.local:9092` 접근 가능
- **Keycloak**: `cnap` realm에 `kafka-ui` Confidential Client 등록
- **TLS Secret**: `cnapcloud.com-tls`가 `messaging` 네임스페이스에 반사되어 있어야 함

---

## 3. 디렉터리 구조

```
kafka/ui/
├── Makefile
└── kustomize/
    └── overlays/
        └── dev/
            ├── kustomization.yaml     # namespace: messaging, secretGenerator
            └── helm/
                ├── helm-chart.yaml    # HelmChartInflationGenerator — values-rbac.yaml 참조
                ├── values.yaml        # 클러스터·SSO·Ingress 기본 설정
                └── values-rbac.yaml   # RBAC 포함 전체 설정 (실제 배포 기준)
```

---

## 4. 사전 설정

### 4.1. Keycloak Client 등록

`cnap` realm에 아래 설정으로 Confidential Client를 생성합니다.

| 항목 | 값 |
|------|----|
| Client ID | `kafka` |
| Client Secret | `kustomization.yaml`의 `client-secret` 값과 동일하게 설정 |
| Valid Redirect URIs | `https://kafka.cnapcloud.com/*` |
| Web Origins | `https://kafka.cnapcloud.com` |
| Standard Flow | Enabled |

### 4.2. Keycloak Groups Mapper 설정

Kafbat UI가 JWT의 `groups` 클레임으로 권한을 판단하므로, Keycloak Client에 Group Membership Mapper를 추가합니다.

`kafka` Client → Mappers → Add Mapper:

| 항목 | 값 |
|------|----|
| Mapper Type | Group Membership |
| Token Claim Name | `groups` |
| Full group path | Off |
| Add to ID token | On |
| Add to access token | On |
| Add to userinfo | On |

### 4.3. Keycloak 그룹 생성

`cnap` realm에 아래 그룹을 생성하고 사용자를 배정합니다.

| 그룹 | 권한 범위 |
|------|-----------|
| `admin` | 전체 클러스터 관리 |
| `editor` | 토픽·컨슈머·스키마·커넥터 CRUD, 메시지 읽기·쓰기 |
| `viewer` | 토픽·컨슈머·스키마·커넥터 읽기 전용 |

---

## 5. 배포

### 5.1. RBAC 설정

RBAC는 `values-rbac.yaml`에서 관리합니다. `helm-chart.yaml`이 이 파일을 참조합니다.

RBAC 동작에 필요한 핵심 설정은 다음과 같습니다.

```yaml
yamlApplicationConfig:
  auth:
    oauth2:
      client:
        keycloak:
          scope:
            - groups                   # groups 클레임 요청
          custom-params:
            type: oauth                # OauthAuthorityExtractor 활성화
            roles-field: groups        # JWT의 groups 클레임에서 그룹 추출
  rbac:
    roles:
      - name: admin
        clusters:
          - kafka-dev
        subjects:
          - provider: oauth
            type: role                 # oauth provider에서는 group이 아닌 role
            value: admin               # Keycloak 그룹명과 일치해야 함
        permissions:
          - resource: topic
            value: ".*"
            actions: [ all ]
```

`custom-params.type: oauth`가 없으면 그룹 추출이 동작하지 않습니다. `type: role`은 `oauth` provider에서 `roles-field`로 추출한 값과 매칭하는 타입입니다.

### 5.2. kustomization.yaml 설정

`kustomization.yaml`의 `client-secret` 값을 Keycloak Client Secret과 동일하게 설정합니다.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: messaging

generators:
  - ./helm/helm-chart.yaml

secretGenerator:
  - name: kafka-ui-secret
    namespace: messaging
    literals:
      - client-secret=<keycloak-client-secret>
```

`secretGenerator`가 생성한 Secret은 `values-rbac.yaml`의 `env`에서 `KAFKA_UI_CLIENT_SECRET` 환경변수로 주입되어 OAuth2 client secret으로 사용됩니다.

### 5.3. 배포 실행

```bash
cd kafka/ui
make pull    # kafka-ui Helm Chart 다운로드
make preview # Deployment + Ingress 포함 확인
make apply   # Kafbat UI 배포
```

---

## 6. 설치 후 검증

### 6.1. Pod 기동 확인

```bash
kubectl get deploy kafka-ui -n messaging
```

예상 결과:

```
NAME       READY   UP-TO-DATE   AVAILABLE
kafka-ui   1/1     1            1
```

### 6.2. SSO 로그인 확인

브라우저에서 https://kafka.cnapcloud.com 접속 후 Keycloak 로그인 화면으로 리다이렉트되는지 확인합니다.

로그인 성공 후 왼쪽 사이드바에 `kafka-dev` 클러스터가 표시되고, 브로커 목록이 정상적으로 조회되면 정상입니다.

---

## 7. Troubleshooting

### 7.1. SSO 로그인 후 `redirect_uri_mismatch`

**증상**: Keycloak에서 `Invalid parameter: redirect_uri` 오류

**원인**: Keycloak Client의 Valid Redirect URIs에 `https://kafka.cnapcloud.com/*`가 등록되지 않음

### 7.2. 클러스터 연결 실패 — `Connection refused`

**증상**: UI에서 `kafka-dev` 클러스터가 `Offline` 상태

**원인**: `messaging` 네임스페이스에서 `kafka` 네임스페이스의 bootstrap 주소로 접근 불가. NetworkPolicy 확인

```bash
kubectl run nettest --rm -it --restart=Never \
  --image=busybox -n messaging -- \
  nc -zv kafka-kafka-bootstrap.kafka.svc.cluster.local 9092
```

### 7.3. TLS Secret 없음 — Ingress `503`

**증상**: https://kafka.cnapcloud.com 접속 시 TLS 오류

**원인**: `cnapcloud.com-tls` Secret이 `messaging` 네임스페이스에 반사되지 않음

```bash
kubectl get secret cnapcloud.com-tls -n messaging
```

Secret이 없으면 reflector가 정상 동작 중인지 확인합니다.

---

## 8. 제거

```bash
cd kafka/ui && make delete
```

---

## 부록. 체크리스트

**배포 전:**
- [ ] Keycloak `cnap` realm에 `kafka` Client 생성
- [ ] Keycloak `kafka` Client에 Group Membership Mapper 추가 (`groups` 클레임, Full group path Off)
- [ ] Keycloak `cnap` realm에 `admin` / `editor` / `viewer` 그룹 생성 및 사용자 배정
- [ ] `cnapcloud.com-tls` Secret이 `messaging` 네임스페이스에 반사되어 있는지 확인

**배포:**
- [ ] `kustomization.yaml`의 `client-secret` 값을 Keycloak Client Secret으로 설정
- [ ] `make pull` — Helm Chart 다운로드
- [ ] `make preview` — Deployment, Service, Ingress 포함 확인
- [ ] `make apply` — Kafbat UI 배포

**검증:**
- [ ] `kubectl get deploy kafka-ui -n messaging` — `READY: 1/1` 확인
- [ ] https://kafka.cnapcloud.com 접속 후 Keycloak SSO 로그인 확인
- [ ] `kafka-dev` 클러스터 브로커 정상 조회 확인
