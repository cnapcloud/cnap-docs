---
title: "Jenkins"
sidebar_position: 1
---

Kubernetes Pod 기반 동적 에이전트를 활용하는 CI/CD 자동화 서버입니다.

- **버전**: 2.528.2 (Helm Chart 5.8.110)
- **네임스페이스**: cicd
- **접속 URL**: https://jenkins.cnapcloud.com
- **의존성**: cert-manager, reflector, Keycloak

---

## 1. 개요

Jenkins는 `jenkins/` 디렉터리 기반으로 Kustomize + Helm으로 배포됩니다. Kubernetes Pod를 동적으로 에이전트로 생성하여 빌드 작업을 실행하며, JCasC(Jenkins Configuration as Code)로 OIDC 인증·권한 설정을 코드로 관리합니다. Keycloak SSO 연동과 GitHub 파이프라인을 제공합니다.

---

## 2. 사전 요구사항

- **cert-manager**: TLS 인증서 발급 ([cert-manager](../network/cert-manager.md))
- **reflector**: TLS 인증서 네임스페이스 간 복제 ([reflector](../network/reflector.md))
- **Keycloak**: OIDC SSO 인증 ([keycloak](../auth-routing/keycloak.md))
- **DNS**: `jenkins.cnapcloud.com` 등록 완료

---

## 3. 디렉터리 구조

```
jenkins/
├── Makefile                              # apply, delete, preview, pull 배포 자동화
├── jenkins-agent/                        # 커스텀 빌드 에이전트 이미지
│   ├── Dockerfile
│   ├── Dockerfile-sidecar
│   └── update-tag/                       # 이미지 태그 자동 업데이트 스크립트
└── kustomize/
    ├── base/
    │   ├── helm/jenkins/                 # Helm Chart 원본
    │   ├── resources/
    │   │   ├── buildkit-deployment.yaml  # BuildKit Deployment (이미지 빌드용)
    │   │   └── buildkit-svc.yaml         # BuildKit Service
    │   └── kustomization.yaml
    └── overlays/dev/
        ├── helm/
        │   ├── values.yaml               # dev 환경 Jenkins 설정
        │   └── helm-chart.yaml           # HelmChartInflationGenerator 설정
        ├── patches/
        │   └── apply.sh.yaml             # 배포 후 처리 패치
        └── kustomization.yaml
```

---

## 4. 사전 설정

### 4.1 Keycloak Client 생성

Keycloak 관리 콘솔에서 `cnap` Realm에 Jenkins OIDC Client를 생성합니다.

| 항목 | 값 |
|------|-----|
| Client ID | `jenkins` |
| Client type | OpenID Connect |
| Client authentication | On |
| Root URL | `https://jenkins.cnapcloud.com` |
| Valid redirect URIs | `/securityRealm/finishLogin` |
| Web origins | `https://jenkins.cnapcloud.com` |

Client 생성 후 **Credentials** 탭에서 Client Secret을 확인하고 `values.yaml`의 `clientSecret` 항목에 기록합니다.

**주의**: `clientSecret`은 민감 정보이므로 평문으로 Git에 커밋하지 않습니다. SOPS로 암호화하여 관리합니다.

### 4.2 Keycloak Groups 설정

Jenkins 권한 매핑에 사용할 그룹을 Keycloak에 생성하고, `cnap` Realm의 `jenkins` Client에 groups claim을 추가합니다.

**Client Scopes > 전용 스코프 추가:**

| 항목 | 값 |
|------|-----|
| Mapper type | Group Membership |
| Token Claim Name | `groups` |
| Full group path | Off |

---

## 5. 배포

### 5.1 Namespace 생성
```bash
kubectl create namespace cicd || true
```

### 5.2 Helm Chart 준비
최신 Jenkins Helm Chart를 다운로드합니다.
```bash
make pull
```

### 5.3 `values.yaml` 커스터마이징
`kustomize/overlays/dev/helm/values.yaml` 파일을 열어 Jenkins의 기본 설정을 수정합니다.

#### 5.3.1 관리자 계정 설정
```yaml
controller:
  admin:
    username: admin
    password: <your-secure-password>  # 초기 관리자 비밀번호
```
> **보안 경고**: 프로덕션 환경에서는 Kubernetes Secret을 사용하여 비밀번호를 관리하는 것을 권장합니다.

#### 5.3.2 Ingress 및 도메인 설정
```yaml
controller:
  ingress:
    enabled: true
    hostName: jenkins.cnapcloud.com  # Jenkins 접속 도메인
    tls:
    - secretName: cnapcloud.com-tls  # cert-manager가 생성한 TLS Secret
      hosts:
         - jenkins.cnapcloud.com
```

#### 5.3.3 Prometheus 메트릭 활성화
```yaml
controller:
  prometheus:
    enabled: true
    scrapeInterval: 30s
    scrapeEndpoint: /prometheus
    serviceMonitorAdditionalLabels:
      prometheus: main
```

#### 5.3.4 플러그인 설정 (installPlugins)
Jenkins에서 필요한 플러그인을 사전 설치하도록 설정합니다.
```yaml
controller:
  installPlugins:
    - kubernetes:latest              # Kubernetes Pod 기반 에이전트 지원
    - workflow-aggregator:latest     # Pipeline 기능
    - git:latest                     # Git 연동
    - configuration-as-code:latest   # JCasC (Jenkins Configuration as Code)
    - matrix-auth:latest             # Matrix Authorization Strategy (권한 관리)
    - oic-auth:latest                # OpenID Connect 인증 (Keycloak SSO)
```

> **참고**: `latest` 대신 특정 버전을 지정하여 재현 가능한 배포를 구성할 수 있습니다.

#### 5.3.5 JCasC (Jenkins Configuration as Code) 설정
JCasC를 사용하여 Jenkins OIDC 인증과 권한 관리를 코드로 설정합니다.

> **중요**: UI에서 수동으로 설정한 OIDC 연동 설정은 Pod 재시작 시 기본값으로 초기화됩니다. JCasC를 사용하면 설정이 코드로 관리되어 재시작 후에도 유지됩니다.

