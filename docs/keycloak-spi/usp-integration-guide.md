---
title: "외부 사용자 DB 연계"
sidebar_position: 6
---

> 대상: Keycloak User Storage Provider(USP)와 연동하는 외부 시스템 개발업체
> Keycloak 버전: 26.5.2

---

## 1. 개요 및 연계 구조

Keycloak은 User Storage SPI(이하 **USP**)를 통해 사용자 정보를 외부 시스템에서 관리할 수 있습니다.
USP는 Keycloak의 인증 요청마다 아래 흐름으로 외부 REST API를 호출합니다.

```
[브라우저] → [Keycloak] → [USP(this SPI)] → [외부 REST API] → [외부 DB]
                                ^
                         이 가이드의 대상
```

**외부 개발업체가 구현해야 하는 것**: 아래 명세에 따른 REST API 서버

연계가 완료되면 Keycloak은 다음 기능을 외부 시스템에 위임합니다:
- 로그인 시 사용자 조회 및 비밀번호 검증
- 사용자 속성(휴면 상태, 전화번호 등) 읽기/쓰기
- 사용자 생성/삭제

---

## 2. 필수 구현 항목

아래 11개 엔드포인트를 **모두** 구현해야 합니다.
하나라도 누락되면 Keycloak 관리 콘솔 또는 로그인이 정상 동작하지 않을 수 있습니다.

| 우선순위 | 메서드 | 경로 | Keycloak이 호출하는 시점 |
|----------|--------|------|--------------------------|
| 필수 | `GET` | `/user/{id}` | 로그인, 토큰 갱신, 사용자 조회 |
| 필수 | `GET` | `/user/search` | 관리자 콘솔 목록, 이메일/전화번호 조회 |
| 필수 | `GET` | `/user/count` | 관리자 콘솔 페이지 계산 |
| 필수 | `GET` | `/user/count/all` | 관리자 콘솔 전체 수 |
| 필수 | `POST` | `/user` | 관리자 콘솔 사용자 생성 |
| 필수 | `DELETE` | `/user/{id}` | 관리자 콘솔 사용자 삭제 |
| 필수 | `PATCH` | `/user/{id}/attributes` | 로그인 후 lastLoginDate 기록, 휴면 해제 등 |
| 필수 | `PATCH` | `/user/{id}/attributes/multi` | 다중값 속성(List) 저장 |
| 필수 | `GET` | `/credential/{id}` | 로그인 비밀번호 검증 |
| 필수 | `PUT` | `/credential/{id}` | 비밀번호 변경 |
| 필수 | `DELETE` | `/credential/{id}` | 자격증명 삭제 |

### 공통 요구사항

- `Content-Type: application/json` 지원
- 인증: Keycloak 측 설정에 따라 Bearer 토큰 또는 Basic 인증 중 하나를 적용 (사전 협의)
- 응답 인코딩: UTF-8
- 응답 시간: 99 퍼센타일 기준 500ms 이하 권장 (Keycloak 로그인 응답에 직접 영향)

---

## 3. API 명세

### Base URL

```
https://{외부시스템 도메인}/
```

> Base URL은 Keycloak USP 설정에서 `USER_REST_BASE_URL` 환경변수로 지정합니다.

---

### 3.1 GET `/user/{id}` — 사용자 단건 조회

로그인, 토큰 갱신 시 가장 빈번하게 호출됩니다.
`attributes` 맵에 모든 도메인 속성을 포함해야 합니다.

**요청**

```http
GET /user/u-9f3a2c1b HTTP/1.1
Accept: application/json
```

| 경로 파라미터 | 타입 | 설명 |
|---------------|------|------|
| `id` | string | 외부 시스템 사용자 ID |

**응답 200 OK**

```json
{
  "username": "john",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "enabled": true,
  "emailVerified": false,
  "createdDate": "2026-01-01T00:00:00",
  "attributes": {
    "dormantStatus": "ACTIVE",
    "lastLoginDate": "2026-03-09T12:00:00",
    "phoneNumber": "010-1234-5678",
    "otpMethod": "SMS",
    "birthday": "1990-01-01",
    "gender": "M"
  }
}
```

**응답 404 Not Found**

