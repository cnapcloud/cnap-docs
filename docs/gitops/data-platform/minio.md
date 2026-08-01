---
title: "MinIO"
sidebar_position: 2
---

S3 호환 오브젝트 스토리지로, PostgreSQL 클러스터 WAL 백업 저장소 및 플랫폼 공용 스토리지로 사용합니다.

- **Helm Chart 버전**: `minio 5.4.0`
- **이미지 버전**: `RELEASE.2024-12-18T13-15-44Z`
- **네임스페이스**: `storage`
- **접속 URL**: `https://minio.cnapcloud.com`
- **의존성**: [Keycloak](../auth-routing/keycloak.md) — OIDC 활성화(2단계) 시에만 필요

---

## 1. 개요

MinIO는 고성능 S3 호환 오브젝트 스토리지로, Helm Chart 기반 Kustomize 배포를 사용합니다. 이 환경에서는 PostgreSQL 클러스터의 WAL 아카이빙·백업 버킷으로 주로 사용되며, Keycloak OIDC를 통한 그룹 기반 정책 매핑을 지원합니다.

**순환 의존성**: MinIO → Keycloak → pgcluster → MinIO 의존 순환이 발생하므로 두 단계로 배포합니다.

1. **1단계**: OIDC 비활성화 상태로 MinIO 먼저 배포
2. pgcluster 설치 (MinIO 백업 버킷 사용)
3. Keycloak 설치 (pgcluster를 DB로 사용)
4. **2단계**: OIDC 활성화 후 MinIO 재배포

---

## 2. 사전 요구사항

- **DNS**: `minio.cnapcloud.com` 등록
- **TLS**: `cnapcloud.com-tls` Secret 생성 완료 (`storage` 네임스페이스)
- **Ingress Controller**: ingress-nginx 설치 완료 ([ingress-nginx](../network/ingress-nginx.md))
- **Keycloak**: OIDC 활성화(2단계) 시에만 필요 ([keycloak](../auth-routing/keycloak.md))

---

## 3. 디렉터리 구조

```
minio/
├── Makefile                                  # 배포 자동화 스크립트
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── minio/                        # MinIO Helm Chart (pull로 다운로드)
    └── overlays/
        └── dev/
            ├── helm/
            │   ├── helm-chart.yaml           # Helm Chart Inflation Generator 설정
            │   ├── values-sta.yaml           # Standalone 모드
            │   └── values-ha.yaml            # Distributed HA 모드 (4-node)
            └── kustomization.yaml            # 환경별 Kustomize 구성
```

| 파일 | 모드 | replicas | 용도 |
|------|------|----------|------|
| `values-sta.yaml` | standalone | 1 | dev/test |
| `values-ha.yaml` | distributed | 4 | 운영 HA |

---

## 4. 사전 설정

### 4.1 root 계정 Secret 생성

```bash
kubectl create namespace storage || true
kubectl create secret generic minio-root-secret \
  --from-literal=rootUser='admin' \
  --from-literal=rootPassword='<strong-password>' \
  -n storage
```

### 4.2 Keycloak Client 설정 (2단계)

2단계 OIDC 활성화 전, Keycloak 설치 완료 후에 수행합니다.

Keycloak에서 `minio` Client를 다음과 같이 생성합니다.

| 항목 | 값 |
|------|----|
| Client ID | `minio` |
| Client authentication | On (Confidential) |
| Valid redirect URIs | `https://minio.cnapcloud.com/oauth_callback` |

**그룹 클레임 매퍼** (Client Scopes → groups):

| 항목 | 값 |
|------|----|
| Mapper Type | `Group Membership` |
| Token Claim Name | `groups` |
| Full group path | Off |

**그룹 생성**: 아래 그룹을 Keycloak에 미리 생성합니다. 그룹 이름과 MinIO 정책 이름이 일치해야 자동으로 매핑됩니다.

