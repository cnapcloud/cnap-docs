---
title: "설정 가이드"
sidebar_position: 2
---

> Realm: **cnap** | Keycloak 26.5.2 | Java 17

---

## 1. 사전 준비

### 1.1 SPI JAR 빌드

```bash
mvn clean package -DskipTests
```

생성된 JAR을 Keycloak providers 디렉토리에 복사한다.

```bash
cp target/keycloak-extensions-spi-1.0.0-SNAPSHOT.jar \
   /opt/keycloak/providers/
```

### 1.2 Docker 실행 (개발 환경)

> **주의**: 모든 `docker compose` 명령은 `docker/` 디렉토리에서 실행한다.

```bash
cd docker
```

#### 최초 시작

다음 3개 서비스가 함께 시작된다.

| 서비스 | 역할 | 포트 |
|--------|------|------|
| `postgres_db` | Keycloak DB | - |
| `keycloak` | Keycloak 서버 | 8080 |
| `mailhog` | 이메일 수신 테스트 | 8025 (Web UI), 1025 (SMTP) |

> 테스트 목적에 따라 추가 실행이 필요한 서버가 있다.
> - **UI 테스트** → `react-keycloak-demo` (npm run dev) [→ 1.4](#14-react-ui-테스트-애플리케이션)
> - **간편인증 테스트** → `inicis-mock-server` (mvn spring-boot:run) [→ 1.5](#15-간편인증-inicis-테스트-서버)

```bash
docker compose up -d
```

#### SPI JAR 변경 시 재시작

```bash
docker compose restart keycloak
```

### 1.3 환경 변수 설정

[docker/compose.yaml](https://github.com/cnapcloud/keycloak-extension-spi/blob/main/docker/compose.yaml)의 `keycloak` 서비스 `environment` 블록에 추가한다.

#### TZ

```yaml
TZ: Asia/Seoul
```

JVM 타임존을 지정한다. 설정하지 않으면 컨테이너 기본값인 **UTC**로 동작한다.

약관 고지 스케줄러(`TermsChangeNotifier`)와 계정 휴면 스케줄러(`DormantAccountScheduledTask`)는
`LocalDate.now()` 기준으로 날짜를 비교하므로, 이 설정이 없으면 한국 날짜 기준으로 입력한 시행일·휴면 기간이
최대 9시간 어긋나 의도치 않게 조기 또는 지연 실행될 수 있다.

#### OTP_DEV_MODE

```yaml
OTP_DEV_MODE: 'true'
```

개발 모드 활성화. `true`로 설정하면 이메일·SMS 인증코드 입력란에 **`000000`** 을 입력했을 때 항상 통과한다.
실제 코드 발송 없이 OTP 인증 플로우를 테스트할 때 사용한다.

> ⚠️ **운영 환경에서는 반드시 제거하거나 `false`로 설정해야 한다.**

#### OTP_CODE_LIFESPAN_SECONDS

```yaml
OTP_CODE_LIFESPAN_SECONDS: '300'
```

인증코드 유효 시간(초)을 지정한다. 설정하지 않으면 **기본값 30초**가 적용된다.
이메일·SMS 모든 인증 플로우에 공통 적용된다.

| 환경 | 권장값 |
|---|---|
| 개발 | `300` (5분) — 여유있게 테스트 |
| 운영 | `180` ~ `300` |

#### OTP_RATE_LIMIT_MAX_ATTEMPTS

```yaml
OTP_RATE_LIMIT_MAX_ATTEMPTS: '5'
```

OTP 인증 최대 시도 횟수를 지정한다. 설정하지 않으면 **기본값 5회**가 적용된다.
초과 시 `OTP_RATE_LIMIT_LOCKOUT_MINUTES`에 설정된 시간 동안 차단된다.

#### OTP_RATE_LIMIT_LOCKOUT_MINUTES

```yaml
OTP_RATE_LIMIT_LOCKOUT_MINUTES: '30'
```

OTP 인증 차단 시간(분)을 지정한다. 설정하지 않으면 **기본값 30분**이 적용된다.

두 환경변수의 적용 범위:

| 기능 | 적용 여부 | 비고 |
|---|---|---|
| 회원가입 OTP 인증 | 적용 | |
| 아이디 찾기 OTP 인증 | 적용 | |
| 비밀번호 재설정 OTP 인증 | 적용 | Admin Console Authenticator Config 설정이 우선 적용됨 |
| 로그인 OTP 인증 | 미적용 | Rate limit 없음 |

#### SMS_PROVIDER

```yaml
SMS_PROVIDER: aws_sns
```

SMS 발송 프로바이더를 지정한다. 설정하지 않으면 **ConsoleSmsService**(로그 출력만)로 동작한다.

| 값 | 프로바이더 | 필요 추가 환경변수 |
|---|---|---|
| (미설정) | ConsoleSmsService (로그 출력) | 없음 |
| `twilio` | Twilio | `SMS_API_KEY`, `SMS_API_SECRET` |
| `solapi` | Solapi | `SMS_API_KEY`, `SMS_API_SECRET` |
| `nhn` | NHN Cloud SMS | `SMS_API_KEY`, `SMS_API_SECRET` |
| `aws_sns` | AWS SNS | `SMS_AWS_ACCESS_KEY`, `SMS_AWS_SECRET_KEY`, `SMS_AWS_REGION` |

#### SMS_SENDER

```yaml
SMS_SENDER: '821012345678'
```

발신자 번호 또는 발신자 ID를 지정한다. 설정하지 않으면 기본값 **`Keycloak`** 이 적용된다.

#### AWS SNS 전용 환경변수

`SMS_PROVIDER: aws_sns` 사용 시 아래 세 항목이 모두 필요하다.

```yaml
SMS_AWS_ACCESS_KEY: your-access-key
SMS_AWS_SECRET_KEY: your-secret-key
SMS_AWS_REGION: ap-northeast-2
```

| 환경변수 | 설명 |
|---|---|
| `SMS_AWS_ACCESS_KEY` | AWS IAM Access Key ID |
| `SMS_AWS_SECRET_KEY` | AWS IAM Secret Access Key |
| `SMS_AWS_REGION` | AWS 리전 (예: `ap-northeast-2`) |

#### Twilio / Solapi / NHN 전용 환경변수

`SMS_PROVIDER: twilio`, `solapi`, `nhn` 사용 시 아래 두 항목이 필요하다.

```yaml
SMS_API_KEY: your-api-key
SMS_API_SECRET: your-api-secret
```

---

### 1.4 React UI 테스트 애플리케이션

Keycloak 로그인 플로우를 브라우저에서 End-to-End로 테스트하려면 **react-keycloak-demo** 앱을 함께 실행해야 한다.

```bash
cd ../react-keycloak-demo
npm install
npm run dev
```

Vite dev server가 시작되면 브라우저에서 접속하여 실제 로그인 흐름을 확인할 수 있다.

### 1.5 간편인증 (Inicis) 테스트 서버

간편인증(이니시스) 로그인을 테스트하려면 별도의 **inicis-mock-server**를 함께 실행해야 한다.

```bash
cd ../inicis-mock-server
mvn spring-boot:run
```

> inicis-mock-server는 이니시스 인증 API를 로컬에서 모방하는 Mock 서버다.
> 실행하지 않으면 간편인증 로그인 플로우가 동작하지 않는다.

### 1.6 Realm 임포트 (선택)

이미 완성된 `docs/realm-export.json`을 사용해 Realm을 한 번에 생성할 수 있다.

```bash
/opt/keycloak/bin/kc.sh import --file /path/to/realm-export.json
```

> 직접 설정하려면 아래 순서를 따른다.

---

## 2. Realm 기본 설정

### 2.1 일반 설정

Admin Console → **Realm Settings** → **General**

| 항목 | 설정값 | 설명 |
|---|---|---|
| Realm | `cnap` | Realm 식별자 |
| Display name | `CNAP` | UI 표시명 |
| Require SSL | `None` | HTTP 접속 허용 (로컬 개발 환경) |

### 2.2 로그인 정책

Admin Console → **Realm Settings** → **Login**

| 항목 | 값 |
|---|---|
| User registration | ✅ 허용 |
| Email as username | ❌ 사용 안 함 (별도 username 사용) |
| Forgot password | ✅ 허용 |
| Remember me | ✅ 허용 |
| Verify email | ❌ 비활성 |
| Login with email | ✅ 허용 |
| Duplicate emails | ❌ 금지 |
| Edit username | ❌ 금지 |

### 2.3 다국어 (Localization)

Admin Console → **Realm Settings** → **Localization**

| 항목 | 설정값 |
|---|---|
| Internationalization | **Enabled** |
| Supported locales | `ko`, `en` |
| Default locale | `ko` |

1. **Internationalization** 토글을 **ON**
2. **Supported locales**에 `ko`, `en` 추가
3. **Default locale**을 `ko` 선택
4. **Save**

### 2.4 토큰 유효 기간

Admin Console → **Realm Settings** → **Sessions**

| 항목 | 값 | 설명 |
|---|---|---|
| SSO Session Idle | **1800초** (30분) | 세션 유휴 타임아웃 |
| SSO Session Max | **36000초** (10시간) | 세션 최대 유효 시간 |
| Offline Session Idle | **2592000초** (30일) | 오프라인 세션 유효 시간 |

Admin Console → **Realm Settings** → **Tokens**

| 항목 | 값 | 설명 |
|---|---|---|
| Access Token Lifespan | **300초** (5분) | 액세스 토큰 유효 시간 |
| User Action Lifespan | **300초** | 이메일 링크 등 액션 유효 시간 |

### 2.5 브루트 포스 설정

Admin Console → **Realm Settings** → **Security defenses** → **Brute Force Detection**

현재 설정: **비활성화** (`bruteForceProtected: false`)

운영 환경에서는 활성화 권장:

| 항목 | 권장값 |
|---|---|
| Max Login Failures | `30` |
| Max Wait | `900초` (15분) |
| Strategy | `MULTIPLE` |

---

## 3. 테마 적용

Admin Console → **Realm Settings** → **Themes**

| 타입 | 테마 이름 |
|---|---|
| Login theme | `keycloak.ext` |
| Email theme | `keycloak.ext` |
| Account theme | (기본값) |
| Admin theme | (기본값) |

> SPI JAR 내부에 `src/main/resources/theme/keycloak.ext/` 경로로 번들되어 있어 별도 파일 복사 불필요.

---

## 4. 이벤트 리스너 등록

Admin Console → **Realm Settings** → **Events** → **Event listeners**

등록할 리스너:

| 리스너 ID | 역할 |
|---|---|
| `last-login-tracker` | 로그인 성공 시 `lastLoginDate` 속성 자동 업데이트 (휴면 계정 추적) |
| `user-event-publisher` | 사용자 생성/수정/삭제 이벤트를 외부 채널(RabbitMQ, Kafka, Redis, Log)로 발행 |
| `metrics-listener` | Keycloak 이벤트를 Prometheus 메트릭으로 노출 (`keycloak-metrics-spi`) |
| `jboss-logging` | 기본 로깅 (기존 유지) |

### 4.1 User Event Publisher 환경변수 설정

`user-event-publisher` 리스너를 활성화하려면 Keycloak 컨테이너에 아래 환경변수를 설정한다.

#### 채널 선택

```
USER_EVENT_CHANNEL=rabbitmq   # rabbitmq | kafka | redis | (미설정 → log-only)
```

#### RabbitMQ

```
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=guest
RABBITMQ_PASSWORD=guest
RABBITMQ_VIRTUAL_HOST=/
RABBITMQ_EXCHANGE=user.events
```

> topic exchange 사용. publisher는 `user.account.created` / `user.account.updated` / `user.account.deleted` routing key로 발행한다.
> consumer는 `user.account.*` 패턴으로 바인딩하여 전체 또는 선택적으로 수신할 수 있다.
> exchange는 SPI 기동 시 자동 선언(idempotent)된다.

예를 들어 RabbitMQ에서 `user.account` 큐를 생성하고, exchange에 `user.account.*` 라우팅 키로 바인딩하면 모든 사용자 관련 메시지가 `user.account` 큐로 수신된다.

#### Kafka

```
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
KAFKA_TOPIC=user-events
KAFKA_CLIENT_ID=keycloak-spi
```

#### Redis (Pub/Sub)

```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_CHANNEL=user:events
```

---

## 5. Authentication Flow — 로그인 (`browser-otp`)

Admin Console → **Authentication** → **Flows** → **Create flow**

### 5.1 플로우 구조

기본 `browser` 플로우를 복사하거나 아래와 동일하게 새로 구성한다.

```
browser-otp (최상위)
├── Cookie                          [ALTERNATIVE]
├── Kerberos                        [DISABLED]
├── Identity Provider Redirector    [ALTERNATIVE]
├── browser-otp Organization        [ALTERNATIVE]  ← 서브플로우 (기본값 유지)
└── browser-otp forms               [ALTERNATIVE]  ← 서브플로우
    ├── Username Password Form      [REQUIRED]
    ├── Conditional OTP Email/SMS   [REQUIRED]  ← SPI 커스텀
    └── Dormant Account Check       [REQUIRED]  ← SPI 커스텀
```

### 5.2 `browser-otp forms` 서브플로우 생성

1. `browser-otp forms` 서브플로우 추가
2. 아래 순서로 Authenticator 추가:

| 순서 | Authenticator | Display Name | 요구사항 |
|---|---|---|---|
| 1 | `auth-username-password-form` | Username Password Form | REQUIRED |
| 2 | `conditional-otp-authenticator` | Conditional OTP Email/SMS | REQUIRED |
| 3 | `dormant-account-check` | Dormant Account Check | REQUIRED |

### 5.3 Conditional OTP Email/SMS 설정 (`top` 설정값)

Authenticator 우측 ⚙️ 클릭 → Config 편집:

| 설정 항목 | 값 | 설명 |
|---|---|---|
| Code length | `6` | OTP 코드 자리수 |
| Time to live | `30` | 코드 유효 시간 (초) |
| Default Delivery Method | `SMS` | 기본 전달 수단 |
| Delivery Strategy | `USER_ATTRIBUTE` | 사용자 속성 기반으로 전달 수단 결정 |
| User Delivery Method Attribute | `otpMethod` | 사용자 속성명 (값: `SMS` 또는 `EMAIL`) |
| Phone Number Attribute | `phoneNumber` | 사용자 전화번호 속성명 |
| Fallback OTP Handling | `force` | 조건 미충족 시 OTP 강제 |

> `deliveryStrategy: USER_ATTRIBUTE` 설정 시, 사용자의 `otpMethod` 속성값에 따라
> `SMS` 또는 `EMAIL`로 OTP가 발송된다.
> 속성이 없거나 `SKIP`이면 Fallback 정책(`force`)이 적용된다.

### 5.4 Dormant Account Check 설정

설정 옵션 없음. 플로우에 추가하는 것만으로 동작한다.

- 사용자 `dormantStatus` 속성이 `DORMANT`이면 로그인 차단
- `REACTIVATE_ACCOUNT` Required Action 트리거

### 5.5 Realm에 Browser Flow 지정

Admin Console → **Realm Settings** → **Advanced** → **Browser flow**: `browser-otp`

---

## 6. Authentication Flow — 회원가입 (`registration-term`)

### 6.1 플로우 구조

```
registration-term (최상위)
├── Terms Consent                     [REQUIRED]  ← SPI 커스텀
└── registration-page-form            [REQUIRED]  ← 서브플로우
    ├── Registration User Creation    [REQUIRED]
    ├── Password Validation           [REQUIRED]
    └── reCAPTCHA                     [DISABLED]
```

### 6.2 플로우 생성 순서

1. **Terms Consent** (`terms-consent-authenticator`) 추가 → REQUIRED
2. `registration-page-form` 서브플로우 추가:
   - `registration-user-creation` → REQUIRED
   - `registration-password-action` → REQUIRED
   - `registration-recaptcha-action` → DISABLED (필요 시 활성화)

### 6.3 Terms Consent 동의 항목

`terms.ftl` 템플릿에서 수집하는 항목:

| 속성명 | 구분 | 설명 |
|---|---|---|
| `termsAccepted` | 필수 | 전체 약관 동의 |
| `ageConsent` | 필수 | 만 14세 이상 확인 |
| `serviceTerms` | 필수 | 서비스 이용약관 |
| `privacyRequired` | 필수 | 필수 개인정보 수집 동의 |
| `privacyOptional` | 선택 | 선택 개인정보 수집 동의 |
| `marketingConsent` | 선택 | 마케팅 수신 동의 |
| `marketingPush` | 선택 | 푸시 알림 수신 |
| `marketingEmail` | 선택 | 이메일 마케팅 수신 |
| `marketingSMS` | 선택 | SMS 마케팅 수신 |

### 6.4 Realm에 Registration Flow 지정

Admin Console → **Realm Settings** → **Advanced** → **Registration flow**: `registration-term`

---

## 7. Authentication Flow — 비밀번호 재설정 (`reset credentials-otp`)

### 7.1 플로우 구조

```
reset credentials-otp
├── Password Reset with Email/SMS OTP   [REQUIRED]  ← SPI 커스텀
└── Reset Password                      [REQUIRED]  ← 기본 Keycloak
```

### 7.2 Password Reset with Email/SMS OTP 설정

Authenticator 우측 ⚙️ 클릭 → Config 편집:

| 설정 항목 | 기본값 | 설명 |
|---|---|---|
| Max Attempts | `5` | 최대 인증 실패 허용 횟수 |
| Lockout Duration (minutes) | `30` | 초과 시 잠금 시간 |

### 7.3 재설정 3단계 흐름

```
Step 1: 아이디(username) 입력 → 사용자 조회
Step 2: OTP 인증 (이메일 / SMS 선택 후 6자리 코드 입력)
Step 3: 새 비밀번호 입력 → reset-password 처리
```

### 7.4 Realm에 Reset Credentials Flow 지정

Admin Console → **Realm Settings** → **Advanced** → **Reset credentials flow**: `reset credentials-otp`

---

## 8. Required Actions 설정

Admin Console → **Authentication** → **Required Actions**

### 8.1 활성화해야 할 Required Actions

| Display Name | Alias | 활성화 | Default Action | 설명 |
|---|---|---|---|---|
| Terms and Marketing Consent | `terms_marketing_consent_action` | ✅ | ✅ **ON** | 이용약관 + 마케팅 동의 (신규 사용자 자동 적용) |
| Reactivate Dormant Account | `REACTIVATE_ACCOUNT` | ✅ | ❌ | 휴면 계정 재활성화 (Dormant Check가 트리거) |
| Update Password | `UPDATE_PASSWORD` | ✅ | ❌ | 비밀번호 변경 |
| Update Profile | `UPDATE_PROFILE` | ✅ | ❌ | 프로필 수정 |
| Verify Email | `VERIFY_EMAIL` | ✅ | ❌ | 이메일 인증 |

> **Terms and Marketing Consent**의 `Default Action: ON`은 신규 가입 사용자에게 자동으로 이 액션이 할당됨을 의미한다.
> 기존 사용자에게 일괄 적용하려면 별도 마이그레이션 작업이 필요하다.

---

## 9. 계정 휴면 관리 (User Federation)

Admin Console → **User Federation** → **Add provider** → `dormant-account-scheduler`

### 9.1 등록 방법

1. **User Federation** 메뉴 진입
2. Provider 목록에서 `dormant-account-scheduler` 선택
3. 아래 설정값 입력 후 **Save**

### 9.2 설정값

| 설정 항목 | 현재 값 | 설명 |
|---|---|---|
| **Enabled** | `true` | 휴면 스케줄러 활성화 |
| **Dormant Period Days** | `365` | 마지막 로그인 후 이 기간 이상 미접속 시 휴면 전환 (일) |
| **Warning Period Days** | `30` | 휴면 전환 N일 전 이메일 경고 발송 |
| **Delete Enabled** | `true` | 장기 휴면 계정 삭제 활성화 |
| **Delete Period Days** | `90` | 휴면 전환 후 이 기간 경과 시 계정 삭제 (일) |
| **Deletion Warning Period Days** | `30` | 삭제 N일 전 이메일 경고 발송 |
| **Full Sync Period** | `604800` | 스케줄러 전체 동기화 주기 (초, = 7일) |

### 9.3 휴면 계정 상태 흐름

```
ACTIVE
  └─ 365일 미접속 → [경고 이메일 발송 (D-30)] → DORMANT
       └─ 90일 경과 → [삭제 경고 이메일 발송 (D-30)] → PENDING_DELETE
            └─ 삭제(비활성화)
```

삭제는 계정 비활성화(disabled) 처리이며, 로그인이 차단되고 계정은 삭제된 것으로 간주된다. 데이터베이스에서 물리적으로 제거되지는 않는다.

### 9.4 관련 사용자 속성

| 속성명 | 값 예시 | 설명 |
|---|---|---|
| `dormantStatus` | `ACTIVE` / `DORMANT` / `PENDING_DELETE` | 현재 휴면 상태 |
| `lastLoginDate` | `2025-01-15T10:30:00` | 마지막 로그인 시각 |
| `dormantSince` | `2026-01-15T00:00:00` | 휴면 전환 일시 |
| `dormantWarningDate` | `2025-12-16T00:00:00` | 휴면 경고 이메일 발송 일시 |
| `finalDeleteDate` | `2026-04-15T00:00:00` | 계정 삭제 예정일 |
| `reactivationToken` | `1234` | 재활성화 4자리 토큰 |
| `reactivationTokenExpiry` | `2026-01-16T10:30:00` | 토큰 만료 시각 |

---

## 10. 소셜 로그인 (Identity Provider)

Admin Console → **Identity Providers** → **Add provider**

### 공통 전제조건: 사전 회원가입 필수

> ⚠️ **소셜 로그인은 신규 계정을 자동 생성하지 않는다.**
> Keycloak에 이미 가입된 사용자를 소셜 계정과 **연동(Link)**하는 방식으로 동작한다.
> 매핑 기준에 해당하는 사용자가 존재하지 않으면 로그인이 거부된다.

| Provider | 계정 매핑 기준 | 사용자 없을 때 오류 |
|---|---|---|
| 카카오 | 소셜 계정 이메일 → `email` 속성으로 사용자 검색 | `kakao_user_not_found` |
| 네이버 | 소셜 계정 이메일 → `email` 속성으로 사용자 검색 | `naver_user_not_found` |
| 이니시스 | CI(우선) → `phoneNumber` 속성으로 사용자 검색 | `user_not_found_please_register` |

**사용 흐름:**
```
1. 일반 회원가입 (이메일 + 전화번호 포함)
2. 이후 소셜 로그인 시 가입 이메일(카카오/네이버) 또는
   전화번호(이니시스)로 기존 계정과 자동 연동
```

---

### 10.1 카카오 로그인

#### 카카오 개발자 센터 설정

1. **앱 등록**: https://developers.kakao.com/console/app
2. **카카오 로그인 활성화** (앱 → 카카오 로그인 → 활성화 ON)
   - OpenID Connect: **ON**
   - 동의항목: `profile_nickname`, `profile_image`, `email`, ...
3. **Redirect URI 등록** (카카오 앱 → 카카오 로그인 → Redirect URI):
   ```
   http://localhost:8080/realms/cnap/broker/kakao/endpoint
   ```
4. **인증 정보 확인** (앱 → 앱 키):
   - **Client ID**: REST API 키
   - **Client Secret**: 카카오 로그인 → 보안 → 코드 (활성화 필요)

#### Keycloak Admin Console 설정

| 항목 | 값 |
|---|---|
| Provider | `kakao` |
| Alias | `kakao` |
| Client ID | REST API 키 |
| Client Secret | 카카오 로그인 보안 코드 |
| Sync mode | `IMPORT` |

**Redirect URI** (카카오 앱에 등록한 값과 동일):
```
http://localhost:8080/realms/cnap/broker/kakao/endpoint
```

### 10.2 네이버 로그인

#### 네이버 개발자 센터 설정

1. **애플리케이션 등록**: https://developers.naver.com/main/ → **Application > 애플리케이션 등록**

2. **기본 정보 입력**
   - 애플리케이션 이름: `keycloak`
   - 사용 API: `네이버 로그인`

3. **네이버 로그인 동의항목** (필요한 항목 체크)
   - 회원이름
   - 연락처 이메일 주소
   - 별명

4. **로그인 오픈 API 서비스 환경** → 환경 추가: `PC 웹`
   - 서비스 URL: `https://keycloak-admin.kind.internal`
   - Callback URL (Redirect URI):
     ```
     https://keycloak.kind.internal/realms/internal/broker/naver/endpoint
     ```
     > Keycloak Identity Providers의 naver **Redirect URI**와 동일하게 입력

5. **비로그인 오픈 API 서비스 환경** → 환경 추가: `PC 웹`
   - 웹 서비스 URL: `https://keycloak-admin.kind.internal`

6. **인증 정보 확인**: Application > 내 애플리케이션 > `keycloak` > **개요**
   - **Client ID**: `(네이버 발급 Client ID)`
   - **Client Secret**: `(네이버 발급 Client Secret)`

#### Keycloak Admin Console 설정

Admin Console → **Identity Providers** → **Add provider** → `naver`

| 항목 | 값 |
|---|---|
| Provider | `naver` |
| Alias | `naver` |
| Redirect URI | `https://keycloak-admin.kind.internal/realms/internal/broker/naver/endpoint` |
| Client ID | `(네이버 발급 Client ID)` |
| Client Secret | `(네이버 발급 Client Secret)` |
| Sync mode | `IMPORT` |

> Redirect URI는 네이버 개발자 센터의 **Callback URL**과 반드시 일치해야 한다.

---

### 10.3 First Broker Login Flow 설정

소셜 로그인 최초 연동 시 실행되는 플로우. **이 시스템은 사전 가입된 사용자와의 연동만 허용**하므로
이메일 인증(Email Verification) 단계를 비활성화해야 한다.

> **주의**: 이 플로우는 복제(Copy)하지 않는다. 기본 제공되는 `first broker login` 플로우를 직접 수정해서 사용한다.

Admin Console → **Authentication** → **Flows** → `first broker login`

#### 플로우 구조 및 설정값

```
first broker login
├── Review Profile                          [DISABLED]   ← 기존 사용자 연계로 SKIP
├── User creation or linking                [REQUIRED]   ← 서브플로우
│   ├── Create User If Unique               [ALTERNATIVE] ← 신규 사용자면 계정 생성
│   └── Handle Existing Account             [ALTERNATIVE] ← 기존 계정 확인 프로세스
│       ├── Confirm Link Existing Account   [REQUIRED]
│       └── Account verification options   [REQUIRED]   ← 서브플로우
│           ├── Verify Existing Account by Email        [DISABLED] ⬅ 로그인으로 대체
│           └── Verify Existing Account by Re-authentication [REQUIRED]
|                └── Username Password Form for identity provider reauthentication [REQUIRED]
└── First Broker Login - Conditional Organization [CONDITIONAL]
```

#### 변경 방법

1. **Authentication** → **Flows** → `first broker login` 선택
2. `Account verification options` 서브플로우 펼치기
3. **`Verify Existing Account by Email`** 의 Requirement를 `ALTERNATIVE` → **`DISABLED`** 로 변경
4. **Save**

> **비활성화 이유**: 이 시스템은 이메일/전화번호 매핑으로 기존 계정을 자동 연동한다.
> Email Verification을 활성화하면 이미 가입된 사용자에게 불필요한 이메일 인증이 추가로 요구된다.

---

### 10.4 이니시스 간편인증 (KG Inicis)

> ⚠️ **이 Provider(SPI 구현체 포함)는 Mockup 서버 기반의 개발 샘플이다.**
> KG이니시스 실 연동을 위해서는 **SPI 구현체(`InicisIdentityProvider`) 자체를 실제 API 스펙에 맞게 재개발**해야 한다.
> 아래 설정값은 구조 참고용이며, 운영에 그대로 사용할 수 없다.

#### 현재 샘플 설정값 (참고용)

| 항목 | 샘플 값 | 설명 |
|---|---|---|
| Provider | `kg-inicis` | SPI Provider ID |
| Alias | `kg-inicis` | Keycloak 내부 식별자 |
| Display Name | `간편인증` | 로그인 버튼 표시명 |
| Auth Page URL | `http://localhost:9091/auth` | Mockup 인증 서버 (`inicis-mock-server` 컨테이너) |
| Client ID (MID) | `NA` | 더미 값 |
| API Key | `API-KEY` | 더미 값 |
| MID | `CIC12345678` | 더미 상점 ID |
| Sync mode | `IMPORT` | |

#### 실 연동 재개발 시 고려 항목

| 항목 | 내용 |
|---|---|
| SPI 구현 | [InicisIdentityProvider.java](https://github.com/cnapcloud/keycloak-extension-spi/blob/main/src/main/java/com/keycloak/authentication/idp/inicis/InicisIdentityProvider.java) 를 이니시스 실 API 스펙에 맞게 재구현 |
| Auth Page URL | 이니시스 실 인증 URL로 교체 |
| MID / API Key | 이니시스에서 발급받은 상점 ID 및 API Key로 교체 |
| 응답 파싱 | 이니시스 인증 응답 포맷에 맞게 사용자 정보 매핑 로직 수정 |
| 보안 검증 | 이니시스 서명 검증 로직 추가 |

---

## 11. SMTP 이메일 설정

Admin Console → **Realm Settings** → **Email**

### 11.1 개발 환경 (Mailhog)

`docker compose up -d` 시 Mailhog가 함께 시작되며, Keycloak에서 발송된 모든 이메일을 수신한다.

| 항목 | 값 |
|---|---|
| Host | `mailhog` |
| Port | `1025` |
| From | `admin@cnap.com` |
| Enable SSL | ❌ |
| Enable StartTLS | ❌ |
| Authentication | ❌ |

수신된 이메일은 브라우저에서 **[http://localhost:8025](http://localhost:8025)** 로 확인한다.

### 11.2 운영 환경

| 항목 | 값 |
|---|---|
| Host | SMTP 서버 주소 |
| Port | `587` (StartTLS) 또는 `465` (SSL) |
| From | 발신 이메일 주소 |
| Enable SSL | 환경에 맞게 설정 |
| Username / Password | SMTP 인증 정보 |

---

## 12. 사용자 프로파일 (User Profile) 설정

Admin Console → **Realm Settings** → **User profile**

### 12.1 개요

`phoneNumber`와 `otpMethod`는 OTP 인증 및 휴면 관리에 필수로 사용되는 커스텀 속성이다.
`phoneNumber`에는 SPI로 등록된 커스텀 유효성 검사기(`phone-uniqueness`)가 적용된다.

> ⚠️ `phone-uniqueness` validator는 Keycloak 기본 제공 검사기가 아니므로
> SPI JAR 배포 후에만 등록 가능하다. **JSON editor를 통해 직접 추가해야 한다.**

### 12.2 JSON Editor로 전체 설정 적용

**Realm Settings → User profile → JSON editor** 탭에서 아래 JSON을 붙여넣고 Save한다.

```json
{
  "attributes": [
    {
      "name": "username",
      "displayName": "${username}",
      "validations": {
        "length": { "min": 3, "max": 255 },
        "username-prohibited-characters": {},
        "up-username-not-idn-homograph": {}
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "email",
      "displayName": "${email}",
      "validations": {
        "email": {},
        "length": { "max": 255 }
      },
      "required": { "roles": ["user"] },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "firstName",
      "displayName": "${firstName}",
      "validations": {
        "length": { "max": 255 },
        "person-name-prohibited-characters": {}
      },
      "required": { "roles": ["user"] },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "lastName",
      "displayName": "${lastName}",
      "validations": {
        "length": { "max": 255 },
        "person-name-prohibited-characters": {}
      },
      "required": { "roles": ["user"] },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "phoneNumber",
      "displayName": "${profile.attributes.phoneNumber}",
      "validations": {
        "phone-uniqueness": {}
      },
      "required": { "roles": ["user"] },
      "annotations": {},
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    },
    {
      "name": "otpMethod",
      "displayName": "${profile.attributes.otpMethod}",
      "validations": {
        "options": { "options": ["SMS", "EMAIL", "SKIP"] }
      },
      "required": { "roles": ["user"] },
      "annotations": {
        "inputType": "select"
      },
      "permissions": {
        "view": ["admin", "user"],
        "edit": ["admin", "user"]
      },
      "multivalued": false
    }
  ],
  "groups": [
    {
      "name": "user-metadata",
      "displayHeader": "User metadata",
      "displayDescription": "Attributes, which refer to user metadata"
    }
  ],
  "unmanagedAttributePolicy": "ADMIN_VIEW"
}
```

아래 두 항목은 Admin Console UI에서 설정할 수 없으며, JSON Editor를 통해서만 적용할 수 있다.

**`phone-uniqueness: {}`** (속성 validator)

커스텀 SPI로 등록된 validator로, Keycloak 기본 UI의 validator 선택 목록에 나타나지 않는다.
`phoneNumber` 속성에 적용하면 Realm 내 동일 전화번호를 가진 다른 사용자가 있을 경우 저장을 막는다.
JAR 배포 전에 JSON을 저장하면 "Unknown validator" 오류가 발생하므로, 반드시 JAR 배포 → 재시작 → JSON 저장 순서를 따른다.

**`unmanagedAttributePolicy: "ADMIN_VIEW"`** (최상위 속성)

User Profile 스키마에 정의되지 않은 속성(unmanaged attribute)의 접근 정책을 지정한다.
`"ADMIN_VIEW"`로 설정하면 스키마 외 속성은 Admin API에서만 읽을 수 있고, 일반 사용자 API(Account API)에는 노출되지 않는다.
소셜 로그인이나 외부 Federation에서 자동 생성되는 내부 속성(`dormantAt`, `reactivatedAt` 등)을 사용자 화면에 노출하지 않기 위해 설정한다.
이 정책은 raw `UserModel`에는 영향을 주지 않으므로 SPI 코드에서 `user.getFirstAttribute()` 등으로 직접 읽는 것은 여전히 가능하다.

### 12.3 속성별 설명

| 속성명 | 필수 | Validator | 설명 |
|---|---|---|---|
| `username` | 시스템 | `length(3~255)`, `username-prohibited-characters` | 로그인 ID |
| `email` | ✅ user | `email`, `length(max 255)` | 이메일 주소 |
| `firstName` | ✅ user | `length(max 255)`, `person-name-prohibited-characters` | 이름 |
| `lastName` | ✅ user | `length(max 255)`, `person-name-prohibited-characters` | 성 |
| `phoneNumber` | ✅ user | **`phone-uniqueness`** (커스텀 SPI) | 전화번호, Realm 내 중복 금지 |
| `otpMethod` | ✅ user | `options: [SMS, EMAIL, SKIP]` | OTP 전달 수단 선택 (UI: select) |

### 12.4 phone-uniqueness Validator

- 클래스: [PhoneUniquenessValidator.java](https://github.com/cnapcloud/keycloak-extension-spi/blob/main/src/main/java/com/keycloak/account/registration/validator/PhoneUniquenessValidator.java)
- Validator ID: `phone-uniqueness`
- 동작: `phoneNumber` 속성 저장 시 Realm 내 동일 전화번호를 가진 다른 사용자가 있으면 유효성 검사 실패

> SPI JAR가 배포되지 않은 상태에서 JSON을 저장하면 **"Unknown validator" 오류**가 발생한다.
> 반드시 JAR 배포 → Keycloak 재시작 → User Profile JSON 저장 순서를 따른다.

### 12.5 메시지 번들 (i18n)

`src/main/resources/theme/keycloak.ext/login/messages/messages_ko.properties`에
아래 키를 추가해야 UI에 한국어 라벨이 표시된다.

```properties
profile.attributes.phoneNumber=휴대폰 번호
profile.attributes.otpMethod=OTP 수신 방법
```

---

## 13. 사용자 속성 참조

### 12.1 OTP / 연락처 속성

| 속성명 | 타입 | 값 예시 | 설명 |
|---|---|---|---|
| `phoneNumber` | String | `01012345678` | 사용자 전화번호 (SMS OTP 발송 대상) |
| `otpMethod` | String | `SMS` / `EMAIL` / `SKIP` | OTP 전달 수단 선택 |

### 12.2 이용약관 동의 속성

| 속성명 | 구분 |
|---|---|
| `termsAccepted` | 필수 |
| `ageConsent` | 필수 |
| `serviceTerms` | 필수 |
| `privacyRequired` | 필수 |
| `privacyOptional` | 선택 |
| `marketingConsent` | 선택 |
| `marketingPush` | 선택 |
| `marketingEmail` | 선택 |
| `marketingSMS` | 선택 |

### 12.3 REST API 엔드포인트

| 기능 | Method | URL |
|---|---|---|
| 인증 코드 발송 | POST | `/realms/cnap/registration-verify/send-code` |
| 인증 코드 확인 | POST | `/realms/cnap/registration-verify/verify-code` |
| 아이디 찾기 | - | `/realms/cnap/username-find/` |
| 범용 API | GET | `/realms/cnap/my-rest-resource/hello` |

> Rate limit: 30분당 5회, 코드 TTL: 300초

> **⚠️ 인증 세션 필수**: `registration-verify` API는 Keycloak 로그인/회원가입 플로우가 브라우저에서 진행 중인 경우에만 사용 가능하다.
> 내부적으로 브라우저 쿠키 기반의 `AuthenticationSession`을 조회하므로, 활성 세션 없이 직접 호출하면 `sessionNotFound` 오류가 반환된다.

---

## 14. 이용약관 설정

세부 운영 가이드는 [docs/07-terms-guide.md](terms-guide.md)를 참조한다.

### 14.1 약관 콘텐츠 파일 관리

약관 본문은 realm별, 버전별 HTML 파일로 관리된다.

```
docker/terms-content/
  {realm}/                   <- Keycloak Realm 이름
    1.0/
      ko/
        service.html           <- 서비스 이용약관
        privacy_required.html  <- 개인정보 수집 필수
        privacy_optional.html  <- 개인정보 수집 선택
        marketing.html         <- 마케팅 수신 동의
    2026-07-01/
      ko/
        service.html           <- 변경된 카테고리만 작성
                               <- 없는 파일은 {realm}/1.0/ko 로 자동 fallback
```

버전 디렉토리명은 Realm 속성 `terms_current_version` 값과 일치해야 한다.

### 14.2 고지 스케줄러 설정

1. `User Federation` -> `Add provider` -> `terms-change-notifier` 선택
2. `Sync Settings` 탭 -> `Periodic Full Sync` 활성화
3. `Full Sync Period` 에 간격(초) 입력 후 Save
   - 예: `3600` = 1시간마다 실행
4. `Synchronize all users` 버튼으로 즉시 수동 실행 가능

### 14.3 약관 설정

#### 예정 버전 설정 (사전 고지 + 예약 승격)

```bash
curl -X PUT $KC_URL/admin/realms/$KC_REALM \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attributes": {
      "terms_next_version": "2026-07-01",
      "terms_next_effective_date": "2026-07-01",
      "terms_change_type": "general"
    }
  }'
```

#### 현재 버전 즉시 변경 (긴급 적용)

사전 고지 없이 즉시 재동의를 요구한다. 불가피한 경우에만 사용한다.

콘텐츠 파일(`docker/terms-content/{realm}/{version}/ko/`)을 먼저 배포한 후 버전을 변경해야 한다.
콘텐츠 파일 없이 버전만 변경하면 사용자에게 `1.0` 기본 약관이 표시되지만 새 버전에 동의한 것으로 기록되며,
이후 재동의 화면이 표시되지 않는다.

```bash
curl -X PUT $KC_URL/admin/realms/$KC_REALM \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attributes": {
      "terms_current_version": "2026-07-01"
    }
  }'
```

#### Realm 약관 설정 조회

```bash
curl -s $KC_URL/admin/realms/$KC_REALM \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.attributes | with_entries(select(.key | startswith("terms")))'
```

### 14.4 약관 동의 현황 조회

Admin API 응답에 `terms_*` / `agreed_*` 속성이 포함되지 않을 경우,
Realm User Profile의 `unmanagedAttributePolicy` 를 `ADMIN_VIEW` 로 설정한다.

```bash
KC_USERNAME=jane

curl -s "$KC_URL/admin/realms/$KC_REALM/users?username=$KC_USERNAME&exact=true" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[0].attributes // {} | with_entries(select(.key | startswith("terms") or startswith("agreed")))'
```

---

## 15. User Storage Federation (REST)

Admin Console → **User Federation** → **Add provider** → `REST`

외부 REST API를 통해 사용자 데이터를 조회·인증하는 User Storage Federation Provider이다.
사용자 로그인 시 Keycloak 로컬 DB에 없으면 여기서 설정한 외부 API로 위임 조회한다.

### 15.1 등록 방법

1. **User Federation** 메뉴 진입
2. Provider 목록에서 `REST` 선택
3. 아래 설정값 입력 후 **Save**

### 15.2 설정값

| 설정 항목 | 값 | 설명 |
|---|---|---|
| **Enabled** | `On` | Federation Provider 활성화 |
| **UI display name** | (자유 입력) | Admin Console에 표시될 이름 (예: `External User API`) |
| **Base URL** | `https://api.example.com` | 외부 사용자 API의 Base URL. 끝 슬래시 불필요 |
| **Username** | `keycloak` | 외부 API BasicAuth 사용자명 |
| **Password** | `••••••••` | 외부 API BasicAuth 비밀번호 |
| **Sync enabled** | `On` | 외부 DB 동기화 활성화 (현재 미구현, 설정만 저장됨) |
| **Import users** | `On` | 외부 DB 사용자 로컬 임포트 활성화 |
| **Periodic full sync** | `Off` | 전체 동기화 주기 설정 (현재 미구현) |
| **Periodic changed users sync** | `Off` | 변경 사용자 동기화 주기 설정 (현재 미구현) |
| **Cache policy** | `DEFAULT` | Keycloak 기본 캐시 정책 사용 |

Sync 관련 항목(Sync enabled, Periodic full/changed sync)은 현재 stub으로 구현되어 있으며
실제 동기화 동작은 수행하지 않는다.

### 15.3 외부 API 참조

외부 REST API 명세는 [docs/06-usp-integration-guide.md](usp-integration-guide.md)를 참조한다.
구현체 예시는 아래 저장소를 참조한다.

```
https://github.com/cnapcloud/keycloak-user-storage
```