```json
{ "error": "user not found" }
```

> `attributes` 키가 없는 경우 빈 객체 `{}` 를 반환하세요. `null` 반환 시 NullPointerException이 발생합니다.

---

### 3.2 GET `/user/search` — 사용자 검색

관리자 콘솔 사용자 목록, 이메일/전화번호 중복 확인 등에 사용됩니다.

**요청**

```http
GET /user/search?first=0&max=20&username=john&email=john%40example.com HTTP/1.1
Accept: application/json
```

| 쿼리 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|---------------|------|------|--------|------|
| `first` | int | N | 0 | 페이지 오프셋 |
| `max` | int | N | 20 | 최대 반환 수 |
| `username` | string | N | - | 사용자명 (부분 일치) |
| `email` | string | N | - | 이메일 (부분 일치) |
| `firstName` | string | N | - | 이름 (부분 일치) |
| `lastName` | string | N | - | 성 (부분 일치) |
| `phoneNumber` | string | N | - | 전화번호 (attributes 검색) |
| 기타 attributes 키 | string | N | - | attributes 맵의 임의 키 검색 가능 |

**응답 200 OK**

```json
[
  {
    "username": "john",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "enabled": true,
    "emailVerified": false,
    "createdDate": "2026-01-01T00:00:00",
    "attributes": {
      "dormantStatus": "ACTIVE",
      "phoneNumber": "010-1234-5678"
    }
  }
]
```

> 결과가 없으면 빈 배열 `[]` 반환. `404`를 반환하면 안 됩니다.

---

### 3.3 GET `/user/count` — 사용자 수 조회 (조건부)

`/user/search`와 동일한 필터 파라미터를 받아 조건에 맞는 사용자 수를 반환합니다.
관리자 콘솔 페이지네이션 계산에 사용됩니다.

**요청**

```http
GET /user/count?dormantStatus=DORMANT HTTP/1.1
Accept: application/json
```