| Keycloak 그룹 | MinIO 정책 | 허용 작업 |
|---------------|-----------|-----------|
| `/viewer` | `viewer` | GetObject, ListBucket |
| `/editor` | `editor` | GetObject, PutObject, DeleteObject, ListBucket, Multipart |
| `/admin` | `admin` | `s3:*` (전체) |

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

MinIO Chart v5.4.0을 `kustomize/base/helm/minio/`에 다운로드합니다.

### 5.3 배포 설정

`overlays/dev/helm/helm-chart.yaml` — `valuesFile`로 배포 모드를 선택합니다.

```yaml
valuesFile: ./helm/values-sta.yaml  # 또는 values-ha.yaml
```

`overlays/dev/helm/values-sta.yaml` — 아래 항목들을 실제 환경에 맞게 업데이트합니다.

```yaml
# overlays/dev/helm/values-sta.yaml

## 리소스 설정
resources:
  requests:
    memory: 1Gi

## 스토리지 설정
persistence:
  enabled: true
  storageClass: ""       # 기본 StorageClass 사용. 지정이 필요하면 명시
  accessMode: ReadWriteOnce
  size: 5Gi

## 그룹-정책 매핑 (Keycloak 그룹 이름과 일치해야 함)
policies:
  - name: viewer
    statements:
      - resources:
          - "arn:aws:s3:::*"
        actions:
          - "s3:GetObject"
          - "s3:GetObjectVersion"
          - "s3:ListBucket"
          - "s3:ListAllMyBuckets"
          - "s3:GetBucketLocation"
  - name: editor
    statements:
      - resources:
          - "arn:aws:s3:::*"
        actions:
          - "s3:GetObject"
          - "s3:GetObjectVersion"
          - "s3:PutObject"
          - "s3:DeleteObject"
          - "s3:ListBucket"
          - "s3:ListAllMyBuckets"
          - "s3:GetBucketLocation"
          - "s3:ListBucketMultipartUploads"
          - "s3:ListMultipartUploadParts"
          - "s3:AbortMultipartUpload"
  - name: admin
    statements:
      - resources:
          - "arn:aws:s3:::*"
        actions:
          - "s3:*"

## OIDC — 1단계: 비활성화
oidc:
  enabled: false

## OIDC — 2단계: Keycloak 설치 완료 후 활성화하고 clientSecret 업데이트
# oidc:
#   enabled: true
#   configUrl: "https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration"
#   clientId: "minio"
#   clientSecret: "<keycloak-client-secret>"   # SOPS 암호화 필수
#   claimName: "groups"
#   claimPrefix: ""
#   scopes: "openid,profile,email,groups"
#   redirectUri: "https://minio.cnapcloud.com/oauth_callback"
#   displayName: "CNAP"
```

### 5.4 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

재배포 시 Helm이 생성한 `minio-post-job`이 `Completed` 상태로 남아 있으면 `field is immutable` 오류가 발생합니다. 아래 명령으로 Job을 삭제한 후 재적용합니다.

```bash
kubectl delete job -n storage -l app=minio-post-job --ignore-not-found
make apply
```

---

## 6. 설치 후 검증

### 6.1 스토리지 상태 확인

standalone 모드는 Deployment라 Pod 이름이 자동 생성됩니다. 아래와 같이 변수로 지정합니다.

```bash
# standalone
POD=$(kubectl get pod -n storage -l app=minio -o jsonpath='{.items[0].metadata.name}')
kubectl -n storage exec $POD -- mc alias set local http://localhost:9000 admin <password>
kubectl -n storage exec $POD -- mc admin info local/

# distributed (StatefulSet — minio-0 고정)
kubectl -n storage exec minio-0 -- mc alias set local http://localhost:9000 admin <password>
kubectl -n storage exec minio-0 -- mc admin info local/
```

예상 결과:
- standalone: `Drives: 1/1 OK`
- distributed: `Drives: 4/4 OK`, `Network: 4/4 OK`

