---
title: "개발자 가이드"
sidebar_position: 4
---

> Keycloak Extension SPI 기능 추가 및 유지 보수를 위한 개발자 가이드

---

## 1. 프로젝트 개요

### 기본 정보

| 항목 | 값 |
|------|-----|
| Group ID | `com.keycloak.extensions` |
| Artifact ID | `keycloak-extensions-spi` |
| Version | `1.0.0-SNAPSHOT` |
| Java | 17 |
| Keycloak | 26.5.2 |
| Packaging | JAR (단일 모듈) |
| 테마 이름 | `keycloak.ext` (login, email 타입) |

### 의존성

| 라이브러리 | 스코프 | 용도 |
|-----------|--------|------|
| `keycloak-server-spi` | provided | SPI 인터페이스 |
| `keycloak-server-spi-private` | provided | 내부 SPI 인터페이스 |
| `keycloak-services` | provided | Keycloak 서비스 레이어 |
| `keycloak-themes` | provided | 테마 리소스 |
| `keycloak-model-infinispan` | provided | 분산 캐시 모델 |
| `keycloak-crypto-default` | compile | 암호화 기본 구현 |
| `lombok` | provided | 보일러플레이트 제거 |

### 등록된 SPI Provider

SPI 등록은 `src/main/resources/META-INF/services/` 하위 파일로 관리된다.

| SPI 인터페이스 | 등록된 Factory |
|--------------|--------------|
| `AuthenticatorFactory` | `OtpAuthenticatorFactory` |
| | `ConditionalOtpAuthenticatorFactory` |
| | `PasswordResetAuthenticatorFactory` |
| | `TermsConsentAuthenticatorFactory` |
| | `DormantAccountAuthenticatorFactory` |
| `RequiredActionFactory` | `TermsConsentFactory` |
| | `AccountReactivationFactory` |
| `SocialIdentityProviderFactory` | `KakaoIdentityProviderFactory` |
| | `NaverIdentityProviderFactory` |
| `IdentityProviderFactory` | `InicisIdentityProviderFactory` |
| `EventListenerProviderFactory` | `LastLoginEventListenerFactory` |
| `RealmResourceProviderFactory` | `UsernameFindResourceProviderFactory` |
| | `MyResourceProviderFactory` |
| | `RegistrationVerifyResourceProviderFactory` |
| | `UserProfileResourceFactory` |
| | `ProfilePageResourceFactory` |
| | `RateLimitAdminResourceFactory` |
| `UserStorageProviderFactory` | `UserProviderFactory` |
| | `DormantAccountScheduledTask` |

---

## 2. 개발 환경 설정

### 빌드

```bash
# 전체 빌드 (Tailwind CSS 포함)
mvn clean package -Dmaven.test.skip=true

# CSS 변경만 있을 때
npm run build        # 1회 빌드
npm run dev          # watch 모드
```

Maven 빌드 시 `frontend-maven-plugin`이 Node v20.11.0을 자동 설치하고
`npm run build`를 실행하여 `output.css`를 생성한다.

### Docker Compose

> 모든 `docker compose` 명령은 `docker/` 디렉토리에서 실행한다.

| 서비스 | 포트 | 용도 |
|--------|------|------|
| `keycloak` | 8080 | Keycloak 서버 |
| `keycloak` | 8000 | Remote Debug (JDWP) |
| `postgres_db` | 5432 | PostgreSQL 16 |
| `mailhog` | 8025 | 이메일 수신 Web UI |
| `mailhog` | 1025 | SMTP 수신 |

```bash
# 시작
cd docker && docker compose up -d

# 로그 확인
docker compose logs -f keycloak

# 코드 변경 후 재시작
cd .. && mvn clean package -Dmaven.test.skip=true
cd docker && docker compose restart keycloak

# 정지
docker compose down
```

**Admin 콘솔 접속**
- URL: `http://localhost:8080/admin`
- 계정: `admin` / `eX4mP13p455w0Rd`

**MailHog (이메일 확인)**
- URL: `http://localhost:8025`

### Hot Reload

`compose.yaml`에서 `KC_SPI_DEPLOYMENTS_SCANNER_ENABLED: true`로 변경하면
`target/` 디렉토리를 10초 간격으로 스캔하여 JAR 변경을 자동 감지한다.
(기본값 `false` — 운영 안정성을 위해 개발 시에만 활성화)

```yaml
KC_SPI_DEPLOYMENTS_SCANNER_ENABLED: true
KC_SPI_DEPLOYMENTS_SCANNER_INTERVAL: 10
```

### Remote Debug

`compose.yaml`의 `JAVA_OPTS` 라인 주석을 해제하면 포트 8000으로 디버그 연결이 가능하다.

```yaml
JAVA_OPTS: -Xms1024m -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=*:8000
```

IDE에서 Remote JVM Debug 설정 → host: `localhost`, port: `8000`

### 새 Realm HTTP 접속

Docker Desktop 4.67.0 이상에서는 Mac host → container 연결의 실제 TCP source IP가
`172.64.66.1` (Docker Desktop 내부 포트 포워딩 프록시 IP)로 고정된다.
Keycloak realm의 `sslRequired` 기본값은 `external`이므로,
새 realm을 생성하면 `localhost:8080`으로 접근해도 `ssl_required` 오류가 발생한다.

