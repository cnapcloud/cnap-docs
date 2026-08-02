---
title: "약관 버전 관리"
sidebar_position: 5
---

---

## 1. 개요

약관 버전 관리 기능은 약관 개정 시 사용자에게 사전 고지하고, 시행일 이후 로그인 시 재동의를 받는 흐름을 자동화한다.

### 개정 유형

| 유형 | 기준 | 고지 방식 | 고지 시점 |
|------|------|-----------|-----------|
| `general` | 경미한 개정 (오탈자 수정 등) | 이메일만 | 시행일 7일 전 |
| `unfavorable` | 불리한 개정 (수집 항목 추가 등) | 이메일 + SMS | 시행일 30일 전 |

`unfavorable` SMS는 사용자 속성 `phoneNumber` 가 있는 경우에만 발송된다.

### 전체 흐름

```
1. 약관 HTML 파일 준비
2. Realm 속성에 예정 버전 + 시행일 설정
3. 스케줄러가 사전 고지 발송 (이메일 / SMS)
4. 시행일 당일: 로그인한 사용자에게 재동의 화면 표시
5. 동의 완료 후 사용자의 terms_version 업데이트
```

---

## 2. 약관 콘텐츠 파일 관리

### 파일 구조

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

### 로딩 우선순위

파일별로 아래 순서로 탐색하며, 처음 발견된 것을 사용한다.

```
1. 외부 FS:  {TERMS_CONTENT_DIR}/{realm}/{version}/{locale}/{filename}
2. 외부 FS:  {TERMS_CONTENT_DIR}/{realm}/1.0/ko/{filename}   <- 외부 FS fallback
3. classpath: theme-resources/terms/{version}/{locale}/{filename}
4. classpath: theme-resources/terms/1.0/ko/{filename} <- 최종 fallback (JAR 번들)
```

`TERMS_CONTENT_DIR` 미설정 시 1~2번 단계를 건너뛰고 classpath만 탐색한다.

예: `TERMS_CONTENT_DIR` 설정 상태에서 `{realm}/2026-07-01/` 폴더에 `service.html` 하나만 있는 경우

| 파일 | 로드 경로 |
|------|-----------|
| `service.html` | 외부 FS `{realm}/2026-07-01/ko/service.html` |
| `privacy_required.html` | 외부 FS `{realm}/1.0/ko/privacy_required.html` (fallback) |
| `privacy_optional.html` | 외부 FS `{realm}/1.0/ko/privacy_optional.html` (fallback) |
| `marketing.html` | 외부 FS `{realm}/1.0/ko/marketing.html` (fallback) |

### 새 버전 콘텐츠 준비

1. `docker/terms-content/{realm}/{new-version}/ko/` 디렉토리 생성
2. 변경된 카테고리 HTML 파일만 작성 (변경 없는 카테고리는 생략)
3. Keycloak 재시작 없이 즉시 반영됨

버전 속성 설정 전에 콘텐츠 파일을 먼저 배포해야 한다.
콘텐츠 없이 버전만 설정하면 사용자가 구버전 약관을 보고 신버전에 동의하게 된다.

---

## 3. 약관 개정 유형별 처리 절차

### 경미한 개정 (오탈자 수정, 즉시 적용)

```
1. HTML 파일 수정 (버전 디렉토리 변경 없음)
2. terms_current_version 직접 변경 (선택)
```

재동의가 필요 없으면 파일만 수정한다.
재동의가 필요하면 `terms_current_version` 을 새 버전으로 직접 변경한다.
고지 없이 즉시 재동의 요구가 발생하므로 불가피한 경우에만 사용한다.

### 일반 개정 (general — 7일 전 이메일 고지)

```
1. 새 버전 HTML 파일 준비 (docker/terms-content/{realm}/{version}/ko/)
2. Realm 속성 설정:
   - terms_next_version = {version}
   - terms_next_effective_date = {yyyy-MM-dd}
   - terms_change_type = general
3. 스케줄러가 시행일 7일 전부터 이메일 발송
4. 시행일: resolveEffectiveVersion() 이 자동 승격
5. 이후 로그인 사용자에게 재동의 화면 표시
```

### 불리한 개정 (unfavorable — 30일 전 이메일 + SMS 고지)

```
1. 새 버전 HTML 파일 준비 (docker/terms-content/{realm}/{version}/ko/)
2. Realm 속성 설정:
   - terms_next_version = {version}
   - terms_next_effective_date = {yyyy-MM-dd}
   - terms_change_type = unfavorable
3. 스케줄러가 시행일 30일 전부터 이메일 + SMS 발송
   (phoneNumber 속성 없는 사용자는 이메일만)
4. 시행일: 자동 승격 + 재동의 요구
```

---

## 4. Realm 속성 설정

### 사전 준비 (토큰 발급)

```bash
KC_URL=http://localhost:8080
KC_REALM=cnap
KC_ADMIN=admin
KC_ADMIN_PW=password

TOKEN=$(curl -s -X POST $KC_URL/realms/master/protocol/openid-connect/token \
  -d "client_id=admin-cli&grant_type=password&username=$KC_ADMIN&password=$KC_ADMIN_PW" \
  | jq -r '.access_token')
```