### 6.2 버킷 및 오브젝트 동작 확인

```bash
POD=$(kubectl get pod -n storage -l app=minio -o jsonpath='{.items[0].metadata.name}')
kubectl -n storage exec $POD -- mc mb local/test-bucket
kubectl -n storage exec $POD -- mc cp /etc/hostname local/test-bucket/
kubectl -n storage exec $POD -- mc ls local/test-bucket/
kubectl -n storage exec $POD -- mc rb local/test-bucket --force
```

### 6.3 OIDC 로그인 흐름 검증 (2단계 이후)

1. `https://minio.cnapcloud.com` 접속
2. "CNAP" 버튼 클릭 → Keycloak 로그인 페이지 리다이렉트 확인
3. 로그인 후 사용자 그룹에 따른 정책 적용 확인

```bash
kubectl -n storage exec -it minio-0 -- mc admin policy list local/
```

---

## 7. Troubleshooting

### 7.1 OIDC 로그인 후 리다이렉트 실패

Keycloak 로그인 완료 후 MinIO Console로 돌아오지 않습니다.

**원인**: Keycloak Client의 Valid redirect URIs가 `values-sta.yaml`의 `redirectUri`와 불일치합니다.

**해결**: Keycloak Admin Console에서 `minio` Client의 Valid redirect URIs를 `https://minio.cnapcloud.com/oauth_callback`으로 확인합니다.

### 7.2 로그인 후 권한 없음

OIDC 로그인은 성공하지만 버킷에 접근할 수 없습니다.

**원인**: JWT 토큰에 `groups` 클레임이 포함되지 않거나, Keycloak 그룹 이름과 MinIO 정책 이름이 불일치합니다.

**해결**: Keycloak Client Scopes에 groups 매퍼가 추가되었는지 확인하고, 그룹 이름이 `viewer` / `editor` / `admin`과 정확히 일치하는지 확인합니다.

### 7.3 OIDC 버튼 미표시

MinIO Console 로그인 화면에 "CNAP" 버튼이 나타나지 않습니다.

**원인**: `oidc.enabled: false`이거나 `configUrl`이 잘못 설정되었습니다.

**해결**: `values-sta.yaml`에서 `oidc.enabled: true`를 확인하고 `make apply`로 재배포합니다.

---

## 8. 제거

```bash
make delete
```

**주의**: `make delete`는 PVC를 삭제하지 않습니다. 데이터를 완전히 삭제하려면 아래 명령을 추가로 실행합니다.

```bash
kubectl delete pvc -n storage --all
```

---

## 부록. 체크리스트

**1단계 배포 전:**
- [ ] `cnapcloud.com-tls` Secret 생성 완료 (`storage` 네임스페이스)
- [ ] `minio-root-secret` Secret 생성 완료
- [ ] DNS `minio.cnapcloud.com` 등록

**1단계 배포:**
- [ ] `values-sta.yaml`: `oidc.enabled: false` 확인
- [ ] `make namespace` 실행
- [ ] `make pull` 실행
- [ ] `make preview` 확인
- [ ] `make apply` 실행

**1단계 검증:**
- [ ] `mc admin info local/` — Drives OK 확인
- [ ] 버킷 생성/업로드/삭제 동작 확인

**2단계 배포 전 (Keycloak 설치 완료 후):**
- [ ] Keycloak `minio` Client 생성 완료
- [ ] groups 매퍼 추가 완료
- [ ] `/viewer`, `/editor`, `/admin` 그룹 생성 완료
- [ ] `clientSecret` 발급 및 SOPS 암호화 완료

**2단계 배포:**
- [ ] `values-sta.yaml`: `oidc.enabled: true`, `clientSecret` 업데이트
- [ ] `make preview` 확인
- [ ] `make apply` 실행

**2단계 검증:**
- [ ] "CNAP" 버튼 표시 확인
- [ ] OIDC 로그인 → 그룹 정책 적용 확인