`compose.yaml`의 `keycloak-cli` 컨테이너가 시작 시 자동으로 처리한다.

```yaml
keycloak-cli:
  command:
    - sh
    - -c
    - |
      kcadm.sh update realms/master -s sslRequired=none
      kcadm.sh update realms/cnap -s sslRequired=none   # realm 추가 시 여기에 추가
```

새 realm을 추가할 경우 위 명령에 해당 realm의 `sslRequired=none` 줄을 추가한다.

수동으로 설정하는 방법은 두 가지다.

Admin Console에서 변경 (`master` realm은 이미 `none`이므로 로그인 가능):

1. `http://localhost:8080/admin` 접속
2. 좌측 상단 realm 드롭다운 → 대상 realm 선택
3. Realm settings → General → Require SSL → `None` 선택 → Save

`keycloak-cli` 컨테이너로 변경 (Admin Console 접근이 불가한 경우):

`compose.yaml`의 `keycloak-cli` 명령에 해당 realm을 추가한 뒤 실행한다.

```bash
docker compose run --rm keycloak-cli
```

---

## 3. SPI 아키텍처 개요

### Factory → Provider 패턴

Keycloak SPI는 **Factory**가 **Provider** 인스턴스를 생성하는 패턴으로 동작한다.

```
META-INF/services/{SPI 인터페이스}   ← Keycloak이 Factory를 탐색
        ↓
XxxFactory.create()                  ← 요청마다 Provider 인스턴스 생성
        ↓
XxxProvider (실제 로직 구현)
```

- **Factory**: `getId()`, `create()`, `getConfigProperties()` 구현 — Keycloak Admin에서 설정 UI 제공
- **Provider**: 실제 인증/처리 로직 구현, 요청 scope로 생성됨

### 패키지 구조

```
src/main/java/com/keycloak/
├── account/
│   ├── dormancy/           # 계정 휴면 (4.7)
│   │   ├── action/         # AccountReactivationRequiredAction
│   │   ├── authenticator/  # DormantAccountAuthenticator
│   │   ├── listener/       # LastLoginEventListener
│   │   └── scheduler/      # DormantAccountScheduledTask, Config, Service
│   ├── profile/            # 프로파일 관리 REST (5)
│   └── registration/       # 회원가입 (4.4)
│       ├── validator/      # RegistrationUserValidation
│       └── verify/         # RegistrationVerifyResource
├── api/                    # MyResourceProvider (6)
├── authentication/
│   ├── idp/                # 외부 로그인 IDP (4.6)
│   │   ├── core/           # AbstractSocialIdentityProvider
│   │   ├── kakao/
│   │   ├── naver/
│   │   └── inicis/
│   ├── otp/                # OTP 인증 (4.2)
│   ├── recovery/           # 아이디·비밀번호 찾기 (4.5)
│   │   ├── password/       # PasswordResetAuthenticator
│   │   └── username/       # UsernameFindResource
│   └── terms/              # 이용약관 동의 (4.3)
├── common/
│   ├── otp/                # OTP 코드 생성·검증 서비스
│   ├── sms/                # SMS 발송 서비스 (연동 포인트)
│   └── util/               # 공통 유틸 (masking, phone, validation, codes)
└── userstorage/            # User Federation (4.8)
    ├── adapter/            # UserAdapter
    └── client/             # 외부 저장소 HTTP 클라이언트
```

### SPI 등록 방식

`src/main/resources/META-INF/services/` 디렉토리에 SPI 인터페이스명으로 파일을 생성하고,
구현체의 완전한 클래스명을 한 줄씩 기재한다.

```
META-INF/services/
├── org.keycloak.authentication.AuthenticatorFactory      ← Authenticator 등록
├── org.keycloak.authentication.RequiredActionFactory     ← Required Action 등록
├── org.keycloak.broker.social.SocialIdentityProviderFactory  ← 소셜 IDP 등록
├── org.keycloak.broker.provider.IdentityProviderFactory  ← 일반 IDP 등록
├── org.keycloak.events.EventListenerProviderFactory      ← 이벤트 리스너 등록
├── org.keycloak.services.resource.RealmResourceProviderFactory  ← REST API 등록
├── org.keycloak.storage.UserStorageProviderFactory       ← User Federation 등록
└── ...
```

신규 SPI 추가 시: ① Factory/Provider 클래스 작성 → ② 해당 services 파일에 클래스명 추가 → ③ 빌드 후 재시작

### 공통 유틸리티

| 패키지 | 클래스 | 역할 |
|--------|--------|------|
| `common/otp` | `OtpService` | OTP 코드 생성·저장·검증, TTL 관리 |
| `common/sms` | `SmsService` | SMS 발송 외부 연동 (구현체 교체 포인트) |
| `common/util` | `MaskingUtil` | 개인정보 마스킹 |
| `common/util` | `PhoneUtil` | 휴대폰 번호 정규화 |
| `common/util` | `ValidationUtil` | 입력값 검증 |
| `common/util` | `OtpConstants` | 코드 길이(6자리), TTL(300초) 상수 정의 |

---

## 4. 기능 영역별 구조

### 4.1 인증 플로우 (Authentication Flow)