### 예정 버전 설정 (사전 고지 + 예약 승격)
```bash
# Realm 약관 속성 설정
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

`terms_change_type` 값:
- `general` — 이메일만, 시행일 7일 전부터
- `unfavorable` — 이메일 + SMS, 시행일 30일 전부터

**버전 자동 승격 처리 방식**  
`terms_next_effective_date` 당일 사용자가 최초 로그인할 때 Required Action이 트리거되면서 Realm의 `terms_current_version`이 `terms_next_version`으로 자동 승격된다. 이후 `terms_next_version`, `terms_next_effective_date`, `terms_change_type` 속성은 자동 삭제된다. 별도 배치 작업 없이 첫 번째 로그인 요청에서 처리된다.

### Realm 약관 속성 전체 조회
```bash
curl -s $KC_URL/admin/realms/$KC_REALM \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.attributes | with_entries(select(.key | startswith("terms")))'

# 출력 예시 (예정 버전 설정 후):
{
  "terms_current_version": "1.0",
  "terms_next_version": "2026-04-11",
  "terms_next_effective_date": "2026-04-11",
  "terms_change_type": "general"
}

# 출력 예시 (버전 승격 완료 후):
{
  "terms_current_version": "2026-04-11"
}
```

### 현재 버전 즉시 변경 (긴급 적용)

사전 고지 없이 즉시 재동의를 요구한다. 불가피한 경우에만 사용한다.

콘텐츠 파일(`docker/terms-content/{realm}/{version}/ko/`)을 먼저 배포한 후 버전을 변경해야 한다.
콘텐츠 파일 없이 버전만 변경하면 사용자에게 `1.0` 기본 약관이 표시되지만 새 버전에 동의한 것으로 기록되며,
이후 재동의 화면이 표시되지 않는다.

```bash
# 버전 변경
curl -X PUT $KC_URL/admin/realms/$KC_REALM \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attributes": {
      "terms_current_version": "2026-07-01"
    }
  }'
```

### Realm 속성 전체 목록

| 속성 키 | 타입 | 설명 |
|---------|------|------|
| `terms_current_version` | String | 현재 유효 버전. 미설정 시 `"1.0"` fallback |
| `terms_next_version` | String | 예정 버전 (시행일 도달 시 자동 승격 후 삭제) |
| `terms_next_effective_date` | String (yyyy-MM-dd) | 버전 승격 시행일 (승격 완료 후 삭제) |
| `terms_change_type` | String | `general` / `unfavorable` (승격 완료 후 삭제) |
| `terms_notification_sent_{version}` | String (yyyy-MM-dd) | 해당 버전 고지 발송일 (중복 방지용). 버전 승격 후에도 삭제되지 않고 누적 보존됨. |

---

## 5. 고지 스케줄러 설정

### Admin Console 등록

1. `User Federation` -> `Add provider` -> `terms-change-notifier` 선택
2. `Sync Settings` 탭 -> `Periodic Full Sync` 활성화
3. `Full Sync Period` 에 간격(초) 입력 후 Save
   - 예: `3600` = 1시간마다 실행
4. `Synchronize all users` 버튼으로 즉시 수동 실행 가능

### 동작 방식

```
sync() 호출
  -> terms_next_version 또는 terms_next_effective_date 없음 -> 즉시 종료
  -> terms_notification_sent_{version} 있음 -> 이미 발송, 종료
  -> general:     시행일 7일 전부터 이메일 발송
  -> unfavorable: 시행일 30일 전부터 이메일 + SMS 발송
  -> terms_notification_sent_{version} = 오늘 날짜 기록 (버전당 1회)
```

같은 버전에 대해 두 번 실행해도 재발송하지 않는다 (멱등).

---

## 6. 발송 실패 대응

### 실패 로그 위치

이메일 또는 SMS 발송 실패 시 버전별 파일에 기록된다.

```
${TERMS_NOTIFICATION_FAILURE_LOG_DIR}/terms-notification-failures-{version}.log
```

기본 경로: `/opt/keycloak/data/`
환경변수 `TERMS_NOTIFICATION_FAILURE_LOG_DIR` 로 변경 가능.

### 파일 형식 (CSV)

```
timestamp,version,effectiveDate,userId,username,channel,reason
2026-04-10T12:34:56,2026-07-01,2026-07-01,a55be11c-...,jane,SMS,NHN SMS delivery failed to 010-****
2026-04-10T12:34:57,2026-07-01,2026-07-01,f2f69501-...,bob,EMAIL,SMTP connection refused
```

| 컬럼 | 설명 |
|------|------|
| `timestamp` | 발송 시도 일시 |
| `version` | 약관 버전 |
| `effectiveDate` | 시행일 |
| `userId` | Keycloak 사용자 UUID |
| `username` | 로그인 ID |
| `channel` | `EMAIL` 또는 `SMS` |
| `reason` | 실패 원인 메시지 |

### 수동 재발송 절차

자동 재시도 없음. 로그 파일을 참고해 수동 조치한다.

1. 실패 로그에서 대상 사용자 목록 확인
2. 발송 실패 원인 파악 (`reason` 컬럼 확인)
3. 원인 해소 후 `Synchronize all users` 버튼으로 재실행 불가 (이미 `terms_notification_sent_*` 기록됨)
4. 개별 사용자에게 수동 발송하거나, 아래 순서로 재발송:

```bash
# terms_notification_sent_{version} 속성 삭제 후 재실행
curl -X PUT $KC_URL/admin/realms/$KC_REALM \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "attributes": {
      "terms_notification_sent_2026-07-01": null
    }
  }'