```yaml
controller:
  JCasC:
    defaultConfig: true
    configScripts: 
      jenkins-config: |
        jenkins:
          systemMessage: Welcome to our CI\CD server.  This Jenkins is configured and managed 'as code'.
          
          securityRealm:
            oic:
              clientId: "jenkins"
              clientSecret: "YE6GuMNlZ4qHGewA3r96p7QZMLi8a1e6"
              disableSslVerification: false
              emailFieldName: "email"
              groupIdStrategy: "caseSensitive"
              groupsFieldName: "groups"
              postLogoutRedirectUrl: "https://jenkins.cnapcloud.com/"
              serverConfiguration:
                wellKnown:
                  scopesOverride: "openid email profile groups"
                  wellKnownOpenIDConfigurationUrl: "https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration"
              userIdStrategy: "caseSensitive"
              userNameField: "email"
          authorizationStrategy:
            globalMatrix:
              permissions:
                - "Overall/Administer:admin"
                - "Overall/Read:authenticated"
                - "Job/Read:authenticated"
                - "Overall/Read:editor"
                - "Job/Build:editor"
                - "Job/Read:editor"
                - "Job/Workspace:editor"
```

> **보안 주의**: `clientSecret`은 민감 정보이므로 프로덕션 환경에서는 Kubernetes Secret 또는 SOPS를 사용하여 암호화하는 것을 권장합니다.

#### 5.3.6 리소스 설정
```yaml
controller:
  resources:
    limits:
      cpu: 2000m
      memory: 4096Mi
    requests:
      cpu: 512m
      memory: 512Mi
```

#### 5.3.7 스토리지 설정
```yaml
persistence:
  size: "4Gi"  # Jenkins 홈 디렉터리 크기

workspaceVolume:
  type: PVC
  claim: jenkins-workspace  # 워크스페이스용 별도 PVC
  readOnly: false
```

#### 5.3.8 빌드 에이전트 설정
Jenkins는 동적으로 Kubernetes Pod를 빌드 에이전트로 생성합니다.
```yaml
additionalAgents:
  build:
    podName: build
    idleMinutes: 5
    customJenkinsLabels: build
    image:
      repository: cnapcloud/jenkins-build-agent
      tag: 0.0.1
    resources:
      limits:
        cpu: 2000m
        memory: 4096Mi
      requests:
        cpu: 512m
        memory: 512Mi
  docker:
    podName: docker
    customJenkinsLabels: docker
    image:
      repository: docker
      tag: "latest"
    command: "/bin/sh -c"
    args: "cat"
    TTYEnabled: true
```

### 5.4 Kustomization 구성

Jenkins 배포를 위한 Kustomization 파일들을 구성합니다.

#### 5.4.1 Base 구성
`kustomize/base/kustomization.yaml`에 BuildKit 리소스를 추가합니다.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ./resources/buildkit-deployment.yaml
- ./resources/buildkit-svc.yaml


#### 5.4.2 Dev 구성
`kustomize/overlays/dev/kustomization.yaml`에서 Helm Chart를 생성하고 환경별 설정을 적용합니다.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: cicd

generators:
  - ./helm/helm-chart.yaml

resources:
  - ../../base

patches:
- target:
    kind: ConfigMap
    name: jenkins
  path: ./patches/apply-sh.yaml
```

`apply-sh.yaml` 패치는 Jenkins 초기화 시 플러그인이 이미 설치되어 있으면 재설치를 방지하여 배포 시간을 단축합니다.


### 5.5 배포 프로세스
#### Step 0: 네임스페이스 생성
```bash
kubectl create namespace cicd || true
```

#### Step 1: Helm Chart 준비
```bash
make pull
```

#### Step 2: 배포 미리보기 (권장)
```bash
make preview DEPLOY_ENV=dev
```

#### Step 3: 배포 실행
```bash
make apply DEPLOY_ENV=dev
```

--

## 6. 설치 후 검증 (기본 설치)
1.  **리소스 상태 확인**
    ```bash
    kubectl get pods,svc,ingress,pvc -n cicd
    ```
    - 모든 Pod이 `Running` 상태이고, PVC가 `Bound` 상태인지 확인합니다.

2.  **웹 UI 접속**: 브라우저에서 `https://jenkins.cnapcloud.com`에 접속합니다.

3.  **관리자 로그인**
    - JCasC로 OIDC를 구성한 경우 **Login with Keycloak** 버튼으로 SSO 로그인합니다.
    - OIDC 미구성 시 `admin` 계정과 `values.yaml`의 비밀번호로 로그인합니다.

4.  **Time Zone 설정**
    - 우측 상단 **사용자** > **Account** > **Time Zone**: `Asia/Seoul` 선택

5.  **Jenkins 경고 비활성화** (선택사항):
    - **Jenkins 관리** > **시스템** > **Administrative monitors**
    - `Update Site Warnings` 및 `Jenkins Update Notification` 체크 해제

---

## 7. Keycloak OIDC 연동 (SSO)

Jenkins UI에서 Keycloak을 연동하여 SSO(Single Sign-On)를 구성합니다.

> **참고**: 4.3.5 섹션에서 JCasC를 통해 OIDC 설정을 이미 구성한 경우, 이 섹션은 건너뛰어도 됩니다. 이 섹션은 UI에서 수동으로 설정하는 방법을 안내합니다. 이 설정은 Jenkins를 재시작하면 사라지니 테스트 용도로만 사용하세요.

### 7.1 필수 플러그인 설치
1.  **Jenkins 관리** > **Plugins** > **Available plugins** 로 이동합니다.
2.  다음 플러그인을 검색하여 설치합니다.
    - `OpenID Connect Authentication Plugin`
    - `Matrix Authorization Strategy Plugin` (권한 관리용)
3.  설치 후 Jenkins를 재시작합니다.

### 7.2 Keycloak에서 OIDC 클라이언트 생성
1.  Keycloak 관리 콘솔에 접속하여 원하는 Realm을 선택합니다.
2.  **Clients** 메뉴로 이동하여 **Create client**를 클릭합니다.
3.  다음 정보를 입력하여 클라이언트를 생성합니다.
    -   **Client ID**: `jenkins`
    -   **Name**: `Jenkins`
    -   **Client authentication**: `On`
    -   **Root URL**: `https://jenkins.cnapcloud.com`
    -   **Valid redirect URIs**: `/securityRealm/finishLogin`
    -   **Valid post logout redirect URIs**: `+` (redirect URIs와 동일하게 적용)
    -   **Web origins**: `https://jenkins.cnapcloud.com`
4.  생성된 클라이언트의 **Credentials** 탭으로 이동하여 **Client secret**을 복사합니다.
5.  **Client Scopes** 설정
    -   클라이언트 설정 페이지에서 **Client scopes** 탭으로 이동
    -   `groups` 스코프를 **Assigned** 목록에 추가
    -   `groups` 스코프를 클릭하여 **Mappers** 탭으로 이동
    -   **Add mapper** > **By configuration** > **Group Membership** 선택
    -   다음과 같이 설정:
        -   **Name**: `groups`
        -   **Token Claim Name**: `groups`
        -   **Add to ID Token**: `On`
        -   **Add to Access Token**: `On`
        -   **Full group path**: `Off`