Keycloak Admin Console → Authentication → Flows 에서 플로우를 구성한다.
각 Authenticator는 `Required / Alternative / Conditional / Disabled` 중 하나로 설정된다.

#### 로그인 플로우 (Browser OTP)

| 순서 | Authenticator | 역할 |
|------|--------------|------|
| 1 | `DormantAccountAuthenticator` | 휴면 상태 감지 → Required Action 추가 |
| 2 | Cookie / Kerberos | 기존 세션 처리 (기본 Keycloak) |
| 3 | Username Form | 아이디 입력 |
| 4 | Password Form | 비밀번호 입력 |
| 5 | `OtpAuthenticator` 또는 `ConditionalOtpAuthenticator` | OTP 인증 코드 발송·검증 |

#### 회원가입 플로우 (Registration Term)

| 순서 | Authenticator | 역할 |
|------|--------------|------|
| 1 | `TermsConsentAuthenticator` | 이용약관 동의 |
| 2 | Registration (기본) | 사용자 정보 입력 |
| 3 | `RegistrationUserValidation` | 이메일/전화 인증 완료 검증 |

#### 비밀번호 재설정 플로우 (Reset Credentials OTP)

| 순서 | Authenticator | 역할 |
|------|--------------|------|
| 1 | `PasswordResetAuthenticator` | 코드 발송·검증·비밀번호 변경 |

#### 플로우 변경 시 주의사항

- Authenticator 순서 변경 시 인증 세션 노트(auth session notes) 의존성 확인
- 새 Authenticator 추가 후 반드시 services 파일 등록 → 빌드 → Keycloak 재시작
- 기존 플로우를 직접 수정하지 않고 **복사 후 수정** 권장 (Admin Console → Duplicate)

---

### 4.2 OTP 인증

#### 클래스 구조

```
OtpAuthenticatorFactory (PROVIDER_ID: "otp-authenticator")
ConditionalOtpAuthenticatorFactory (PROVIDER_ID: "conditional-otp-authenticator")
  └── OtpAuthenticatorFactory 상속 + 조건부 skip/force 설정 추가
        └── OtpAuthenticator (실제 인증 로직)
              └── OtpService
                    ├── CacheCodeStorage   (코드 저장 - Infinispan)
                    ├── EmailDeliveryService
                    └── SmsDeliveryService  ← 외부 SMS API 연동 포인트
```

#### OTP 전달 전략 (Admin Console에서 설정)

| 전략 | 동작 |
|------|------|
| `STRATEGY_CONFIG_ONLY` | Factory 설정의 delivery method(SMS/EMAIL) 고정 사용 |
| `STRATEGY_USER_ATTRIBUTE` | 사용자 속성 `otpMethod` 값 참조 (SMS/EMAIL/SKIP) |
| `STRATEGY_USER_CHOICE` | 로그인 시 사용자가 직접 선택 |

#### ConditionalOtpAuthenticator 조건 설정

| 설정 | 동작 |
|------|------|
| Skip OTP for Role | 특정 역할 보유 시 OTP 건너뜀 |
| Force OTP for Role | 특정 역할 보유 시 OTP 강제 |
| Skip/Force OTP for HTTP Header | 헤더 패턴 매칭으로 제어 |
| Fallback OTP Handling | 조건 미충족 시 SKIP 또는 FORCE |

#### 코드 길이 / TTL 변경

`common/util/OtpConstants.java` 에서 상수 수정:
- 코드 길이: 6자리
- TTL: 300초 (기본값)

#### SMS 발송 연동 포인트

`common/sms/SmsDeliveryService` — SMS API URL, 발신 키, 발신자 번호는
Admin Console → Authentication → OTP Authenticator 설정에서 관리한다.
SMS 실패 시 이메일로 자동 폴백된다.

---

### 4.3 이용약관 동의

#### 동작 흐름

`TermsConsentAuthenticator.authenticate()` → `terms-consent.ftl` 렌더링
→ `action()` → 필수 항목 검증 → 선택 항목 저장 → 인증 세션 노트에 완료 마킹

#### 동의 항목 처리

| 항목 | 폼 필드명 | 구분 | 저장 위치 |
|------|-----------|------|-----------|
| 서비스 이용약관 | `termsAccepted` | 필수 | 인증 세션 노트 |
| 만 14세 이상 | `ageConsent` | 필수 | 인증 세션 노트 |
| 개인정보 수집(필수) | `privacyRequired` | 필수 | 인증 세션 노트 |
| 개인정보 수집(선택) | `privacyOptional` | 선택 | 사용자 속성 |
| 마케팅 수신 동의 | `marketingConsent` | 선택 | 사용자 속성 |
| 마케팅 이메일 | `marketingEmail` | 선택 | 사용자 속성 |
| 마케팅 SMS | `marketingSMS` | 선택 | 사용자 속성 |
| 마케팅 푸시 | `marketingPush` | 선택 | 사용자 속성 |

#### 항목 추가/제거 포인트

`TermsConsentAuthenticator.action()` 내 두 영역을 수정:
1. **필수 항목 검증**: `if (formData.getFirst("항목명") == null)` 블록 추가
2. **선택 항목 저장**: `user.setSingleAttribute("속성명", value)` 추가

