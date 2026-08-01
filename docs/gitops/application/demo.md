---
title: "MSA Demo"
sidebar_position: 1
---

Keycloak OIDC 인증과 Spring Boot MSA 구조를 검증하는 데모 애플리케이션입니다.

- **네임스페이스**: `demo`
- **접속 URL**:
  - React 프론트엔드: https://react-keycloak.cnapcloud.com
  - MSA API: https://msa-demo.cnapcloud.com
- **의존성**: [Harbor](../cicd/harbor.md), [Keycloak](../auth-routing/keycloak.md), [cert-manager](../network/cert-manager.md), [Reflector](../network/reflector.md), [ArgoCD](../cicd/argocd.md)

---

## 1. 개요

세 개의 컴포넌트로 구성된 데모 애플리케이션입니다.

| 컴포넌트 | 이미지 | 접속 경로 | 역할 |
|----------|--------|-----------|------|
| `project-api` | `harbor.cnapcloud.com/library/spring-msa-demo` | `/project` | Keycloak 토큰 검증, 프로젝트 CRUD |
| `orchestrator-api` | `harbor.cnapcloud.com/library/spring-msa-demo` | `/orchestrator` | 서비스 간 호출 오케스트레이션 |
| `react-keycloak-demo` | `harbor.cnapcloud.com/library/react-keycloak-demo` | `/` | Keycloak OIDC 로그인 데모 프론트엔드 |

ArgoCD `demo` AppProject를 통해 GitOps로 배포됩니다. 이미지 태그와 환경 변수는 `overlays/dev/kustomization.yaml`에서 관리합니다. Spring Boot API는 Prometheus ServiceMonitor로 메트릭을 노출합니다.

---

## 2. 사전 요구사항

- **Harbor**: `spring-msa-demo`, `react-keycloak-demo` 이미지 빌드 및 푸시 완료 ([harbor](../cicd/harbor.md))
- **Keycloak**: `cnap` Realm 생성 완료, 관리 콘솔 접근 가능 ([keycloak](../auth-routing/keycloak.md))
- **cert-manager / reflector**: `cnapcloud.com-tls` Secret이 `demo` 네임스페이스에 복제 완료
- **ArgoCD**: `demo` AppProject 생성 완료 (`kubectl apply -f argocd/apps/app-project.yaml -n cicd`)
- **DNS**: `react-keycloak.cnapcloud.com`, `msa-demo.cnapcloud.com` 등록 완료

---

## 3. 디렉터리 구조

```
demo/
├── Makefile                                          # namespace, preview, apply, delete 배포 자동화
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml
    │   └── resources/
    │       ├── spring-boot/
    │       │   ├── project/
    │       │   │   ├── deployment.yaml               # project-api Deployment
    │       │   │   └── service.yaml
    │       │   ├── orchestrator/
    │       │   │   ├── deployment.yaml               # orchestrator-api Deployment
    │       │   │   └── service.yaml
    │       │   ├── ingress.yaml                      # /project, /orchestrator 경로 라우팅
    │       │   └── servicemonitor.yaml               # Prometheus 메트릭 수집 설정
    │       └── react-keycloak/
    │           ├── deployment.yaml                   # React 프론트엔드 Deployment
    │           ├── service.yaml
    │           └── ingress.yaml                      # react-keycloak.cnapcloud.com
    └── overlays/dev/
        ├── kustomization.yaml                        # 이미지 태그, replicas, keycloak-secret
        └── patch/
            ├── project-env-patch.yaml                # PROFILE, API_NAME 환경변수 추가
            └── orchestrator-env-patch.yaml           # PROFILE, API_NAME 환경변수 추가
```

---

## 4. 사전 설정

### 4.1 Keycloak Client 생성

Keycloak 관리 콘솔에서 `cnap` Realm에 두 개의 Client를 생성합니다.

**`msa` Client (Spring Boot API용)**

| 항목 | 값 |
|------|----|
| Client ID | `msa` |
| Client type | OpenID Connect |
| Client authentication | On |
| Standard flow | On |

Client 생성 후 **Credentials** 탭에서 Client Secret을 확인합니다. 4.2 단계에서 사용합니다.

**`react` Client (React 프론트엔드용)**

| 항목 | 값 |
|------|----|
| Client ID | `react` |
| Client type | OpenID Connect |
| Client authentication | Off |
| Standard flow | On |
| Root URL | `https://react-keycloak.cnapcloud.com` |
| Valid redirect URIs | `/` |
| Web origins | `https://react-keycloak.cnapcloud.com` |

### 4.2 배포 설정 업데이트

`overlays/dev/kustomization.yaml`에서 이미지 태그와 Keycloak Secret을 환경에 맞게 수정합니다.

```yaml
# overlays/dev/kustomization.yaml
images:
- name: harbor.cnapcloud.com/library/spring-msa-demo
  newTag: <spring-msa-demo 이미지 태그>
- name: harbor.cnapcloud.com/library/react-keycloak-demo
  newTag: <react-keycloak-demo 이미지 태그>

secretGenerator:
- name: keycloak-secret
  literals:
  - realm-url=https://keycloak.cnapcloud.com/realms/cnap
  - client-id=msa
  - client-secret=<4.1에서 확인한 msa Client Secret>
```