### 7.3 Jenkins에서 OIDC 인증 설정
1.  **Jenkins 관리** > **Security** 로 이동합니다.
2.  **Security Realm** 섹션에서 **Login with Openid Connect** 를 선택합니다.
3.  다음과 같이 설정합니다.

    **Client Configuration:**
    -   **Client id**: `jenkins`
    -   **Client secret**: 6.2 단계에서 복사한 Client Secret

    **Configuration mode:**
    -   **Discovery via well-known endpoint** 선택
    -   **Well-known configuration endpoint**
        ```
        https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration
        ```

    **Scopes:**
    -   **Override scopes**: `openid email profile groups`

    **User fields:**
    -   **User name field name**: `email`
    -   **Email field name**: `email`
    -   **Groups field name**: `groups`

    **Logout:**
    -   **Logout from OpenID Provider**: 체크 ✓
    -   **Post logout redirect URL**: `https://jenkins.cnapcloud.com/`

4.  **저장** 버튼을 클릭합니다.

### 7.4 권한 관리 설정 (Matrix Authorization Strategy)
Keycloak 그룹 기반으로 Jenkins 권한을 관리합니다.

1.  **Jenkins 관리** > **Security** 로 이동합니다.
2.  **Authorization** 섹션에서 **Matrix-based security** 를 선택합니다.
3.  그룹별 권한을 설정합니다.

    **예시: 관리자 그룹 추가**
    -   **Add group** 버튼을 클릭
    -   그룹 이름 입력: `jenkins-admins` (Keycloak에 정의된 그룹명)
    -   **Overall** > **Administer** 권한 부여

    **예시: 개발자 그룹 추가**
    -   **Add group** 버튼을 클릭
    -   그룹 이름 입력: `jenkins-developers`
    -   **Overall** > **Read** 권한 부여
    -   **Job** > **Build**, **Read**, **Workspace** 권한 부여

4.  **저장** 버튼을 클릭합니다.

### 7.5 OIDC 로그인 검증
1.  Jenkins에서 로그아웃합니다.
2.  로그인 페이지에 다시 접속합니다.
3.  **Login with OpenID Connect** 버튼이 나타나는지 확인합니다.
4.  버튼을 클릭하여 Keycloak 로그인 페이지로 이동하는지, 그리고 로그인 후 Jenkins로 정상적으로 리디렉션되는지 확인합니다.
5.  Jenkins 대시보드 우측 상단에 Keycloak 사용자 이메일이 표시되는지 확인합니다.

---

## 8. GitHub 연동 설정

### 8.1 필수 플러그인 설치
Jenkins에 GitHub 연동을 위한 플러그인을 설치합니다.

1.  **Jenkins 관리** > **Plugins** > **Available plugins** 로 이동합니다.
2.  다음 플러그인을 검색하여 설치합니다.
    - `GitHub`
    - `GitHub Branch Source`
    - `GitHub API`
    - `GitHub Authentication`

3.  설치 후 Jenkins를 재시작합니다.

### 8.2 GitHub Personal Access Token 발급
1.  GitHub에 로그인하여 우측 상단 프로필을 클릭합니다.
2.  **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)** 로 이동합니다.
3.  **Generate new token (classic)** 을 클릭합니다.
4.  다음 권한(scope)을 선택합니다.
    - `repo` (전체)
    - `admin:repo_hook` (전체)
    - `user:email`
5.  토큰을 생성하고 안전한 곳에 복사해둡니다.

### 8.3 Jenkins Credentials 등록
1.  **Jenkins 관리** > **Credentials** > **System** > **Global credentials (unrestricted)** 로 이동합니다.
2.  **+ Add Credentials** 를 클릭합니다.

#### Credential 1: Github Username/Password
- **Kind**: `Username with password`
- **Scope**: `Global`
- **Username**: GitHub 사용자 이름
- **Password**: 8.2 단계에서 생성한 Personal Access Token
- **ID**: `github-password`
- **Description**: `GitHub Username and Token`

#### Credential 2: Github Secret Text
- **Kind**: `Secret text`
- **Scope**: `Global`
- **Secret**: 8.2 단계에서 생성한 Personal Access Token
- **ID**: `github-token`
- **Description**: `GitHub Personal Access Token`

#### Credential 3: Harbor Secret Text
- **Kind**: `Secret text`
- **Scope**: `Global`
- **Secret**: Harbor Password
- **ID**: `harbor-password`
- **Description**: `Harbor Password`


### 8.4 GitHub Server 등록
1.  **Jenkins 관리** > **시스템** 으로 이동합니다.
2.  **GitHub** 섹션을 찾습니다 (없으면 아래로 스크롤).
3.  **Add GitHub Server** > **GitHub Server** 를 선택합니다.
4.  다음과 같이 설정합니다.
    - **Name**: `github.com`
    - **API URL**: `https://api.github.com`
    - **Credentials**: `github-token` (7.3에서 생성한 Secret Text)
    - **Manage hooks**: 체크 ✓
5.  **Test connection** 버튼을 클릭하여 연결을 확인합니다.
    - 성공 시: `Credentials verified for user <username>, rate limit: ...` 메시지가 표시됩니다.
6.  **저장** 버튼을 클릭합니다.

※ Manage hooks를 체크하면 Multibranch Pipeline 생성 시 자동으로 Webhook이 등록되므로 별도의 수동 설정이 필요하지 않습니다.

### 8.5 Multibranch Pipeline 생성

GitHub 저장소와 연동된 Multibranch Pipeline을 생성합니다.

#### 8.5.1 새로운 Item 생성
1.  Jenkins 대시보드에서 **새로운 Item** 을 클릭합니다.
2.  **Enter an item name**: 프로젝트 이름 입력 (예: `my-app`)
3.  **Multibranch Pipeline** 을 선택하고 **OK** 를 클릭합니다.

#### 8.5.2 Branch Sources 설정
1.  **Branch Sources** 섹션에서 **Add source** > **GitHub** 를 선택합니다.
2.  다음과 같이 설정합니다.
    - **Credentials**: `github-password` (7.3에서 생성한 Username/Password)
      - *이 설정은 GitHub API rate limit을 방지합니다*
    - **Repository HTTPS URL**: GitHub 저장소 URL (예: `https://github.com/username/my-app`)

#### 8.5.3 Discover Branches 전략 설정
1.  **Behaviors** 섹션에서 **Add** > **Discover branches** 를 추가합니다.
2.  **Strategy**
    - `Exclude branches that are also filed as PRs` (PR이 아닌 브랜치만 빌드)