파라미터는 [3.2 검색](#32-get-usersearch--사용자-검색)과 동일합니다. (`first`, `max` 제외)

**응답 200 OK**

```json
42
```

> 응답 본문은 JSON 숫자(정수) 단독 반환. 래핑 객체 없음.

---

### 3.4 GET `/user/count/all` — 사용자 수 조회 (전체)

필터 없이 전체 사용자 수를 반환합니다.

**요청**

```http
GET /user/count/all HTTP/1.1
Accept: application/json
```

**응답 200 OK**

```json
1024
```

---

### 3.5 POST `/user` — 사용자 생성

관리자 콘솔에서 사용자를 직접 생성할 때 호출됩니다.

**요청**

```http
POST /user HTTP/1.1
Content-Type: application/json

{
  "username": "jane",
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "enabled": true,
  "emailVerified": false,
  "attributes": {
    "phoneNumber": "010-9876-5432",
    "birthday": "1995-06-15",
    "gender": "F"
  }
}
```

> `attributes` 필드는 없거나 빈 객체일 수 있습니다. 항상 허용해야 합니다.

**응답 201 Created**

```json
{
  "id": "u-4b8e1a3d",
  "username": "jane",
  "email": "jane@example.com"
}
```

| 응답 필드 | 타입 | 설명 |
|-----------|------|------|
| `id` | string | 외부 시스템에서 생성한 사용자 ID. Keycloak이 이후 조회/수정/삭제 시 이 값을 사용 |

**응답 409 Conflict** (username 또는 email 중복)

```json
{ "error": "user already exists" }
```

---

### 3.6 DELETE `/user/{id}` — 사용자 삭제

**요청**

```http
DELETE /user/u-4b8e1a3d HTTP/1.1
```

**응답 204 No Content** (성공, 본문 없음)

**응답 404 Not Found**

```json
{ "error": "user not found" }
```

---

### 3.7 PATCH `/user/{id}/attributes` — 사용자 속성 부분 업데이트

로그인 후 `lastLoginDate` 기록, 휴면 해제, 재활성화 토큰 초기화 등에 사용됩니다.
**포함된 키만 변경하고, 포함되지 않은 키는 기존 값을 유지해야 합니다.**

**요청**

```http
PATCH /user/u-9f3a2c1b/attributes HTTP/1.1
Content-Type: application/json

{
  "dormantStatus": "ACTIVE",
  "dormantSince": null,
  "reactivationToken": null,
  "lastLoginDate": "2026-03-09T12:00:00"
}
```

| 값 | 동작 |
|----|------|
| 문자열 | 해당 속성을 지정된 값으로 저장 |
| `null` | 해당 속성 삭제 (키 제거) |
| 키 자체 미포함 | 기존 값 유지 (변경 없음) |

**응답 204 No Content** (성공, 본문 없음)

**응답 404 Not Found**

```json
{ "error": "user not found" }
```

> 이 엔드포인트는 호출 빈도가 높습니다 (로그인 성공 시마다 호출).
> partial update 의미를 반드시 지켜야 합니다. 전체 덮어쓰기(PUT 방식)로 구현하면 다른 속성이 유실됩니다.

---

### 3.8 PATCH `/user/{id}/attributes/multi` — 사용자 다중값 속성 부분 업데이트

하나의 속성 키에 여러 값(List)을 저장할 때 사용됩니다.
약관 동의 이력 등 다중값이 필요한 속성을 관리합니다.
**포함된 키만 변경하고, 포함되지 않은 키는 기존 값을 유지해야 합니다.**

**요청**

```http
PATCH /user/u-9f3a2c1b/attributes/multi HTTP/1.1
Content-Type: application/json

{
  "agreed_terms": ["v2024-01-01", "v2025-07-01"],
  "notification_channels": ["EMAIL", "SMS"]
}
```

| 값 | 동작 |
|----|------|
| 문자열 배열 | 해당 속성을 지정된 리스트로 저장 |
| `null` | 해당 속성 삭제 (키 제거) |
| 키 자체 미포함 | 기존 값 유지 (변경 없음) |

**응답 204 No Content** (성공, 본문 없음)

**응답 404 Not Found**

```json
{ "error": "user not found" }
```

---

### 3.9 GET `/credential/{id}` — 자격증명 조회

로그인 비밀번호 검증 시 호출됩니다. `{id}`는 사용자 ID와 동일합니다.

Keycloak은 이 응답값으로 `PasswordHashProvider.verify(평문PW, 저장된해시)` 를 수행합니다.
**검증 알고리즘은 응답의 `algorithm` 필드를 기준으로 결정됩니다.** Realm 정책과 무관합니다.

**요청**

```http
GET /credential/u-9f3a2c1b HTTP/1.1
Accept: application/json
```

**응답 200 OK — argon2 예시 (Keycloak 기본값)**

```json
{
  "id": "u-9f3a2c1b",
  "value": "AXTqHqbW...base64encodedHashValue",
  "salt": "Yx3kP2...base64encodedSalt",
  "algorithm": "argon2",
  "iterations": 5,
  "additionParameters": "{\"parallelism\":[\"1\"],\"memory\":[\"65536\"],\"type\":[\"id\"],\"version\":[\"1.3\"]}",
  "type": "password",
  "updatedDate": "2026-03-01T08:00:00"
}
```

**응답 200 OK — bcrypt 예시 (레거시 DB 마이그레이션 없이 연동 시)**

```json
{
  "id": "u-9f3a2c1b",
  "value": "$2a$12$existingBcryptHashFromLegacyDB",
  "salt": "",
  "algorithm": "bcrypt",
  "iterations": 12,
  "additionParameters": "{}",
  "type": "password",
  "updatedDate": "2026-03-01T08:00:00"
}
```

> bcrypt는 솔트가 해시 문자열 내에 포함되므로 `salt` 필드는 빈 문자열로 전달합니다.

| 응답 필드 | 타입 | 필수 | 설명 |
|-----------|------|------|------|
| `id` | string | Y | 사용자 ID |
| `value` | string | Y | 해시된 비밀번호 값. Keycloak이 PUT으로 전송한 값 그대로 저장·반환 |
| `salt` | string | Y | Base64 인코딩된 솔트. Keycloak이 PUT으로 전송한 값 그대로 저장·반환 |
| `algorithm` | string | Y | 해시 알고리즘 식별자. 이 값을 기준으로 검증 알고리즘 결정 |
| `iterations` | int | Y | 해시 반복 횟수 |
| `additionParameters` | string | Y | 알고리즘 추가 파라미터 (JSON 문자열). argon2의 경우 memory, parallelism 등 포함 |
| `type` | string | N | 고정값 `"password"` |
| `updatedDate` | string | N | 마지막 변경 일시 (ISO 8601) |

**응답 404 Not Found**

```json
{ "error": "credential not found" }
```

> 평문 비밀번호를 절대 반환하지 마세요.
> `value`, `salt`, `additionParameters` 는 Keycloak이 PUT으로 전송한 값을 변환 없이 그대로 반환해야 합니다. 중간에 재인코딩하거나 파싱하면 검증이 실패합니다.

---

### 3.10 PUT `/credential/{id}` — 자격증명 업데이트

비밀번호 변경 시 호출됩니다. Keycloak이 직접 해시한 결과를 전송합니다.
**전달된 모든 필드를 변환 없이 그대로 저장해야 합니다.**

**요청 — argon2 예시**

```http
PUT /credential/u-9f3a2c1b HTTP/1.1
Content-Type: application/json

{
  "id": "u-9f3a2c1b",
  "value": "AXTqHqbW...base64encodedHashValue",
  "salt": "Yx3kP2...base64encodedSalt",
  "algorithm": "argon2",
  "iterations": 5,
  "additionParameters": "{\"parallelism\":[\"1\"],\"memory\":[\"65536\"],\"type\":[\"id\"],\"version\":[\"1.3\"]}",
  "type": "password"
}
```

**응답 204 No Content** (성공, 본문 없음)

**응답 404 Not Found**

```json
{ "error": "credential not found" }
```

---

### 3.11 DELETE `/credential/{id}` — 자격증명 삭제

**요청**

```http
DELETE /credential/u-9f3a2c1b HTTP/1.1
```

**응답 204 No Content** (성공, 본문 없음)

**응답 404 Not Found**

```json
{ "error": "credential not found" }
```

---

## 4. 데이터 스키마

### 사용자 객체 (ExternalUser)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `username` | string | Y | 로그인 아이디. 변경 불가 권장 |
| `firstName` | string | N | 이름 |
| `lastName` | string | N | 성 |
| `email` | string | N | 이메일 주소 |
| `enabled` | boolean | Y | `false` 이면 로그인 차단 |
| `emailVerified` | boolean | Y | 이메일 인증 여부 |
| `createdDate` | string | N | 가입 일시 (ISO 8601, `yyyy-MM-ddTHH:mm:ss`) |
| `attributes` | object | Y | 도메인 속성 맵. 빈 객체 `{}` 허용, `null` 불허 |

### 자격증명 객체 (CredentialData)

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `id` | string | Y | 사용자 ID와 동일 |
| `value` | string | Y | 해시된 비밀번호 값 |
| `salt` | string | Y | Base64 인코딩된 솔트. bcrypt는 빈 문자열 허용 |
| `algorithm` | string | Y | 해시 알고리즘 식별자 (`argon2`, `bcrypt`, `pbkdf2-sha256` 등) |
| `iterations` | int | Y | 해시 반복 횟수 |
| `additionParameters` | string | Y | 알고리즘 추가 파라미터 JSON 문자열. 없으면 `"{}"` |
| `type` | string | N | 고정값 `"password"` |
| `updatedDate` | string | N | 마지막 변경 일시 (ISO 8601) |

#### 지원 알고리즘

Keycloak이 지원하는 알고리즘이면 자유롭게 선택할 수 있습니다.
검증 시 Realm 정책과 무관하게 **저장된 `algorithm` 필드 기준**으로 해시 제공자가 선택됩니다.

| algorithm 값 | 설명 | additionParameters 예시 |
|-------------|------|------------------------|
| `argon2` | Keycloak 기본값. 권장 | `{"parallelism":["1"],"memory":["65536"],"type":["id"],"version":["1.3"]}` |
| `bcrypt` | 레거시 DB 연동 시 마이그레이션 없이 사용 가능 | `{}` |
| `pbkdf2-sha256` | PBKDF2 + SHA-256 | `{}` |
| `pbkdf2-sha512` | PBKDF2 + SHA-512 | `{}` |

---

## 5. attributes 필드 규격

`attributes`는 `Map<String, String>` 구조입니다. 모든 값은 **문자열**이어야 합니다.

### 시스템 예약 키 (Keycloak USP가 직접 읽고 씁니다)

| 키 | 타입(문자열) | 예시 값 | 설명 |
|----|-------------|---------|------|
| `dormantStatus` | enum 문자열 | `ACTIVE`, `DORMANT` | 휴면 상태 |
| `dormantSince` | ISO 8601 | `2025-12-01T00:00:00` | 휴면 전환 일시 |
| `reactivationToken` | string | `482916` | 6자리 재활성화 토큰 |
| `reactivationTokenExpiresAt` | ISO 8601 | `2026-03-09T13:00:00` | 토큰 만료 일시 |
| `lastLoginDate` | ISO 8601 | `2026-03-09T12:00:00` | 마지막 로그인 일시 |
| `phoneNumber` | string | `010-1234-5678` | 전화번호 |
| `otpMethod` | enum 문자열 | `SMS`, `EMAIL`, `TOTP` | OTP 수신 방식 |
| `birthday` | date 문자열 | `1990-01-01` | 생년월일 |
| `gender` | string | `M`, `F` | 성별 |
| `termsAccepted` | boolean 문자열 | `true`, `false` | 이용약관 동의 여부 |

> 위 키 외에 업체가 추가로 저장해야 하는 속성이 있으면 사전 협의 후 추가할 수 있습니다.

### 주의사항

- 모든 값은 `String` 타입. 숫자, boolean을 문자열로 직렬화해야 합니다.
  - 올바른 예: `"enabled": "true"` (attributes 내부)
  - 잘못된 예: `"enabled": true` (attributes 내부에서는 오류)
- `attributes` 자체가 `null`이면 USP에서 NullPointerException이 발생합니다. 빈 객체 `{}` 로 반환하세요.

---

## 6. 오류 응답 규격

| HTTP 상태 코드 | 의미 | 사용 시점 |
|----------------|------|-----------|
| `200 OK` | 성공 (본문 있음) | GET 조회 성공 |
| `201 Created` | 생성 성공 | POST /user 성공 |
| `204 No Content` | 성공 (본문 없음) | DELETE, PUT, PATCH 성공 |
| `404 Not Found` | 대상 없음 | 사용자/자격증명 ID 없음 |
| `409 Conflict` | 중복 | username 또는 email 이미 존재 |
| `500 Internal Server Error` | 서버 오류 | 처리 실패 |

오류 응답 본문 형식:

```json
{ "error": "오류 설명 문자열" }
```

> 404 대신 200 + 빈 배열, 또는 200 + `null` 반환은 허용되지 않습니다.
> 명세에 기재된 HTTP 상태 코드를 정확히 사용해야 합니다.

---

## 7. 연계 체크리스트

외부 시스템 개발 완료 후 Keycloak 담당자와 함께 아래 항목을 검증합니다.

### API 구현 확인

- [ ] `GET /user/{id}` — 존재하는 ID로 조회 시 `attributes` 포함 200 응답
- [ ] `GET /user/{id}` — 없는 ID로 조회 시 404 응답
- [ ] `GET /user/search?username=xxx` — 일치 결과 배열 반환
- [ ] `GET /user/search?username=없는값` — 빈 배열 `[]` 반환 (404 아님)
- [ ] `GET /user/count?dormantStatus=ACTIVE` — 정수 반환
- [ ] `GET /user/count/all` — 정수 반환
- [ ] `POST /user` — 생성 후 `id` 포함 201 응답
- [ ] `POST /user` — 동일 username 재생성 시 409 응답
- [ ] `DELETE /user/{id}` — 204 응답
- [ ] `PATCH /user/{id}/attributes` — `null` 값 키는 삭제, 미포함 키는 유지 확인
- [ ] `PATCH /user/{id}/attributes/multi` — 리스트 값 저장, `null` 키는 삭제, 미포함 키는 유지 확인
- [ ] `GET /credential/{id}` — `value`, `salt`, `algorithm`, `iterations`, `additionParameters` 포함 200 응답
- [ ] `GET /credential/{id}` — `additionParameters` 가 JSON 문자열 (파싱된 객체가 아님)
- [ ] `PUT /credential/{id}` — 전달된 필드 변환 없이 저장 후 204 응답
- [ ] `GET /credential/{id}` — PUT으로 저장한 값과 동일한 값 반환 확인
- [ ] `DELETE /credential/{id}` — 204 응답

### 데이터 스키마 확인

- [ ] `attributes` 필드가 `null`이 아닌 객체 `{}` 반환
- [ ] `attributes` 내 모든 값이 String 타입
- [ ] `dormantStatus` 값이 `ACTIVE` 또는 `DORMANT` 중 하나
- [ ] 날짜/시간 값이 `yyyy-MM-ddTHH:mm:ss` 형식
- [ ] `CredentialData.salt` 가 Base64 문자열 그대로 저장·반환 (디코딩 금지)
- [ ] `CredentialData.additionParameters` 가 JSON 문자열 그대로 저장·반환 (재직렬화 금지)

### 비기능 확인

- [ ] 응답 시간 99 퍼센타일 500ms 이하
- [ ] `Content-Type: application/json` 응답 헤더 포함
- [ ] 비밀번호 평문이 어떤 응답에도 포함되지 않음
- [ ] HTTPS 적용

---

## 부록. 외부에서 Argon2 비밀번호 직접 생성 (Java)

Keycloak USP를 통하지 않고 외부 시스템에서 직접 비밀번호를 초기 생성할 때 사용합니다.
Keycloak 기본 알고리즘인 `argon2`(iterations=-1 → 내부 기본값 5) 포맷으로 생성합니다.

### 의존성

```xml
<!-- Keycloak과 동일한 Bouncycastle 라이브러리 사용 -->
<dependency>
    <groupId>org.bouncycastle</groupId>
    <artifactId>bcprov-jdk18on</artifactId>
    <version>1.78.1</version>
</dependency>
```

### 구현 코드

```java
import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;

import java.security.SecureRandom;
import java.util.Base64;

public class Argon2PasswordHasher {

    // Keycloak argon2 기본값 (iterations=-1 전달 시 내부 적용 값)
    private static final int ITERATIONS    = 5;
    private static final int MEMORY_KB     = 65536;  // 64MB
    private static final int PARALLELISM   = 1;
    private static final int HASH_LENGTH   = 32;
    private static final int SALT_LENGTH   = 16;

    public static CredentialPayload hash(String plainPassword) {
        byte[] salt = new byte[SALT_LENGTH];
        new SecureRandom().nextBytes(salt);

        Argon2Parameters params = new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)  // version=1.3
                .withIterations(ITERATIONS)
                .withMemoryAsKB(MEMORY_KB)
                .withParallelism(PARALLELISM)
                .withSalt(salt)
                .build();

        byte[] hash = new byte[HASH_LENGTH];
        Argon2BytesGenerator generator = new Argon2BytesGenerator();
        generator.init(params);
        generator.generateBytes(plainPassword.toCharArray(), hash);

        // PUT /credential/{id} 전송 본문
        return new CredentialPayload(
            Base64.getEncoder().encodeToString(hash),   // value
            Base64.getEncoder().encodeToString(salt),   // salt
            "argon2",
            ITERATIONS,
            "{\"parallelism\":[\"1\"],\"memory\":[\"65536\"],\"type\":[\"id\"],\"version\":[\"1.3\"]}",
            "password"
        );
    }
}
```

### 생성된 PUT 요청 본문 예시

```json
{
  "id": "u-9f3a2c1b",
  "value": "base64encodedRawHashBytes==",
  "salt": "base64encodedRawSaltBytes==",
  "algorithm": "argon2",
  "iterations": 5,
  "additionParameters": "{\"parallelism\":[\"1\"],\"memory\":[\"65536\"],\"type\":[\"id\"],\"version\":[\"1.3\"]}",
  "type": "password"
}
```

> `additionParameters`의 값 형식은 `["문자열"]` 배열입니다. Keycloak 내부 `MultivaluedHashMap` 직렬화 포맷이므로 정확히 일치시켜야 합니다.

---

> 문의: Keycloak 담당자에게 연락하세요.
