---
title: "Harbor"
sidebar_position: 2
---

컨테이너 이미지와 Helm Chart를 저장·서명·취약점 스캔하는 클라우드 네이티브 레지스트리입니다.

- **버전**: `v2.14.1`
- **Helm Chart 버전**: `1.18.0`
- **네임스페이스**: `cicd`
- **접속 URL**: `https://harbor.cnapcloud.com`
- **의존성**: [cert-manager](../network/cert-manager.md), [Reflector](../network/reflector.md), [Redis HA](../data-platform/redis-ha.md), [CNPG Cluster](../data-platform/cnpg-cluster.md), [Keycloak](../auth-routing/keycloak.md)

---

## 1. 개요

Harbor는 컨테이너 이미지 저장소이자 Trivy 기반 취약점 스캐너입니다. 이 GitOps 환경에서는 외부 Redis(redis-ha)와 PostgreSQL(cnpg-cluster)을 상태 저장소로 사용하며, Keycloak OIDC를 통해 SSO를 구성합니다. stakater/Reloader를 통해 `cnapcloud.com-tls` Secret 갱신 시 harbor-core Pod이 자동으로 재시작됩니다.

---

## 2. 사전 요구사항

- **cert-manager**: TLS 인증서 발급 완료 ([cert-manager](../network/cert-manager.md))
- **reflector**: `cicd` 네임스페이스로 `cnapcloud.com-tls` Secret 복제 완료 ([reflector](../network/reflector.md))
- **redis-ha**: `database` 네임스페이스에 설치 완료 ([redis-ha](../data-platform/redis-ha.md))
- **cnpg-cluster**: `harbor` 데이터베이스 및 사용자 생성 완료 ([cnpg-cluster](../data-platform/cnpg-cluster.md))
- **keycloak**: 관리 콘솔 접근 가능 ([keycloak](../auth-routing/keycloak.md))
- **DNS**: `harbor.cnapcloud.com` 등록

---

## 3. 디렉터리 구조

```
harbor/
├── Makefile
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── harbor/                  # Harbor Helm Chart (v1.18.0)
    ├── components/
    │   └── kustomization.yaml           # stakater/Reloader 어노테이션 패치
    └── overlays/
        └── dev/
            ├── kustomization.yaml
            └── helm/
                ├── helm-chart.yaml      # Helm Chart 렌더링 설정
                └── values.yaml          # dev 환경 Harbor 설정
```

---

## 4. 사전 설정

### 4.1 Keycloak OIDC 클라이언트 생성

1. Keycloak 관리 콘솔에서 `cnap` Realm을 선택합니다.
2. **Clients** > **Create client**를 클릭합니다.
3. 다음 값으로 클라이언트를 생성합니다.

| 항목 | 값 |
|------|----|
| Client ID | `harbor` |
| Client authentication | `On` |
| Root URL | `https://harbor.cnapcloud.com` |
| Valid redirect URIs | `/c/oidc/callback` |

4. **Credentials** 탭에서 **Client secret**을 복사해 둡니다. 6.2 단계에서 사용합니다.

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

### 5.3 배포 설정

`kustomize/overlays/dev/helm/values.yaml` — dev 환경 Harbor 설정.

**외부 데이터베이스 연결**

```yaml
# kustomize/overlays/dev/helm/values.yaml
database:
  type: external
  external:
    host: pg-cluster-rw.database.svc
    port: "5432"
    username: "harbor"
    password: "<db-password>"
    coreDatabase: harbor
```

**외부 Redis 연결**

```yaml
redis:
  type: external
  external:
    addr: redis-ha-haproxy.database.svc
    password: "<redis-password>"
```

**관리자 비밀번호**

```yaml
harborAdminPassword: "<admin-password>"
```

**주의**: `harborAdminPassword`, `database.external.password`, `redis.external.password`, `registry.credentials.password` 등 Secret 값은 SOPS로 암호화해야 합니다. 평문을 Git에 커밋하지 않습니다.

**S3 오브젝트 스토리지 사용 시 (선택)**

기본 구성은 PVC를 사용합니다. S3로 이미지를 저장하려면 아래와 같이 설정합니다.

```yaml
persistence:
  enabled: true
  persistentVolumeClaim:
    registry:
      storageClass: <storage-class>
      size: 5Gi
  imageChartStorage:
    type: s3
    s3:
      region: us-west-1
      bucket: my-harbor-bucket
      accesskey: <access-key>
      secretkey: <secret-key>
      regionendpoint: https://s3.us-west-1.amazonaws.com
      encrypt: false
      secure: true
      v4auth: true
      chunksize: 5242880
```

**참고**: Registry는 업로드 중 임시 레이어 처리와 atomic write를 로컬 디스크에서 수행하므로 S3를 사용하더라도 `persistentVolumeClaim.registry` PVC는 필요합니다. 용량은 최소 5Gi를 권장합니다.

### 5.4 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

---

## 6. 설치 후 검증

### 6.1 기본 접속 확인

브라우저에서 `https://harbor.cnapcloud.com`에 접속하여 `admin` 계정으로 로그인합니다.

### 6.2 Harbor UI에서 OIDC 설정
(언어 변경 후 진행: 오른쪽 상단 사용자 아바타> Preferences> Language> English)