FTL 반영: `terms-consent.ftl` (theme-resources/templates/)에 체크박스 추가

#### Required Action 연동

`TermsConsentFactory` (RequiredActionFactory)로도 등록되어 있어,
기존 사용자에게 약관 재동의를 Required Action으로 부여할 수 있다.

---

### 4.4 회원가입

#### 구성 요소

| 클래스 | 역할 |
|--------|------|
| `TermsConsentAuthenticator` | 1단계: 이용약관 동의 |
| `RegistrationUserValidation` | 2단계: 입력값 검증 (FormAction) |
| `RegistrationVerifyResource` | 사전 이메일/SMS 인증 REST API |

#### RegistrationUserValidation 검증 로직

- 이메일·휴대폰 번호 중복 확인 (현재 사용자 제외)
- 인증 세션 노트 `verified_email` / `verified_phone` 존재 여부 확인
  → 미인증 시 폼 에러 반환
- 휴대폰 번호 정규화 (`normalizePhone()`) — 비숫자 제거

#### 인증 코드 REST API (`/realms/{realm}/registration-verify/`)

| 엔드포인트 | 설명 |
|------------|------|
| `POST /send-code` | 이메일 또는 SMS 인증 코드 발송 |
| `POST /verify-code` | 인증 코드 확인 → 세션 노트 저장 |

- Rate limit: 30분 내 최대 5회 (RateLimitService)
- 코드 TTL: 300초

#### OTP 수단 선택 저장

가입 폼의 `otpMethod` 필드(SMS/EMAIL/SKIP) 값이
`RegistrationUserValidation`에서 사용자 속성 `otpMethod`로 저장된다.
이 값은 이후 로그인 시 `ConditionalOtpAuthenticator`의 `STRATEGY_USER_ATTRIBUTE`가 참조한다.

---

### 4.5 아이디 · 비밀번호 찾기

#### 비밀번호 재설정 (`PasswordResetAuthenticator`)

단일 Authenticator가 멀티 스텝 플로우를 action 파라미터로 분기 처리한다.

| action 파라미터 | 처리 메서드 | 동작 |
|----------------|------------|------|
| `sendCode` | `handleSendCode()` | 사용자 조회 → 속도 제한 확인 → OtpService로 코드 발송 |
| `verifyCode` | `handleVerifyCode()` | 코드 형식 검증 → OTP 일치 확인 |
| `resendCode` | `handleResendCode()` | 속도 제한 확인 → 재발송 |

- 사용자 조회: 아이디·이메일·휴대폰 번호 모두 지원
- 휴대폰 번호 매칭: `+82` 국가코드 변환 처리 포함
- 속도 제한: 30분 내 최대 5회 (`RateLimitService`)
- 코드 TTL: `VerificationCodeGenerator.CODE_LIFESPAN_SECONDS`
- FTL: `theme-resources/templates/login-reset-password-otp.ftl`

#### 아이디 찾기 (`UsernameFindResource`)

REST API 방식으로 구현 (`/realms/{realm}/username-find/`).
이메일 또는 휴대폰 번호 인증 후 마스킹된 아이디를 반환한다.
FTL: `theme-resources/templates/username-find.ftl`

---

### 4.6 외부 로그인 (Identity Provider)

#### 클래스 계층

```
AbstractSocialIdentityProvider<C>  (core/)
  ├── KakaoIdentityProvider        (SocialIdentityProviderFactory 등록)
  └── NaverIdentityProvider        (SocialIdentityProviderFactory 등록)

AbstractIdentityProviderFactory
  └── InicisIdentityProvider       (IdentityProviderFactory 등록 — 소셜 아님)
```

#### AbstractSocialIdentityProvider 핵심 동작

- `doGetFederatedIdentity(accessToken)`: Bearer 토큰으로 프로필 API 호출 → 이메일 기반으로 Keycloak 사용자 조회 (이메일이 없으면 오류)
- `updateBrokeredUser()`: 이름·이메일·`phoneNumber`·`otpMethod` 속성 동기화
- Inner class `SocialEndpoint`: OAuth2 콜백 처리 (state 검증 → code 교환 → 사용자 조회)

#### 소셜 IDP 비교

| 항목 | 카카오 | 네이버 |
|------|--------|--------|
| PROVIDER_ID | `kakao` | `naver` |
| OpenID Connect | ON (profile_nickname, profile_image) | OFF |
| Redirect URI | `/realms/{realm}/broker/kakao/endpoint` | `/realms/{realm}/broker/naver/endpoint` |

#### Inicis IDP (간편인증 목업)

- `PROVIDER_ID`: `kg-inicis`
- `SocialIdentityProviderFactory` 미구현 → `IdentityProviderFactory`로만 등록
- OAuth2 방식이 아닌 가맹점 자격증명(MID, API Key) 기반
- 신규 통신사/인증기관 연동 시 이 구조를 참고하여 확장

#### 신규 IDP 추가 방법

1. `AbstractSocialIdentityProvider` 상속 → `extractUserProfile()` 등 구현
2. Factory 클래스 작성 (`PROVIDER_ID`, `getName()`, `getConfigProperties()`)
3. 소셜이면 `META-INF/services/org.keycloak.broker.social.SocialIdentityProviderFactory`에 등록
   일반이면 `org.keycloak.broker.provider.IdentityProviderFactory`에 등록