**주의**: `client-secret`은 평문으로 Git에 커밋하지 않습니다. `.gitignore` 처리 또는 SOPS로 암호화하여 관리합니다.

---

## 5. 배포

### 5.1 Namespace 생성

```bash
make namespace
```

### 5.2 배포 실행

**ArgoCD를 통한 배포 (권장)**

ArgoCD가 `argocd/apps/demo.yaml`의 변경을 감지하여 자동으로 sync합니다.

```bash
kubectl apply -f argocd/apps/demo.yaml -n cicd
```

이후 `overlays/dev/kustomization.yaml` 변경 내용을 Git에 push하면 ArgoCD가 자동으로 반영합니다.

**직접 배포**

```bash
make preview DEPLOY_ENV=dev
make apply DEPLOY_ENV=dev
```

---

## 6. 설치 후 검증

### 6.1 React Keycloak 데모 접속

브라우저에서 https://react-keycloak.cnapcloud.com 에 접속합니다.

확인 사항:
- Keycloak 로그인 버튼 표시
- 로그인 클릭 시 Keycloak 인증 페이지로 리다이렉트
- 로그인 완료 후 사용자 정보 및 JWT 토큰 표시

### 6.2 MSA API 응답 확인

```bash
# project-api 헬스체크
curl -s https://msa-demo.cnapcloud.com/project/actuator/health | grep -o '"status":"[^"]*"'

# orchestrator-api 헬스체크
curl -s https://msa-demo.cnapcloud.com/orchestrator/actuator/health | grep -o '"status":"[^"]*"'
```

예상 결과:

```
"status":"UP"
```

### 6.3 Prometheus 메트릭 수집 확인

```bash
kubectl get servicemonitor -n demo
# project-api, orchestrator-api ServiceMonitor 확인
```

Prometheus UI에서 `up{namespace="demo"}` 쿼리로 스크레이프 상태를 확인합니다.

---

## 7. 운영

### 7.1 이미지 업데이트

새 이미지를 Harbor에 푸시한 후 `overlays/dev/kustomization.yaml`의 이미지 태그를 변경하고 Git에 push합니다.

```yaml
images:
- name: harbor.cnapcloud.com/library/spring-msa-demo
  newTag: <새 태그>
```

ArgoCD가 변경을 감지하여 자동으로 Rolling Update를 수행합니다.

---

## 8. Troubleshooting

### 8.1 Spring Boot API 기동 실패 (Keycloak 연결 오류)

**증상**: `project-api` 또는 `orchestrator-api` Pod이 CrashLoopBackOff 상태

```bash
kubectl logs -n demo deployment/project-api | grep -i "keycloak\|connection"
```

**원인**: `keycloak-secret`의 `realm-url` 또는 `client-secret` 값 오류

**해결**: `overlays/dev/kustomization.yaml`의 secretGenerator 값을 수정하고 재배포합니다.

```bash
kubectl delete secret keycloak-secret -n demo
make apply DEPLOY_ENV=dev
```

### 8.2 React 앱 로그인 후 리다이렉트 실패

**증상**: Keycloak 로그인 후 `Invalid redirect_uri` 오류

**원인**: Keycloak `react` Client의 Valid redirect URIs 설정 누락

**해결**: Keycloak 관리 콘솔에서 `react` Client의 Root URL이 `https://react-keycloak.cnapcloud.com`으로 설정되어 있고, Valid redirect URIs에 `/`가 등록되어 있는지 확인

---

## 부록. 체크리스트

**사전 설정**
- [ ] Harbor에 `spring-msa-demo`, `react-keycloak-demo` 이미지 푸시 완료
- [ ] Keycloak `msa` Client 생성 완료 (Client authentication: On)
- [ ] Keycloak `react` Client 생성 완료 (Client authentication: Off, redirect URI 설정)
- [ ] `msa` Client Secret 확인 완료
- [ ] `overlays/dev/kustomization.yaml` 이미지 태그 및 client-secret 업데이트
- [ ] ArgoCD `demo` AppProject 생성 완료
- [ ] DNS 등록 완료 (`react-keycloak.cnapcloud.com`, `msa-demo.cnapcloud.com`)

**배포**
- [ ] `make namespace` 실행
- [ ] `kubectl apply -f argocd/apps/demo.yaml -n cicd` 또는 `make apply DEPLOY_ENV=dev` 실행
- [ ] ArgoCD에서 `demo` Application Synced 상태 확인

**검증**
- [ ] https://react-keycloak.cnapcloud.com 접속 및 Keycloak 로그인 동작 확인
- [ ] `msa-demo.cnapcloud.com/project/actuator/health` — `"status":"UP"` 확인
- [ ] `msa-demo.cnapcloud.com/orchestrator/actuator/health` — `"status":"UP"` 확인

---