#### 8.5.4 Discover Pull Requests 설정
1.  **Behaviors** 섹션에서 **Add** > **Discover pull requests from origin** 을 추가합니다.
2.  **Strategy**
    - `Merging the pull request with the current target branch revision` (PR을 머지한 상태로 빌드)

#### 8.5.5 브랜치 필터 설정
1.  **Behaviors** 섹션에서 **Add** > **Filter by name (with wildcards)** 를 추가합니다.
2.  **Include**
    - `main` (메인 브랜치)
    - `PR-*` (PR 브랜치)
    - `develop` (개발 브랜치, 필요한 경우)

#### 8.5.6 Scan Triggers 설정
1.  **Scan Repository Triggers** 섹션에서 다음과 같이 설정합니다.
    - **Periodically if not otherwise run**: 체크 ✓
    - **Interval**: `1 minute` 또는 원하는 간격 설정

2.  **저장** 버튼을 클릭합니다.

---

## 9. GitLab 연동 설정

### 9.1 필수 플러그인 설치
Jenkins에 GitLab 연동을 위한 플러그인을 설치합니다.

1.  **Jenkins 관리** > **Plugins** > **Available plugins** 로 이동합니다.
2.  다음 플러그인을 검색하여 설치합니다.
    - `Generic Webhook Trigger Plugin`
    - `GitLab API Plugin`
    - `GitLab Branch Source Plugin`
    - `GitLab Logo Plugin`
    - `GitLab Merge Request Builder`
    - `GitLab Plugin`
    - `Multibranch Build Strategy Extension` (특정 폴더 변경 시 빌드용)

3.  설치 후 Jenkins를 재시작합니다.

### 9.2 GitLab Personal Access Token 발급
1.  GitLab에 로그인하여 좌측 상단 프로필 아이콘을 클릭합니다.
2.  **Preferences** > **Access Tokens** 로 이동합니다.
3.  **Add new token**을 클릭하고 다음을 설정합니다.
    - **Token name**: 토큰 식별 이름 (예: `jenkins-token`)
    - **Expiration date**: 만료일 설정 (또는 비워두면 무기한)
    - **Select scopes**: 다음 권한 선택
      - `api`: GitLab API 전체 접근
      - `read_repository`: 저장소 읽기
      - `write_repository`: 저장소 쓰기 (Webhook 관리용)
4.  **Create personal access token**을 클릭하고 생성된 토큰을 복사합니다.

> **참고**: Group Access Token이나 Project Access Token도 사용 가능하지만, 해당 그룹/프로젝트에만 접근이 제한됩니다. 여러 프로젝트를 관리하려면 Personal Access Token을 사용하세요.


### 9.3 Jenkins Credentials 등록
1.  **Jenkins 관리** > **Credentials** > **System** > **Global credentials (unrestricted)** 로 이동합니다.
2.  **+ Add Credentials** 를 클릭하여 다음 Credential들을 생성합니다.

> **참고**: 8.2에서 생성한 **동일한 토큰**을 Jenkins의 서로 다른 Credential 형식으로 등록합니다. GitLab Plugin과 GitLab Branch Source Plugin이 각각 다른 형식을 요구하기 때문입니다.

#### Credential 1: Username with password
- **Kind**: `Username with password`
- **Scope**: `Global`
- **Username**: GitLab 사용자 이름 (예: `root`)
- **Password**: GitLab 비밀번호
- **ID**: `gitlab-password`
- **Description**: `GitLab Username and Password`

#### Credential 2: GitLab API token
- **Kind**: `GitLab API token`
- **Scope**: `Global`
- **API token**: 8.2 단계에서 생성한 Access Token
- **ID**: `gitlab-api-token`
- **Description**: `GitLab API Token`

#### Credential 3: GitLab Personal Access Token
- **Kind**: `GitLab Personal Access Token`
- **Scope**: `Global`
- **Token**: 8.2 단계에서 생성한 Access Token (Credential 2와 동일한 토큰)
- **ID**: `gitlab-access-token`
- **Description**: `GitLab Personal Access Token`

#### Credential 4: Webhook Secret text
- **Kind**: `Secret text`
- **Scope**: `Global`
- **Secret**: 임의의 비밀 문자열 생성 (예: `9acc55ba66e4f53d9be86ea5efe895f7`)
- **ID**: `gitlab-webhook-token`
- **Description**: `GitLab Webhook Token`

#### Credential 3: Harbor Secret Text
- **Kind**: `Secret text`
- **Scope**: `Global`
- **Secret**: Harbor Password
- **ID**: `harbor-password`
- **Description**: `Harbor Password`

> **참고**: Webhook Secret은 GitLab과 Jenkins 간의 통신을 보호하는 비밀키입니다. 안전한 랜덤 문자열을 사용하세요.


### 9.4 GitLab 서버 등록
1.  **Jenkins 관리** > **시스템** 으로 이동합니다.

#### GitLab 설정 1 (GitLab)
2.  **GitLab** 섹션을 찾아 다음과 같이 설정합니다.
    - **Enable authentication for '/project' end-point**: 체크 ✓
    - **Connection name**: `gitlab-internal` (또는 GitLab 서버 식별 이름)
    - **GitLab host URL**: `https://gitlab.cnapcloud.com` (또는 GitLab 서버 URL)
    - **Credentials**: `gitlab-api-token` (GitLab API Token)

#### GitLab 설정 2 (GitLab Servers)
3.  **GitLab Servers** 섹션을 찾아 **Add GitLab Server** 를 클릭하고 다음과 같이 설정합니다.
    - **Display Name**: `gitlab-internal`
    - **Server URL**: `https://gitlab.cnapcloud.com`
    - **Credentials**: `gitlab-access-token` (GitLab Personal Access Token)
    - **Web Hook**
      - **Manage Web Hooks**: 체크 ✓
      - **Manage System Hooks**: 체크 ✓
      - **Secret Token**: `gitlab-webhook-token` (8.3에서 생성한 Secret text)

#### GitLab Merge Request Builder 설정
4.  **GitLab Merge Request Builder** 섹션을 찾아 다음과 같이 설정합니다.
    - **GitLab Host URL**: `https://gitlab.cnapcloud.com`

5.  **저장** 버튼을 클릭합니다.


### 9.5 Multibranch Pipeline 생성 (GitLab)
GitLab 저장소와 연동된 Multibranch Pipeline을 생성합니다.

#### 9.5.1 새로운 Item 생성
1.  Jenkins 대시보드에서 **새로운 Item** 을 클릭합니다.
2.  **Enter an item name**: 프로젝트 이름 입력 (예: `spring-msa-demo`)
3.  **Multibranch Pipeline** 을 선택하고 **OK** 를 클릭합니다.