# 이후 Admin Console에서 Synchronize all users 실행
```

`terms_notification_sent_*` 삭제 후 재실행하면 전체 사용자에게 재발송된다.
특정 사용자만 재발송이 필요한 경우 수동 처리 권장.

---

## 7. 사용자 동의 현황 조회

### 특정 사용자의 동의 정보 조회

```bash
KC_USERNAME=jane

# 사용자명으로 조회
curl -s "$KC_URL/admin/realms/$KC_REALM/users?username=$KC_USERNAME&exact=true" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[0].attributes // {} | with_entries(select(.key | startswith("terms") or startswith("agreed")))'

# userId로 직접 조회
USER_ID=a55be11c-1234-5678-abcd-000000000000

curl -s "$KC_URL/admin/realms/$KC_REALM/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.attributes // {} | with_entries(select(.key | startswith("terms") or startswith("agreed")))'
```

### 사용자 속성 목록

| 속성 키 | 설명 |
|---------|------|
| `terms_version` | 마지막으로 동의한 약관 버전 |
| `terms_agreed_at` | 마지막 동의 일시 (ISO 8601) |
| `agreed_privacy_optional` | 선택적 개인정보 수집 동의 (`true` / `false`) |
| `agreed_email` | 마케팅 이메일 수신 동의 |
| `agreed_phone` | 마케팅 SMS 수신 동의 |
| `agreed_push` | 마케팅 푸시 수신 동의 |
| `terms_consent_history` | 동의 이력 (JSON, 다중값, append-only) |

### User Profile 설정 (속성 조회 활성화)

Admin API 응답에 `terms_*` / `agreed_*` 속성이 포함되지 않을 경우,
Realm User Profile의 `unmanagedAttributePolicy` 를 `ADMIN_VIEW` 로 설정한다.

```bash
PROFILE=$(curl -s "$KC_URL/admin/realms/$KC_REALM/users/profile" \
  -H "Authorization: Bearer $TOKEN")

UPDATED=$(echo "$PROFILE" | jq '.unmanagedAttributePolicy = "ADMIN_VIEW"')

curl -s -X PUT "$KC_URL/admin/realms/$KC_REALM/users/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$UPDATED"
```

또는 Admin Console: `Realm Settings` -> `User Profile` 탭 -> JSON 편집기에서 추가 후 Save.

---

## 8. 주의사항

### SMS 발송 설정

`SMS_PROVIDER` 환경변수 설정 시 해당 벤더의 API 키도 함께 설정해야 한다.
API 키 누락 시 `SmsServiceFactory` 초기화 실패 -> Keycloak 재시작 전까지 매 주기마다 에러 발생.

### 타임존 설정

스케줄러의 날짜 비교(`LocalDate.now()`)는 JVM 시스템 타임존을 따른다.
Docker 컨테이너에 타임존 설정이 없으면 UTC 기준으로 동작하므로, `terms_next_effective_date`를
한국 날짜로 입력해도 실제 트리거 시점이 최대 9시간 어긋날 수 있다.

`compose.yaml` keycloak 서비스에 아래 환경변수를 반드시 설정해야 한다.

```yaml
TZ: Asia/Seoul
```

설정 후 컨테이너를 재시작하면 `date` 명령으로 KST 적용 여부를 확인할 수 있다.

### 고지 기간 계산

시행일까지 남은 기간이 고지 기간보다 짧으면 설정 즉시 발송된다.

- `general`: `terms_next_effective_date` 까지 7일 미만이면 설정 즉시 이메일 발송
- `unfavorable`: 30일 미만이면 설정 즉시 이메일 + SMS 발송

### 버전 승격 타이밍

버전 승격(`terms_current_version` 자동 변경)은 배치 작업이 아니라
**시행일 당일 첫 번째 로그인 요청**에서 트리거된다.
시행일에 아무도 로그인하지 않으면 승격이 지연될 수 있다.

### 다중 인스턴스 환경

Keycloak 인스턴스가 2개 이상인 경우, 스케줄러가 여러 노드에서 동시에 실행될 수 있다.
`terms_notification_sent_*` 체크가 동시 실행을 완전히 막지는 못한다 (분산 락 미적용).
중복 발송 위험이 있으므로 스케줄러 실행 주기를 넉넉하게 설정하거나 수동 트리거 사용을 권장한다.