4. 필요시 `UserAttributeMapper` 추가 → `org.keycloak.broker.provider.IdentityProviderMapper`에 등록
5. Admin Console → Identity Providers에서 Client ID/Secret·Redirect URI 설정

---

### 4.7 계정 휴면 관리

#### 컴포넌트 역할

| 클래스 | 역할 |
|--------|------|
| `LastLoginEventListener` | 로그인 성공 이벤트 수신 → `lastLoginDate` 갱신, 휴면 속성 초기화 |
| `DormantAccountScheduledTask` | 스케줄 실행 → 미접속 계정 탐색 → 상태 전이 및 이메일 발송 |
| `DormantAccountConfig` | User Federation ComponentModel에서 설정값 로딩 |
| `DormantAccountAuthenticator` | 로그인 시 `dormantStatus` 확인 → Required Action 등록 |
| `AccountReactivationRequiredAction` | 6자리 토큰 발급·이메일 발송·검증·계정 복원 |

#### 계정 상태 전이

```
ACTIVE
  └─(미접속 365일)──→ DORMANT          ← 사전 안내: 30일 전
        └─(추가 미접속 90일)──→ PENDING_DELETE  ← 삭제 안내: 30일 전
              └─(기간 초과)──→ 영구 삭제
```

#### 설정값 변경 위치

Admin Console → User Federation → 해당 Federation 클릭 → 설정 탭

| 설정 키 | 기본값 | 설명 |
|---------|--------|------|
| `dormantPeriodDays` | 365 | 휴면 전환 기준 일수 |
| `warningPeriodDays` | 30 | 휴면 사전 안내 일수 |
| `deleteEnabled` | false | 계정 삭제 기능 활성화 |
| `deletePeriodDays` | 90 | 삭제 기준 일수 (휴면 이후) |
| `deletionWarningPeriodDays` | 30 | 삭제 사전 안내 일수 |

#### 이메일 템플릿 연결

| 이벤트 | 템플릿 |
|--------|--------|
| 휴면 전환 사전 안내 | `html/account-dormant-notification.ftl` |
| 재활성화 코드 발송 | `html/account-reactivation-email.ftl` |
| 재활성화 완료 확인 | `html/account-reactivation-confirmation.ftl` |
| 삭제 예정 안내 | `html/account-deletion-warning.ftl` |

#### 재활성화 토큰

`AccountReactivationRequiredAction`: 6자리 숫자 (`%06d`, 범위 100000~999999)
유효시간: 1시간 (`reactivationTokenExpiry` 속성)

---

### 4.8 User Storage Federation

#### 구성

| 클래스 | 역할 |
|--------|------|
| `UserProviderFactory` | PROVIDER_ID: `REST` — Factory 등록, 설정 검증 |
| `UserProvider` | UserStorageProvider 구현 — 외부 REST API로 사용자 조회/인증 |
| `UserAdapter` | Keycloak `UserModel` 래핑 — 외부 사용자 데이터를 Keycloak 인터페이스로 제공 |
| HTTP Client | `userstorage/client/` — 외부 저장소 API 호출 (Basic Auth) |

#### Admin Console 설정 항목

| 항목 | 설명 |
|------|------|
| Base URL | 외부 사용자 저장소 REST API 기본 URL |
| Username | Basic Auth 사용자명 |
| Password | Basic Auth 비밀번호 |
| Sync Enabled | 동기화 활성화 여부 |
| Import Enabled | Keycloak 로컬 DB에 사용자 임포트 여부 |

#### 동기화

`sync()` / `syncSince()` 는 현재 `SynchronizationResult.ignored()` 반환 (미구현 상태).
외부 저장소 동기화가 필요한 경우 이 메서드를 구현한다.

---

## 5. 테마 및 FTL 템플릿

### 템플릿 경로와 로딩 방식

이 프로젝트에는 FTL 템플릿이 놓이는 경로가 두 곳이며, 로딩 주체가 완전히 다르다.

| 경로 | 로딩 주체 | 역할 |
|------|-----------|------|
| `theme/keycloak.ext/login/` | Keycloak 테마 엔진 (자동) | Keycloak 기본 화면 오버라이드 |
| `theme-resources/templates/` | 이 SPI의 Java 코드 (명시적) | 이 SPI가 새로 만든 커스텀 화면 |

**`theme/keycloak.ext/login/`**

Realm에 `keycloak.ext` 테마가 설정되면 Keycloak이 `JarThemeProvider`를 통해
`theme/keycloak.ext/login/` 경로를 자동으로 탐색한다.
Keycloak 내장 로그인 플로우(login, register 등)가 렌더링할 파일을 이 경로에서 찾으며,
없으면 부모 테마(`keycloak` base)로 폴백한다.
이 경로의 파일은 기존 Keycloak 화면을 교체(override)하는 용도이므로
파일명이 Keycloak 표준 파일명과 일치해야 한다.

**`theme-resources/templates/`**

`ThemeResourceProvider` SPI가 담당하는 경로로, Keycloak 테마 엔진의 자동 탐색 대상이 아니다.
이 SPI의 Authenticator/RequiredAction이 `context.form().createForm("파일명.ftl")`으로
명시적으로 호출할 때만 렌더링된다.
Keycloak에 없는 새 화면(약관 동의, 휴면 재활성화 등)은 모두 이 경로에 추가한다.