#### 9.5.2 Branch Sources 설정
1.  **Branch Sources** 섹션에서 **Add source** > **GitLab Project** 를 선택합니다.
2.  다음과 같이 설정합니다
    - **Server**: `gitlab-internal` (8.4에서 등록한 서버)
    - **Checkout Credentials**: `gitlab-password` (8.3에서 생성한 Username/Password)
    - **Owner**: GitLab 그룹 또는 사용자명 (예: `msa`)
    - **Projects**: GitLab 프로젝트 경로 (예: `msa/spring-msa-demo`)

#### 9.5.3 Discover Branches 전략 설정
1.  **Behaviors** 섹션에서 **Add** > **Discover branches** 를 추가합니다.
2.  **Strategy**
    - `Only branches that are not also filed as MRs` (MR이 아닌 브랜치만 빌드)

#### 9.5.4 Discover Merge Requests 설정
1.  **Behaviors** 섹션에서 **Add** > **Discover merge requests from origin** 을 추가합니다.
2.  **Strategy**
    - `Merging the merge request with the current target branch revision` (MR을 머지한 상태로 빌드)

3.  **Behaviors** 섹션에서 **Add** > **Discover merge requests from forks** 를 추가합니다.
4.  **Strategy**
    - `Merging the merge request with the current target branch revision`
5.  **Trust**
    - `Trust Members`

#### 9.5.5 브랜치 필터 설정
1.  **Behaviors** 섹션에서 **Add** > **Filter by name (with wildcards)** 를 추가합니다.
2.  **Include**
    - `main` (메인 브랜치)
    - `MR-*` (Merge Request 브랜치)

#### 9.5.6 Webhook Listener 설정
1.  **Webhook Listener Conditions** 섹션에서:
    - **Always build pipeline on Open MR webhook**: 체크 ✓
    - **Always build pipeline on Re-Open MR webhook**: 체크 ✓

#### 9.5.7 Scan Triggers 설정
1.  **Scan Multibranch Pipeline Triggers** 섹션에서 다음과 같이 설정합니다.
    - **Periodically if not otherwise run**: 체크 ✓
    - **Interval**: `1 minute` 또는 원하는 간격 설정
2.  **저장** 버튼을 클릭합니다.

#### 9.5.8 특정 폴더 변경 시에만 빌드 (선택사항)
특정 디렉터리가 변경될 때만 빌드를 트리거하려면 다음과 같이 설정합니다.

1.  **Build strategies** 섹션에서 **Add** > **Build included regions strategy** 를 선택합니다.
2.  **Trigger builds for included regions**
    - `project/**` (project 폴더 변경 시에만 빌드)
    - 또는 원하는 경로 패턴 입력
3.  **저장** 버튼을 클릭합니다.

### 9.6 GitLab Webhook 설정
8.4에서 **Manage Web Hooks**를 체크한 경우, Multibranch Pipeline 생성 시 Webhook이 자동으로 등록됩니다. 이 섹션은 자동 등록이 실패하거나 수동으로 설정해야 하는 경우에만 참고하세요.

#### Webhook 자동 등록 확인
1.  GitLab 프로젝트 페이지로 이동합니다.
2.  **Settings** > **Webhooks** 로 이동합니다.
3.  Jenkins URL이 포함된 Webhook이 등록되어 있는지 확인합니다.

#### 수동 설정 (자동 등록 실패 시)
1.  GitLab 프로젝트 페이지에서 **Settings** > **Integrations** 로 이동합니다.
2.  **Jenkins** 통합을 선택하거나 추가합니다.
3.  다음과 같이 설정합니다.
    - **Trigger**: `Push`, `Merge request` 선택
    - **Jenkins server URL**: `https://jenkins.cnapcloud.com` (또는 Jenkins URL)
    - **SSL verification**: 체크 (HTTPS 사용 시)
    - **Project name**: `spring-msa-demo` (Jenkins에서 생성한 프로젝트 이름)
    - **Username**: `admin` (Jenkins 관리자 계정)
    - **Enter new password**: Jenkins 관리자 비밀번호
4.  **Test settings** 버튼을 눌러 연결을 확인합니다.
5.  **Save changes** 를 클릭합니다.

### 9.7 GitLab Outbound Requests 허용
GitLab이 내부 네트워크의 Jenkins에 요청을 보낼 수 있도록 설정합니다.

1.  GitLab 관리자 계정으로 로그인합니다.
2.  **Admin Area** > **Settings** > **Network** 로 이동합니다.
3.  **Outbound requests** 섹션을 확장합니다.
4.  다음 옵션을 체크합니다.
    - **Allow requests to the local network from webhooks and integrations**: 체크 ✓
    - **Allow requests to the local network from system hooks**: 체크 ✓
5.  **Local IP addresses and domain names that hooks and integrations can access** 필드에 Jenkins 도메인을 추가합니다.
    - `jenkins.cnapcloud.com`
    - 또는 Jenkins IP 주소
6.  **Save changes** 를 클릭합니다.

> **참고**: 외부 도메인을 사용하는 경우 GitLab이 해당 도메인에 접근 가능해야 합니다.  
> 내부 네트워크 구성 예: `jenkins.cnapcloud.com` → `192.168.0.75:80,443` → `192.168.64.7:80,443` (k8s ingress)

### 9.8 GitLab 연동 검증
1.  GitLab 저장소에 커밋을 푸시합니다.
2.  Jenkins에서 자동으로 빌드가 트리거되는지 확인합니다.
3.  GitLab 프로젝트의 **CI/CD** > **Pipelines** 에서 Jenkins 파이프라인 상태를 확인할 수 있습니다.
4.  Merge Request를 생성하여 MR 빌드가 트리거되는지 확인합니다.

---

## 10. Dashboard 뷰 구성

여러 프로젝트를 한눈에 보기 위한 대시보드를 구성합니다.

### 10.1 새로운 뷰 생성
1.  Jenkins 대시보드에서 **+** 탭 또는 **New View** 를 클릭합니다.
2.  **View name**: 원하는 이름 입력 (예: `GitHub Projects` 또는 `MSA`)
3.  **List View** 를 선택하고 **Create** 를 클릭합니다.

### 10.2 뷰 설정
1.  **Job Filters** 섹션에서:
    - **Jobs**
      - `Recurse in subfolders` 체크 ✓
      - 포함할 프로젝트 선택:
        - GitHub 프로젝트 예: `my-app` → `main` 체크 ✓
        - GitLab 프로젝트 예: `msa / spring-msa-demo` → `main` 체크 ✓