1. **Adminstration> Configuration** > **Authentication** 탭으로 이동합니다.
2. **Auth Mode**를 `OIDC`로 변경합니다.
3. 다음과 같이 입력합니다.

| 항목 | 값 |
|------|----|
| OIDC Provider Name | `Keycloak` |
| OIDC Provider Endpoint | `https://keycloak.cnapcloud.com/realms/cnap` |
| OIDC Client ID | `harbor` |
| OIDC Client Secret | 4.1에서 복사한 Client Secret |
| OIDC Scope | `openid,profile,email,groups` |
| Group Claim Name | `groups` |
| Verify Certificate | 활성화 |

4. **TEST OIDC SERVER** 버튼으로 연결을 확인합니다.
5. 테스트 성공 시 **SAVE**를 클릭합니다.

### 6.3 OIDC 로그인 검증

1. Harbor UI에서 로그아웃합니다.
2. 로그인 화면에 **LOGIN VIA OIDC PROVIDER** 버튼이 표시되는지 확인합니다.
3. 버튼을 클릭하여 Keycloak 로그인 후 Harbor로 정상 리디렉션되는지 확인합니다.

**참고**: OIDC 사용자가 처음 로그인하면 Harbor에서 사용할 사용자 이름 등록을 요청합니다. 데이터베이스에 이미 존재하지 않는 고유한 이름을 입력합니다.

---

## 7. 운영

### 7.1 OIDC 그룹 권한 관리

Keycloak 그룹을 Harbor 프로젝트 멤버로 추가하면 해당 그룹 소속 사용자에게 자동으로 역할이 부여됩니다.

1. Harbor UI에서 권한을 부여할 프로젝트를 선택합니다.
2. **Members** > **+ ADD MEMBER** > **Add OIDC group** 탭을 선택합니다.
3. **Group Name**에 Keycloak Realm에 정의된 그룹 이름을 정확히 입력합니다.
4. **Role**에서 역할(`Project Admin`, `Maintainer`, `Developer` 등)을 선택합니다.
5. **ADD**를 클릭합니다.

등록된 OIDC 그룹은 **Administration** > **Groups**에서 `OIDC` 타입으로 확인할 수 있습니다.

### 7.2 이미지 관리

#### 로그인

```bash
docker login harbor.cnapcloud.com -u <username>
```

OIDC 로그인 시 Keycloak 사용자 ID와 비밀번호를 입력합니다.

#### 이미지 Push

공개 이미지를 pull해서 Harbor에 push하는 방식으로 검증합니다.

```bash
docker pull nginx:alpine
docker tag nginx:alpine harbor.cnapcloud.com/library/nginx:alpine
docker push harbor.cnapcloud.com/library/nginx:alpine
```

Harbor UI에서 `library` 프로젝트 > `nginx` 리포지토리에 `alpine` 태그가 등록되었는지 확인합니다.

### 7.3 Helm Chart 관리

Harbor는 OCI 호환 레지스트리로 Helm Chart를 저장하고 배포할 수 있습니다.

#### Push

```bash
helm registry login harbor.cnapcloud.com -u <username>
helm package ./jenkins
helm push jenkins-5.8.110.tgz oci://harbor.cnapcloud.com/library/helm
```

예상 출력:

```
Pushed: harbor.cnapcloud.com/library/helm/jenkins:5.8.110
Digest: sha256:77c1bc7aed2ce44af4ae3cf2d3c4477d900f470a4ba82efb75f15632747d9440
```

#### Pull

```bash
helm pull oci://harbor.cnapcloud.com/library/helm/jenkins \
  --version 5.8.110 \
  --destination .
```

---

## 8. Troubleshooting

### 8.1 Docker Push 시 x509 인증서 오류

**증상**: `x509: certificate signed by unknown authority` 오류 발생

**원인**: Docker 데몬이 Harbor의 CA 인증서를 신뢰하지 않음

**해결**: 시스템에 Harbor의 CA 인증서를 등록합니다.

### 8.2 Docker Push 권한 거부

**증상**: `denied: requested access to the resource is denied` 오류 발생

**원인**: 로그인한 사용자에게 해당 프로젝트의 Push 권한 없음

**해결**: 7.1을 참고하여 사용자에게 적절한 역할을 부여합니다.

### 8.3 OIDC 로그인 실패

**증상**: OIDC 로그인 시도 후 오류 페이지 또는 Harbor 로그인 화면으로 리디렉션

**원인**: Harbor Core와 Keycloak 간 통신 오류 또는 잘못된 OIDC 설정값

**해결**:

```bash
kubectl logs -n cicd deployment/harbor-core | grep -i oidc
```

로그에서 OIDC 관련 오류 메시지를 확인하고, 6.2의 설정값(Endpoint, Client Secret, Scope)을 검토합니다.

### 8.4 TLS Secret 누락으로 Ingress 접속 불가

**증상**: 브라우저에서 Harbor 접속 시 TLS 인증서 오류

**원인**: `cnapcloud.com-tls` Secret이 `cicd` 네임스페이스에 복제되지 않음

**해결**:

```bash
kubectl get secret cnapcloud.com-tls -n cicd
```

Secret이 없으면 reflector 설정을 확인합니다.