신규 화면은 반드시 `theme-resources/templates/`에 추가한다.
`theme/keycloak.ext/login/`에 넣어도 Keycloak 내장 플로우가 자동으로 연결하지 않으므로
Java 코드 없이는 렌더링되지 않는다.

### 테마 구조

| 경로 | 용도 |
|------|------|
| `theme/keycloak.ext/login/` | 로그인 플로우 FTL (Keycloak 기본 템플릿 오버라이드) |
| `theme/keycloak.ext/email/` | 이메일 텍스트 번들 |
| `theme-resources/templates/` | 커스텀 SPI에서 사용하는 FTL (createForm()으로 지정) |
| `theme-resources/templates/html/` | HTML 이메일 템플릿 |

### 주요 FTL 파일

**로그인 테마** (`theme/keycloak.ext/login/`)

| 파일 | 용도 |
|------|------|
| `template.ftl` | 공통 레이아웃 (cardClass 파라미터로 너비 제어) |
| `login.ftl` | 로그인 폼 |
| `register.ftl` | 회원가입 폼 |
| `login-otp.ftl` | OTP 코드 입력 |
| `login-reset-password.ftl` | 비밀번호 재설정 진입 |
| `terms.ftl` | 이용약관 동의 |

**커스텀 SPI 템플릿** (`theme-resources/templates/`)

| 파일 | 용도 |
|------|------|
| `terms-consent.ftl` | 이용약관 동의 (TermsConsentAuthenticator) |
| `login-reset-password-otp.ftl` | 비밀번호 재설정 OTP (PasswordResetAuthenticator) |
| `account-reactivation.ftl` | 휴면 재활성화 코드 입력 |
| `username-find.ftl` | 아이디 찾기 |

### Tailwind CSS 빌드 흐름

```
input.css  →  (tailwindcss)  →  output.css  →  JAR 패키징
```

- `input.css`: Tailwind 지시자 + 커스텀 컴포넌트 (`@layer components`)
- `output.css`: minified CSS (~13KB), FTL에서 `<link>` 로드
- Maven 빌드 시 자동 실행, CSS 단독 변경은 `npm run build`

**CSS 변경 시 캐시 무효화**

`template.ftl`은 CSS URL에 `?v={themeVersion}` 쿼리스트링을 붙여 브라우저 캐시를 제어한다.
CSS를 변경할 때마다 `theme.properties`의 `themeVersion` 값을 올려야 브라우저가 새 파일을 요청한다.

```properties
# theme/keycloak.ext/login/theme.properties
themeVersion=@theme.css.version@
```
themeVersion은 mvn package 빌드 시 output.css의 SHA-1 해시로 자동 치환됩니다.
- maven-antrun-plugin → output.css SHA-1 계산
- maven-resources-plugin → @theme.css.version@ 치환
- CSS 변경 → SHA-1 변경 → 브라우저 캐시 자동 무효화
  
따라서 CSS 변경 시 themeVersion을 수동으로 변경할 필요가 없습니다.
빌드 후 실제 값은 다음 파일에서 확인할 수 있습니다.
target/classes/theme/keycloak.ext/login/theme.properties

**커스텀 CSS 클래스** (`input.css` `@layer components` 정의)

| 클래스 | 용도 |
|--------|------|
| `.kc-container` | 로그인 컨테이너 전체 래퍼 |
| `.kc-card` | 로그인 카드 박스 |
| `.kc-input` | 입력 필드 |
| `.kc-btn-primary` | 주요 버튼 |
| `.kc-label` | 라벨 |
| `.kc-error` | 에러 메시지 |

### 신규 FTL 추가 방법

1. `theme-resources/templates/`에 FTL 파일 작성
2. Authenticator에서 `context.form().createForm("파일명.ftl")` 호출
3. 필요한 변수는 `context.form().setAttribute("키", 값)` 으로 전달
4. 메시지 키는 `theme/keycloak.ext/login/messages/messages_ko.properties`에 추가

### 메시지 번들

`theme/keycloak.ext/login/messages/messages_ko.properties` —
FTL에서 `${msg("키")}` 또는 `${msg("키", 파라미터)}` 로 참조

---

## 6. REST API 엔드포인트

모든 커스텀 REST API는 `RealmResourceProvider` SPI로 등록되어
`/realms/{realm}/` 하위 경로에 노출된다.

### 등록된 엔드포인트

| Base Path | Factory | 용도 |
|-----------|---------|------|
| `/my-rest-resource/` | `MyResourceProviderFactory` | 범용 테스트/유틸 API |
| `/registration-verify/` | `RegistrationVerifyResourceProviderFactory` | 회원가입 인증 코드 |
| `/username-find/` | `UsernameFindResourceProviderFactory` | 아이디 찾기 |
| (프로파일 관련) | `UserProfileResourceFactory` | 사용자 프로파일 API |
| (프로파일 페이지) | `ProfilePageResourceFactory` | 프로파일 페이지 |
| `/rate-limit-admin/` | `RateLimitAdminResourceFactory` | Rate limit 잠금 조회/해제 (admin 전용) |

