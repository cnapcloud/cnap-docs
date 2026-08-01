---
title: "OpenSearch2 대시보드"
sidebar_position: 8
---

OpenSearch 데이터를 시각화하고 탐색하는 웹 대시보드를 Keycloak OIDC 인증과 함께 배포합니다.

- **Helm Chart 버전**: 2.33.0
- **네임스페이스**: `database`
- **접속 URL**: `https://osd.cnapcloud.com`
- **의존성**: [OpenSearch Cluster](opensearch-cluster.md), [Keycloak](../auth-routing/keycloak.md), [ingress-nginx](../network/ingress-nginx.md)

---

## 1. 개요

OpenSearch Dashboards는 OpenSearch 클러스터의 데이터를 시각화·탐색하는 웹 UI입니다. 이 환경에서는 `database` 네임스페이스의 `opensearch-cluster-master` 서비스를 백엔드로 사용하며, Keycloak OIDC를 통한 SSO 인증으로 접근을 제어합니다. HTTP로 OpenSearch에 연결하므로 SSL 검증은 비활성화되어 있습니다.

---

## 2. 사전 요구사항

- **OpenSearch 클러스터**: `database` 네임스페이스에 `opensearch-cluster-master` 서비스 실행 중 ([opensearch-cluster](opensearch-cluster.md))
- **Keycloak**: `cnap` Realm에 `opensearch` Client 생성 및 Client Secret 발급 완료 ([keycloak](../auth-routing/keycloak.md))
- **nginx Ingress Controller**: 설치 완료 ([ingress-nginx](../network/ingress-nginx.md))
- **TLS Secret**: `database` 네임스페이스에 `cnapcloud.com-tls` Secret 생성 완료
- **DNS**: `osd.cnapcloud.com` 등록 완료

---

## 3. 디렉터리 구조

```
opensearch2/dashboard/
├── Makefile                                         # 배포 자동화 스크립트
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── opensearch-dashboards/               # Dashboards Helm Chart (pull로 다운로드)
    └── overlays/
        └── dev/
            ├── helm/
            │   ├── helm-chart.yaml                  # Helm Chart Inflation Generator 설정
            │   └── values.yaml                      # Dashboards 설정 (OIDC, Ingress 등)
            └── kustomization.yaml                   # 환경별 Kustomize 구성
```

---

## 4. 사전 설정

### 4.1 Keycloak OIDC Client 설정

Keycloak `cnap` Realm에서 `opensearch` Client를 다음 설정으로 생성합니다.

| 항목 | 값 |
|------|-----|
| Client ID | `opensearch` |
| Client Protocol | `openid-connect` |
| Access Type | `confidential` |
| Valid Redirect URIs | `https://osd.cnapcloud.com/auth/openid/login` |

Client 생성 후 **Credentials** 탭에서 Client Secret을 발급합니다. 발급된 Secret은 5.3 배포 설정 단계에서 사용합니다.

---

## 5. 배포

### 5.1 Namespace 생성

```bash
make namespace
```

### 5.2 Helm Chart 다운로드

```bash
make pull
```

`opensearch-dashboards` Chart v2.33.0을 `kustomize/base/helm/opensearch-dashboards/`에 압축 해제합니다.

### 5.3 배포 설정

`overlays/dev/helm/values.yaml`에서 다음 항목을 환경에 맞게 설정합니다.

**Keycloak OIDC 인증**: 4.1에서 발급한 Client Secret을 설정합니다.

```yaml
config:
  opensearch_dashboards.yml: |-
    opensearch_security.auth.type: openid
    opensearch_security.openid.connect_url: "https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration"
    opensearch_security.openid.client_id: "opensearch"
    opensearch_security.openid.client_secret: "<client-secret>"
    opensearch_security.openid.base_redirect_url: "https://osd.cnapcloud.com"
    opensearch_security.openid.scope: "openid profile email groups"
    opensearch_security.cookie.secure: true
    opensearch_security.cookie.isSameSite: "None"
    opensearch_security.multitenancy.enabled: false
```

**주의**: `client_secret`은 운영 환경에서 반드시 SOPS로 암호화하여 관리합니다.

**Ingress 설정**: 도메인 및 TLS Secret을 확인합니다.

```yaml
ingress:
  enabled: true
  annotations:
    kubernetes.io/ingress.class: nginx
  hosts:
    - host: osd.cnapcloud.com
  tls:
    - secretName: cnapcloud.com-tls
      hosts:
        - osd.cnapcloud.com
```

### 5.4 배포 실행

```bash
make preview
make apply
```

---

## 6. 설치 후 검증

### 6.1 OIDC 인증 확인

브라우저에서 `https://osd.cnapcloud.com`에 접속합니다. Keycloak 로그인 페이지로 리다이렉트되면 OIDC 설정이 정상입니다.

### 6.2 대시보드 로드 확인

Keycloak 계정으로 로그인 후 OpenSearch Dashboards 메인 화면이 로드되는지 확인합니다.

### 6.3 인덱스 데이터 조회 확인

1. **Discover** 메뉴에서 인덱스 패턴을 생성합니다
2. 인덱스 데이터가 조회되는지 확인합니다

---

## 7. Troubleshooting

### 7.1 OIDC 리다이렉트 오류

**증상**: 로그인 후 `https://osd.cnapcloud.com`으로 리다이렉트되지 않거나 오류 반환

**원인**: `values.yaml`의 `base_redirect_url`과 Keycloak Client의 Valid Redirect URI 불일치

**해결**: `base_redirect_url` 값과 Keycloak Client에 등록된 URI가 일치하는지 확인합니다.

### 7.2 OpenSearch 연결 실패

**증상**: 대시보드 접속 후 "Could not connect to OpenSearch" 오류

**원인**: `opensearch-cluster-master` 서비스 미실행 또는 `opensearchHosts` 설정 오류

**해결**: OpenSearch 클러스터 상태를 확인합니다.

```bash
kubectl get svc opensearch-cluster-master -n database
```

### 7.3 로그인 후 빈 화면

**증상**: Keycloak 로그인 성공 후 Dashboards 화면이 빈 상태로 표시

**원인**: `cookie.secure` 또는 `isSameSite` 설정 문제

**해결**: `values.yaml`에서 `opensearch_security.cookie.secure: true`와 `isSameSite: "None"` 설정을 확인합니다. HTTPS가 아닌 환경에서는 `cookie.secure: false`로 설정합니다.

### 7.4 401 Unauthorized

**증상**: OpenSearch API 호출 시 401 응답

**원인**: `values.yaml`의 `opensearch.username` / `opensearch.password`가 클러스터 admin 자격증명과 불일치

**해결**: `opensearch-cluster-master`의 admin 비밀번호와 `values.yaml`의 설정이 일치하는지 확인합니다.