2.  **Columns** 섹션에서 표시할 열을 선택합니다.
    - `Status`
    - `Weather`
    - `Name`
    - `Last Success`
    - `Last Failure`
    - `Last Duration`
    - `Build Button`
3.  **OK** 를 클릭합니다.

---

## 11. 파이프라인 작성 예시 (GitHub 기준)

이 섹션에서는 GitHub 저장소를 기준으로 실제 프로젝트에 사용할 수 있는 Jenkinsfile과 Makefile 예시를 제공합니다.

### 11.1 Makefile 작성
프로젝트 루트에 `Makefile`을 생성하여 빌드 작업을 자동화합니다.

```makefile
# Docker image variables
IMAGE_ORG := harbor.cnapcloud.com/library
IMAGE_REPOSITORY := ${IMAGE_ORG}/spring-msa-demo
IMAGE_TAG := $(shell git rev-parse --short=7 HEAD)

# Gitops variables
GITOPS_REPO := https://github.com/username/gitops.git
GITOPS_PATH := tmp/gitops
GIT_BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD)

help:
	@echo "Available targets:"; awk '/^[a-zA-Z0-9_-]+:/ {t=$$1; sub(/:$$/, "", t); \
	if(t=="help") next; getline; if($$0 ~ /@echo/) {sub(/.*@echo[ \t]*/, "", $$0); \
	printf "  %-15s %s\n", t, $$0}}' $(MAKEFILE_LIST)	

build:
	@echo "[build] Build all projects."
	./gradlew clean build -x test --no-build-cache
		
report:
	@echo "[report] Generate test report."
	./gradlew test jacocoTestReport
	
publish:
	@echo "[publish] Publish artifacts."
	./gradlew publish -x test -Pusername=admin -Ppassword=password
	
run-project:
	@echo "[run] Run project service locally."
	./gradlew project-service:bootRun
	
run-orchestrator:
	@echo "[run] Run orchestrator service locally."
	./gradlew orchestrator-service:bootRun		
		
docker-build:
	@echo "[docker-build] Build and push Docker image"
	buildctl --addr tcp://buildkitd.cicd.svc:1234 build \
	--frontend dockerfile.v0 \
	--local context=. \
	--local dockerfile=. \
	--output type=image,name=$(IMAGE_REPOSITORY):$(IMAGE_TAG),push=true
	
update-tag:
	@echo "[update-tag] Update image tag in GitOps repo."
	update-tag.sh \
	--repo $(GITOPS_REPO) \
	--branch main \
	--image $(IMAGE_REPOSITORY):$(IMAGE_TAG)

clean:
	@echo "[clean] Clean up Docker builder cache."
	buildctl --addr tcp://buildkitd.cicd.svc:1234 prune --all --force

.PHONY: help build report run-project run-orchestrator docker-build update-tag clean
```

#### Makefile 주요 타겟 설명

- **build**: Gradle을 사용하여 프로젝트 빌드
- **docker-build**: BuildKit을 사용하여 Docker 이미지 빌드 및 푸시
- **update-tag**: GitOps 저장소의 이미지 태그를 업데이트하는 스크립트 실행
- **clean**: Docker 빌더 캐시 정리

> **참고**: `buildctl`은 4.3.6에서 설정한 BuildKit 서비스를 사용합니다.


### 11.2 Jenkinsfile 작성 (GitHub 연동)
프로젝트 루트에 `Jenkinsfile`을 생성하여 파이프라인을 정의합니다.

```groovy
pipeline {
    agent { label 'build' }

    environment {
        GITHUB_TOKEN = credentials('github-token')
        HARBOR_PASSWD = credentials('harbor-password')
    }

    options {
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES') 
        buildDiscarder(logRotator(numToKeepStr: '14'))
    }

    stages {
        stage('setup-github') {
            steps {
                sh '''
                    ### git user info !! important to reuse pod. 
                    git config --global user.email "your-email@example.com"
                    git config --global user.name "Your Name"
                    git config --global url.https://username:${GITHUB_TOKEN}@github.com/orgname/.insteadOf https://github.com/orgname/
                '''
            }	
        }

        stage("build") {
            steps {
                sh '''	
                    make build
                '''        			       			
            }
        }
        
        stage('push image') {	
            steps {
                sh '''
                    docker login harbor.cnapcloud.com -u admin -p ${HARBOR_PASSWD}
                    make docker-build
                ''' 	 
            }
        }

        stage('deploy') {
            steps {
                sh '''
                    make update-tag
                '''         
            }
        }
    }	
}	
```

#### 주요 설정 설명

- **agent**: `label 'build'` - 7.5.6 또는 8.5.7에서 설정한 빌드 에이전트 사용
- **credentials**: GitHub 토큰과 Harbor 패스워드를 Credentials에서 가져옴
- **options**
  - `disableConcurrentBuilds()`: 동시 빌드 방지
  - `timeout`: 30분 제한
  - `buildDiscarder`: 최근 14개 빌드만 보관

#### 단계별 설명

1. **setup-github**: Git 사용자 정보 설정 및 GitHub 인증 구성
2. **build**: Gradle 또는 Maven 빌드 실행
3. **push image**: Docker 이미지 빌드 및 Harbor 레지스트리에 푸시
4. **update gitops**: GitOps 저장소의 이미지 태그 업데이트

### 11.3 필수 Credentials 설정
파이프라인 실행을 위해 다음 Credentials가 필요합니다.

#### GitHub Token (이미 설정됨)
- Section 7.3에서 설정한 `github-token` 사용

#### Harbor Password (추가 필요)
1.  **Jenkins 관리** > **Credentials** > **System** > **Global credentials (unrestricted)** 로 이동합니다.
2.  **+ Add Credentials** 를 클릭합니다.
3.  다음과 같이 설정합니다.
    - **Kind**: `Secret text`
    - **Scope**: `Global`
    - **Secret**: Harbor 관리자 비밀번호
    - **ID**: `harbor-password`
    - **Description**: `Harbor Registry Password`

### 11.4 파이프라인 테스트
1.  프로젝트에 `Jenkinsfile`, `Makefile`, `update-tag.sh`를 추가합니다.
2.  변경사항을 Git에 커밋하고 푸시합니다.
    ```bash
    git add Jenkinsfile Makefile update-tag.sh
    git commit -m "Add Jenkins pipeline configuration"
    git push origin main
    ```
3.  Jenkins에서 프로젝트를 **Scan Multibranch Pipeline Now** 를 클릭합니다.
4.  자동으로 파이프라인이 실행되는지 확인합니다.