### 주요 API 상세

**MyResourceProvider**

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/hello` | 없음 | Realm 이름 반환 |
| GET | `/hello-auth` | Bearer 토큰 | 인증된 사용자명 반환 |
| GET | `/user?username=&password=` | 없음 | 자격증명 검증 |

**RegistrationVerifyResource**

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/send-code` | 이메일/SMS 인증 코드 발송 |
| POST | `/verify-code` | 인증 코드 검증 |

제한: 30분 내 최대 5회, TTL 300초

**RateLimitAdminResource**

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| GET | `/locked` | Bearer 토큰 + realm-management `manage-users` role | 현재 realm에서 락 걸린 항목 목록 |
| POST | `/reset` | 위와 동일 | `{"type": "pwreset\|register\|userfind\|profile", "identifier": ...}`로 특정 항목 해제 |

`type`이 `pwreset`/`profile`이면 `identifier`는 username(내부에서 userId로 변환).
`register`/`userfind`면 `identifier`는 email 또는 전화번호 원본값.

호출 계정은 master가 아니라 **대상 realm(cnap 등)에 속한 사용자**여야 한다.

호출 시 토큰은 반드시 **대상 realm(cnap 등)에서 직접 발급받은 토큰**이어야 한다.
master realm 토큰은 issuer가 달라 401이 난다(Admin REST API와 달리 이 SPI 엔드포인트는
master realm 관리자의 cross-realm 권한을 인식하지 않는다).

토큰에 role이 실리려면 두 가지가 모두 되어 있어야 한다:

1. 호출 계정에 `realm-management`의 `manage-users` client role이 assign 되어 있을 것
2. 클라이언트(admin-cli 등)가 `client.use.lightweight.access.token.enabled=true`인 경우,
   `roles` client scope의 `client roles` 매퍼에서 "Add to lightweight access token"도 켜져
   있을 것 -- 1번만 되어 있으면 role은 있어도 실제 발급 토큰에는 안 실려서 403이 난다.

**테스트 스크립트**

```bash
KC_URL=http://localhost:8080
KC_REALM=cnap
KC_ADMIN=admin
KC_ADMIN_PW=password

TOKEN=$(curl -s -X POST $KC_URL/realms/$KC_REALM/protocol/openid-connect/token \
  -d "client_id=admin-cli&grant_type=password&username=$KC_ADMIN&password=$KC_ADMIN_PW" \
  | jq -r '.access_token')

# 잠긴 항목 목록
curl -s $KC_URL/realms/$KC_REALM/rate-limit-admin/locked \
  -H "Authorization: Bearer $TOKEN" | jq .

# 특정 항목 해제
curl -s -X POST $KC_URL/realms/$KC_REALM/rate-limit-admin/reset \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"profile","identifier":"admin"}'
```

여러 줄로 나눠서 실행할 때 `\` 뒤에 공백이 섞이면(특히 터미널에 붙여넣기 시) zsh가
줄바꿈 이어붙이기로 인식하지 못해 명령이 중간에 끊기고 아무 응답도 없이 종료될 수 있다.
응답이 비어있으면 `-w "\nHTTP_STATUS:%{http_code}\n"`를 붙여 실제로 요청이 갔는지부터 확인한다.

### Bearer 토큰 인증 처리

```java
AccessToken token = authManager.verifyBearerToken(session);
if (token == null) return Response.status(401).build();
```

### 신규 REST 엔드포인트 추가 방법

1. `RealmResourceProvider` 구현 클래스 작성 (`getResource()` → JAX-RS 리소스 반환)
2. `RealmResourceProviderFactory` 구현 (`getId()`, `create()`)
3. `META-INF/services/org.keycloak.services.resource.RealmResourceProviderFactory`에 Factory 클래스명 추가
4. 빌드 후 재시작 → `/realms/{realm}/{getId()}` 경로로 접근 가능

---

## 7. 배포 및 운영

### JAR 배포

```bash
mvn clean package -Dmaven.test.skip=true
cp target/keycloak-extensions-spi-1.0.0-SNAPSHOT.jar /opt/keycloak/providers/
/opt/keycloak/bin/kc.sh build   # 운영환경에서 최초 1회
/opt/keycloak/bin/kc.sh start   # 또는 start-dev (개발)
```

Docker 환경에서는 `target/` 디렉토리가 `/opt/keycloak/providers/`에 볼륨 마운트되어
빌드 후 재시작만으로 적용된다.

### Admin Console 초기 설정 순서

1. **Realm 생성**: `cnap` Realm 생성
2. **테마 적용**: Realm Settings → Themes → `keycloak.ext`
3. **이벤트 리스너 등록**: Realm Settings → Events → Event listeners → `last-login-event-listener`
4. **Authentication Flow 구성**: Authentication → Flows → 로그인·회원가입·비밀번호재설정 플로우 설정
5. **Required Actions 설정**: Authentication → Required Actions → `Terms Consent`, `Account Reactivation` 등록
6. **IDP 설정**: Identity Providers → Kakao / Naver / Inicis Client ID·Secret 입력
7. **User Federation 설정**: User Federation → REST → Base URL·인증정보·휴면 설정 입력
8. **SMTP 설정**: Realm Settings → Email → SMTP 서버 정보 입력

상세 설정 절차는 `docs/keycloak-setup-guide.md` 참고

### Realm Export / Import

```bash
# Export (운영→개발 설정 이관)
/opt/keycloak/bin/kc.sh export --dir /tmp/export --realm cnap

# Import
/opt/keycloak/bin/kc.sh import --dir /tmp/export
```

개발용 기준 설정: `docs/realm-export.json`

### 로그 확인

```bash
# Docker 환경
docker compose logs -f keycloak

# 로그 레벨 변경 (compose.yaml)
KC_LOG_LEVEL: debug   # info / debug / trace
```

### 운영 환경 주요 설정

| 항목 | 변경 위치 |
|------|-----------|
| 휴면 전환 기간 | Admin Console → User Federation → 설정 탭 |
| OTP 코드 길이·TTL | Admin Console → Authentication → OTP Authenticator 설정 |
| SMS API 연동 정보 | Admin Console → Authentication → OTP Authenticator 설정 |
| SMTP 서버 | Admin Console → Realm Settings → Email |
| IDP Client ID/Secret | Admin Console → Identity Providers → 각 IDP |
| 운영 모드 전환 | `compose.yaml` `command: start --optimized` (현재 `start-dev`) |

---

## 8. Troubleshooting

### FTL 약관 내용이 HTML 태그 텍스트로 표시되는 문제

**증상**: 약관 보기 버튼 클릭 시 내용 영역이 열리지만 약관 HTML이 렌더링되지 않고
`<div class="terms-content-body"><p><strong>...` 같은 텍스트가 그대로 노출된다.

**원인**: FreeMarker 연산자 우선순위 문제.

`?`(built-in) 가 `!`(missing value handler) 보다 우선순위가 높기 때문에,
아래 표현식은 의도와 다르게 파싱된다.

```freemarker
<!-- 의도: 전체 표현식에 ?no_esc 적용 -->
${(termsServiceContent)!""?no_esc}

<!-- 실제 파싱: ?no_esc 가 default 값 "" 에만 적용됨 -->
${(termsServiceContent)!(""?no_esc)}
```

변수가 존재하는 경우 `?no_esc` 없이 출력되므로 Keycloak FreeMarker auto-escaping이
`<` → `&lt;`, `"` → `&quot;` 로 변환한다.

**해결**: 전체 표현식을 괄호로 감싼 뒤 `?no_esc` 적용.

```freemarker
<!-- 올바른 표현 -->
${((termsServiceContent)!"")?no_esc}
```

**적용 위치**: [terms-consent.ftl](https://github.com/cnapcloud/keycloak-extension-spi/blob/main/src/main/resources/theme-resources/templates/terms-consent.ftl)
내 모든 약관 content 출력 표현식 (`termsServiceContent`, `termsPrivacyRequiredContent`,
`termsPrivacyOptionalContent`, `termsMarketingContent`).

### CSS 변경 후 브라우저에 반영되지 않는 문제

**증상**: `mvn package` 및 재배포 후에도 스타일 변경 사항이 브라우저에 반영되지 않는다.

**원인**: 브라우저가 이전 `output.css`를 캐시하고 있어 새 파일을 요청하지 않는다.
`output.css`는 `.gitignore`에 등록되어 있어 빌드 시 생성되며, URL이 동일하면 캐시를 그대로 사용한다.

**해결**: `template.ftl`에서 CSS URL에 `?v={themeVersion}` 쿼리스트링을 추가하여 캐시를 무효화한다.

```freemarker
<link href="${url.resourcesPath}/${style}?v=${properties.themeVersion!''}" rel="stylesheet" />
```

`theme.properties`에 버전을 정의하고, CSS 변경 시마다 값을 올린다.

```properties
themeVersion=26.5.2-3
```

배포 버전이 바뀌면 URL이 달라지므로 브라우저가 새 파일을 강제로 요청한다.

**관련 파일**: [template.ftl](https://github.com/cnapcloud/keycloak-extension-spi/blob/main/src/main/resources/theme/keycloak.ext/login/template.ftl),
[theme.properties](https://github.com/cnapcloud/keycloak-extension-spi/blob/main/src/main/resources/theme/keycloak.ext/login/theme.properties)

### unmanagedAttributePolicy와 UserModel 접근

`unmanagedAttributePolicy: "ADMIN_VIEW"`는 User Profile 레이어(검증/접근제어)에만 적용된다.
raw `UserModel`은 이 정책의 영향을 받지 않는다.

| 접근 방식 | 정책 적용 |
|-----------|-----------|
| `UserModel.getAttributes()` / `getFirstAttribute()` | 적용 안 됨 — 모든 속성 반환 |
| `UserProfileProvider` (스키마 기반 접근) | 적용됨 — 정책에 따라 필터링 |
| Account REST API, Admin Console | 적용됨 — 정책에 따라 노출 제어 |

따라서 커스텀 SPI 코드에서 `user.getFirstAttribute("phoneNumber")` 등으로 직접 접근하면
`ADMIN_VIEW`로 지정된 속성도 정상적으로 읽힌다.

반면 `VerifyProfileBean(user, formData, session)` 등 User Profile API를 거치는 경우에는
정책이 적용되어 일반 사용자에게 해당 속성이 노출되지 않는다.