### 11.5 파이프라인 커스터마이징 팁
#### 알림 추가
Slack이나 이메일 알림을 추가하려면 Jenkinsfile에 post 섹션을 추가합니다.

```groovy
pipeline {
    // ... existing configuration ...
    
    post {
        success {
            echo 'Pipeline succeeded!'
            // slackSend(color: 'good', message: "Build succeeded: ${env.JOB_NAME} ${env.BUILD_NUMBER}")
        }
        failure {
            echo 'Pipeline failed!'
            // slackSend(color: 'danger', message: "Build failed: ${env.JOB_NAME} ${env.BUILD_NUMBER}")
        }
    }
}
```

#### 테스트 단계 추가
> **필요 플러그인**: `JUnit Plugin`, `JaCoCo Plugin`

테스트를 실행하고 결과를 수집하면 Jenkins UI에서 테스트 트렌드와 코드 커버리지 그래프를 확인할 수 있습니다.

```groovy
stage('test') {
    steps {
        sh 'make report'
    }
    post {
        always {
            junit '**/build/test-results/**/*.xml'
            jacoco execPattern: '**/build/jacoco/*.exec'
        }
    }
}
```

#### 환경별 배포
main branch가 업데이트되는 경우에만 애플리케이션을 배포합니다.

```groovy
stage('deploy') {
    when {
        branch 'main'
    }
    steps {
        sh '''
            make update-tag
        '''
    }
}
```

---

## 12. 추가 플러그인 설치 (권장)

### 12.1 Prometheus 플러그인 설정
Jenkins 메트릭을 Prometheus로 수집하여 모니터링할 수 있습니다.

#### 12.1.1 플러그인 설치1.  **Jenkins 관리** > **Plugins** > **Available plugins** 로 이동합니다.
2.  `Prometheus metrics`와 `CloudBees Disk Usage Simple` 플러그인을 검색하여 설치합니다.
3.  설치 후 Jenkins를 재시작합니다.

#### 12.1.2 Prometheus 메트릭 설정1.  **Jenkins 관리** > **시스템** 으로 이동합니다.
2.  **Prometheus** 섹션을 찾아 다음과 같이 설정합니다.

**기본 설정:**
- **Path**: `prometheus` (기본값, 변경 가능)
  - 메트릭 엔드포인트: `https://jenkins.cnapcloud.com/prometheus`
- **Default namespace**: `cicd` (기본값)
- **Collecting metrics period in seconds**: `120` (2분마다 수집)

**인증 설정 (테스트용):**
- **Use authenticating to collect metrics**: 체크 해제 ✗
  - 또는 **Unprotected Metrics** 옵션 체크 ✓ (인증 없이 메트릭 접근 허용)

> **보안 경고**: 프로덕션 환경에서는 인증을 활성화하여 메트릭 엔드포인트를 보호하는 것을 권장합니다.

**수집 항목 설정:**
- **Collect disk usage**: 체크 ✓ (디스크 사용량 메트릭 수집)
- **Count successful builds**: 체크 ✓ (성공한 빌드 수 추적)
- **Count failed builds**: 체크 ✓ (실패한 빌드 수 추적)
- **Count builds**: 체크 ✓ (전체 빌드 수 추적)

3.  **저장** 버튼을 클릭합니다.

#### 12.1.3 메트릭 엔드포인트 확인설정 후 다음 URL에서 메트릭을 확인할 수 있습니다:
```
https://jenkins.cnapcloud.com/prometheus
```

또는 curl 명령으로 확인:
```bash
curl https://jenkins.cnapcloud.com/prometheus
```

#### 12.1.4 ServiceMonitor 설정 (Kubernetes)
4.3.3에서 설정한 `values.yaml`의 Prometheus 설정이 자동으로 ServiceMonitor 리소스를 생성합니다.

**ServiceMonitor 확인:**
```bash
kubectl get servicemonitor jenkins -n cicd
```

#### 12.1.5 주요 메트릭 예시
- `jenkins_node_online_value`: 온라인 노드 수
- `jenkins_executor_count_value`: 전체 실행기(executor) 수
- `jenkins_job_count_value`: 전체 작업 수
- `jenkins_builds_success_build_count_total`: 성공한 빌드 수
- `jenkins_builds_failed_build_count_total`: 실패한 빌드 수
- `jenkins_builds_duration_milliseconds_summary`: 빌드 소요 시간

### 12.2 기타 유용한 플러그인 목록
- **Blue Ocean**: 현대적인 UI와 파이프라인 시각화
- **CloudBees Disk Usage Simple Plugin**: 디스크 사용량 모니터링
- **Generic Webhook Trigger Plugin**: 유연한 Webhook 처리
- **Multibranch Build Strategy Extension**: 특정 폴더 변경 시에만 빌드

### 12.3 플러그인 설치 방법
1.  **Jenkins 관리** > **Plugins** > **Available plugins** 로 이동합니다.
2.  플러그인 이름으로 검색하여 설치합니다.
3.  필요한 경우 Jenkins를 재시작합니다.

---

## 13. Jenkins 설정 백업 및 복원

### 13.1 백업/복원 개요
| 백업 대상            | 포함 내용                                         | Helm 관리 시                              |
| -------------------- | ------------------------------------------------- | ----------------------------------------- |
| **Jenkins 홈 (PVC)** | Jobs, UI Credentials, 빌드 이력, plugins, secrets | 백업 필요                                 |
| **JCasC 설정**       | 시스템 설정, 인증/권한, JCasC Credentials         | `values.yaml`로 관리되어 별도 백업 불필요 |

> **⚠️ 중요**: JCasC를 Helm(`values.yaml`)으로 관리하지 않는 경우, **반드시 JCasC 설정을 먼저 백업**한 후 Jenkins 홈을 백업하세요.

### 13.2 백업
#### JCasC 설정 백업
> `values.yaml`로 JCasC를 관리하고 GitOps 저장소에 버전 관리 중이면 생략 가능

```bash
export JENKINS_URL="https://jenkins.cnapcloud.com"
export JENKINS_USER="admin"
export JENKINS_API_TOKEN="<your-api-token>"  

curl -s -u "${JENKINS_USER}:${JENKINS_API_TOKEN}" \
  "${JENKINS_URL}/configuration-as-code/export" \
  -o jenkins-casc-export.yaml
```

#### Jenkins 홈 백업
```bash
kubectl cp cicd/jenkins-0:/var/jenkins_home ./jenkins-home-backup
```

### 13.3 복원
#### Jenkins 홈 복원
```bash
# 1. Jenkins Pod 중지
kubectl scale statefulset jenkins -n cicd --replicas=0

# 2. 임시 Pod로 PVC에 데이터 복원
kubectl run jenkins-restore --rm -it --restart=Never \
  --image=busybox \
  --overrides='{"spec":{"containers":[{"name":"restore","image":"busybox","command":["sh"],"stdin":true,"tty":true,"volumeMounts":[{"name":"jenkins-home","mountPath":"/var/jenkins_home"}]}],"volumes":[{"name":"jenkins-home","persistentVolumeClaim":{"claimName":"jenkins"}}]}}' \
  -n cicd

# 3. 별도 터미널에서 백업 데이터 복사
kubectl cp ./jenkins-home-backup/. cicd/jenkins-restore:/var/jenkins_home/

# 4. 임시 Pod 종료 후 Jenkins Pod 시작
kubectl scale statefulset jenkins -n cicd --replicas=1
```

#### JCasC 설정 복원
> Helm으로 JCasC 관리 시 `make apply`로 배포하면 자동 적용되므로 생략 가능

```bash
curl -s -u "${JENKINS_USER}:${JENKINS_API_TOKEN}" \
  -X POST -H "Content-Type: text/yaml" \
  --data-binary @jenkins-casc-export.yaml \
  "${JENKINS_URL}/configuration-as-code/apply"
```

### 13.4 권장사항
- **JCasC 설정**: `values.yaml`에 정의하고 GitOps 저장소에서 버전 관리 (별도 백업 불필요)
- **Jenkins 홈**: PVC 스냅샷 또는 `kubectl cp`로 주기적 백업
- **Credentials**: JCasC + Kubernetes Secret 참조 방식 권장

---

## 14. 문제 해결 (Troubleshooting)

### 14.1 Pod Pending 상태
- **원인**: PVC가 `Bound` 되지 않았거나 리소스(CPU/Memory)가 부족합니다.
- **해결**: 
  ```bash
  kubectl describe pod <pod-name> -n cicd
  ```
  이벤트 로그를 확인하여 문제를 파악합니다.

### 14.2 Ingress 접속 불가
- **원인**: Ingress 컨트롤러 문제 또는 TLS Secret 미생성
- **해결**:
  - Ingress 컨트롤러 로그 확인
  - TLS Secret은 `security` namespace에서 생성되어 Reflector를 통해 다른 namespace로 복사됩니다:
  ```bash
  # security namespace에서 Certificate 확인
  kubectl get certificate -n security
  
  # cicd namespace에 Secret이 복사되었는지 확인
  kubectl get secret cnapcloud.com-tls -n cicd
  ```
  - Reflector 설정 확인 (Certificate에 다음 annotation이 필요):
  ```yaml
  reflector.v1.k8s.emberstack.com/reflection-allowed: "true"
  reflector.v1.k8s.emberstack.com/reflection-allowed-namespaces: "security,cicd,default,gateway,database"
  ```

### 14.3 GitHub 연결 실패
- **원인**: Personal Access Token 권한 부족 또는 만료
- **해결**
  - GitHub에서 토큰 권한 확인 (`repo`, `admin:repo_hook` 필요)
  - 토큰이 만료되지 않았는지 확인
  - Jenkins에서 **Test connection** 재시도

### 14.4 GitHub Webhook이 작동하지 않음
- **원인**: Webhook URL 오류 또는 네트워크 문제
- **해결**
  - GitHub Webhook 설정에서 `Recent Deliveries` 확인
  - Jenkins가 외부에서 접근 가능한지 확인
  - Jenkins 로그 확인:
    ```bash
    kubectl logs -n cicd <jenkins-pod-name>
    ```

### 14.5 빌드 에이전트 Pod 생성 실패
- **원인**: 이미지 Pull 실패 또는 리소스 부족
- **해결**
  - Kubernetes Events 확인:
    ```bash
    kubectl get events -n cicd --sort-by='.lastTimestamp'
    ```
  - 이미지 저장소 접근 권한 확인
  - 노드 리소스 확인

### 14.6 GitLab 연결 실패
- **원인**: Access Token 권한 부족 또는 만료
- **해결**
  - GitLab에서 토큰 권한 확인 (`api`, `read_repository`, `write_repository` 필요)
  - 토큰이 만료되지 않았는지 확인
  - Jenkins에서 GitLab 서버 연결 테스트 재시도

### 14.7 GitLab Webhook이 작동하지 않음
- **원인**: Webhook URL 오류, 네트워크 문제 또는 Outbound requests 미허용
- **해결**
  - GitLab Integration 설정에서 **Test settings** 확인
  - GitLab Admin > Settings > Network에서 Outbound requests 허용 확인
  - Jenkins가 GitLab에서 접근 가능한지 확인 (내부 네트워크의 경우)
  - Jenkins 로그 확인:
    ```bash
    kubectl logs -n cicd <jenkins-pod-name>
    ```

### 14.8 OIDC 로그인 실패
- **원인**: Keycloak 설정 오류 또는 네트워크 문제
- **해결**
  - Keycloak의 Well-known endpoint가 Jenkins에서 접근 가능한지 확인:
    ```bash
    curl https://keycloak.cnapcloud.com/realms/cnap/.well-known/openid-configuration
    ```
  - Jenkins 로그 확인:
    ```bash
    kubectl logs -n cicd <jenkins-pod-name>
    ```
  - Keycloak 클라이언트 설정에서 Redirect URI가 정확한지 확인
  - Client Secret이 올바르게 입력되었는지 확인
  - 기본 admin 계정으로 로그인하여 설정 재확인: `https://jenkins.cnapcloud.com/login`

---

## 15. 참고 정보

### 15.1 Jenkins API Token 사용
Jenkins API를 통해 자동화 작업을 수행할 수 있습니다.

**API Token 생성:**
1. Jenkins UI 우측 상단 사용자 아이콘 선택
2. **Security** 메뉴로 이동
3. **API Token** 섹션에서 **Add new Token** 클릭
4. 토큰 이름 입력 후 **Generate**
5. 생성된 토큰을 안전한 곳에 복사

**API 사용 예시:**
```bash
curl -u admin:11bda33d8407****************58762 \
  https://jenkins.cnapcloud.com/whoAmI/api/json
```

### 15.2 참고 자료- [Jenkins 공식 문서](https://www.jenkins.io/doc/)
- [Jenkins Kubernetes Plugin](https://plugins.jenkins.io/kubernetes/)
- [GitHub Branch Source Plugin](https://plugins.jenkins.io/github-branch-source/)
- [GitLab Branch Source Plugin](https://plugins.jenkins.io/gitlab-branch-source/)
- [Jenkins Helm Chart](https://github.com/jenkinsci/helm-charts)
