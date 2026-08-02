---
title: "휴면 계정 테스트"
sidebar_position: 7
---

## 1. 설정 기준

| 설정 항목 | 값 | 트리거 조건 |
|----------|-----|-----------|
| Dormant Period | 365일 | `lastLogin < now - 365일` → DORMANT |
| Warning Period | 30일 | `lastLogin < now - (365-30)일` → now - **335일** 이전이면 WARNING |
| Enable Account Deletion | On | - |
| Soft Delete Period | 90일 | `dormantSince + 90일 ≤ now` → DELETED |
| Soft Delete Warning Period | 30일 | `dormantSince + 30일 ≤ now` → PENDING_DELETE |

## 2. 타임라인

```
Day 0     Day 335    Day 365    Day 395           Day 455
  │          │          │          │                 │
  └─ACTIVE───┤─WARNING──┤─DORMANT──┤──PENDING_DELETE─┤──DELETED
           (365-30)            (dormantSince+30)  (dormantSince+90)
```

---

## 3. 전체 테스트 시나리오

| Stage | 상태 전이 | DB 검증 | 로그인 검증 | 재활성화 검증 | 멱등성 |
|-------|---------|--------|-----------|------------|-------|
| 준비 | 환경 구성 + 계정 생성 + 최초 로그인 | lastLoginDate 생성 | 로그인 성공 | - | - |
| 1 | ACTIVE → WARNING | dormantStatus, dormantWarningDate | 로그인 성공 | - | ✓ |
| 2 | WARNING → DORMANT | dormantStatus, dormantSince | 휴면 안내 화면 | 유효 토큰 / 잘못된 토큰 / 만료 토큰 / 취소 | ✓ |
| 3 | DORMANT → PENDING_DELETE | dormantStatus, finalDeleteDate | 삭제 예정 안내 + D-day | 유효 토큰 / 취소 | ✓ |
| 4 | PENDING_DELETE → DELETED | dormantStatus, enabled=false | 로그인 차단 | - | ✓ |

---

## 4. 테스트 환경 구성

### 4.1 Realm 생성

```
Admin Console → Realms → Create realm
```

| 항목 | 값 |
|------|-----|
| Realm name | `dormant-test` |
| Enabled | On |

---

### 4.2 테마 설정

```
Admin Console → dormant-test → Realm settings → Themes
```

| 항목 | 값 |
|------|-----|
| Login theme | `keycloak.ext` |
| Email theme | `keycloak.ext` |

> `keycloak.ext` 테마에 휴면 관련 화면 템플릿이 포함되어 있음
> - `account-dormant.ftl` — 휴면 안내 화면
> - `account-pending-delete.ftl` — 삭제 예정 안내 화면
> - `account-reactivation.ftl` — 재활성화 토큰 입력 화면

---

### 4.3 SMTP 이메일 설정

```
Admin Console → dormant-test → Realm settings → Email
```

| 항목 | 값 |
|------|-----|
| From | 테스트용 발신 이메일 |
| Host | SMTP 서버 주소 |
| Port | 587 (또는 환경에 맞게) |
| Authentication | 필요 시 설정 |

> 재활성화 토큰이 이메일로 발송되므로 실제 수신 가능한 계정으로 설정 필요
> 설정 후 [Test connection] 버튼으로 발송 확인

---

### 4.4 이벤트 리스너 설정 (Last Login Tracker)

```
Admin Console → dormant-test → Realm settings → Events → Event listeners
```

| 항목 | 값 |
|------|-----|
| 추가할 리스너 | `last-login-tracker` |

> 로그인 성공(LOGIN 이벤트) 시 `lastLoginDate` 속성을 자동으로 현재 시각으로 기록
> 이 설정이 없으면 lastLoginDate가 갱신되지 않아 스케줄러 동작 이상

---

### 4.5 Authentication Flow 설정

Browser Flow에 휴면 계정 체크 Step 추가

#### 기존 Browser Flow 복제

```
Admin Console → dormant-test → Authentication → Flows
→ browser 행 우측 메뉴 → Duplicate
→ 이름 입력: Browser with Dormant Check
```

#### Dormant Account Check 추가

```
Browser with Dormant Check 플로우 선택
→ Forms 서브플로우 내 Username Password Form 아래
→ [Add step] → "Dormant Account Check" 검색 → Add
→ Requirement: REQUIRED 로 설정
→ 순서: Username Password Form 바로 다음으로 이동
```

완성된 플로우 구조:

```
Browser with Dormant Check
├── Cookie                          ALTERNATIVE
├── Identity Provider Redirector    ALTERNATIVE
└── Forms                           ALTERNATIVE
    ├── Username Password Form      REQUIRED
    ├── Dormant Account Check       REQUIRED   ← 추가
    └── OTP Form                    CONDITIONAL (또는 DISABLED)
```

#### Realm에 새 Flow 바인딩

```
Admin Console → dormant-test → Realm settings → Authentication
→ Browser flow → Browser with Dormant Check 선택 → Save
```

---

### 4.6 Required Action 설정

```
Admin Console → dormant-test → Authentication → Required actions
```

| Action | 표시명 | Enabled | Default Action |
|--------|-------|---------|---------------|
| `REACTIVATE_ACCOUNT` | Reactivate Dormant Account | On | Off |

> Default Action은 Off — 인증 플로우에서 동적으로 추가되므로 기본 등록 불필요

---

### 4.7 User Federation 설정 (휴면 스케줄러)

```
Admin Console → dormant-test → User Federation → Add provider
→ dormant-account-scheduler 선택
```

| 항목 | 값 |
|------|-----|
| Provider ID | `dormant-account-scheduler` |
| Console display name | Dormant Account Scheduler |
| Enabled | On |
| Enable Dormant Account Processing | On |
| Dormant Period (Days) | `365` |
| Warning Period (Days) | `30` |
| Enable Account Deletion | On |
| Soft Delete Period (Days) | `90` |
| Soft Delete Warning Period (Days) | `30` |
| Login URL | 테스트 로그인 URL (이메일 버튼용, 없으면 공백) |

> 저장 후 [Synchronize all users] 버튼으로 수동 Sync 가능

---

## 5. 공통 작업 지침

> **⚠ SQL 변경 후 Sync를 반드시 2회 실행**
> SQL로 DB를 직접 변경하면 Keycloak Infinispan 캐시에 이전 값이 남아있어,
> 1차 Sync는 캐시 무효화 목적으로만 실행하고 2차 Sync에서 실제 처리됨. (Keycloak 26.5)

### 5.1 Sync 실행 위치

```
Admin Console → dormant-test → User Federation → Dormant Account Scheduler
→ [Synchronize all users]
```

### 5.2 각 Stage 표준 절차

```
1. 초기화 SQL 실행  (Stage 1만, 이후 Stage는 이전 속성 유지)
2. 설정 SQL 실행   (lastLoginDate 또는 dormantSince 변경)
3. 1차 Sync 실행   ← 캐시 무효화
4. 2차 Sync 실행   ← 실제 처리
5. DB 검증 SQL 실행
6. 로그인 검증
7. 재활성화 검증   (Stage 2, 3만)
8. Sync 재실행 → 변화 없음 확인 (멱등성)
```

---

## 6. 공통 SQL

### 6.1 초기화
기존에 휴면관련 테스트가 진행된 경우 Stage 1 시작 전 또는 Stage 4 완료 후 복구 시 실행한다.

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
DELETE FROM user_attribute
WHERE name IN (
  'dormantStatus',
  'dormantWarningDate',
  'dormantSince',
  'deletionWarningDate',
  'pendingDeleteDate',
  'finalDeleteDate',
  'deletedAt',
  'reactivationToken',
  'reactivationTokenExpiry'
)
AND user_id = (
  SELECT u.id FROM user_entity u
  JOIN realm r ON u.realm_id = r.id
  WHERE r.name = 'dormant-test' AND u.username = 'dormtest01'
);"
```

### 6.2 enabled 복구 (Stage 4 완료 후)

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
UPDATE user_entity SET enabled = true
WHERE username = 'dormtest01'
  AND realm_id = (SELECT id FROM realm WHERE name = 'dormant-test');"
```

### 6.3 상태 조회

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
SELECT u.username, a.name, a.value
FROM user_attribute a
JOIN user_entity u ON a.user_id = u.id
JOIN realm r ON u.realm_id = r.id
WHERE r.name = 'dormant-test'
  AND u.username = 'dormtest01'
  AND a.name IN (
    'lastLoginDate',
    'dormantStatus',
    'dormantWarningDate',
    'dormantSince',
    'deletionWarningDate',
    'pendingDeleteDate',
    'finalDeleteDate',
    'deletedAt'
  )
ORDER BY a.name;"
```

### 6.4 enabled 상태 조회

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
SELECT u.username, u.enabled
FROM user_entity u
JOIN realm r ON u.realm_id = r.id
WHERE r.name = 'dormant-test' AND u.username = 'dormtest01';"
```

---

## 7. 테스트 계정 준비

### 7.1 계정 생성

```
Admin Console → dormant-test → Users → Create new user
```

| 항목 | 값 |
|------|-----|
| Username | `dormtest01` |
| Email | 실제 수신 가능한 이메일 주소 |
| First Name | Dorm |
| Last Name | Test |
| Email Verified | On |

비밀번호 설정:
```
Users → dormtest01 → Credentials → Set password
Temporary: Off
```

> **이메일 필수**: Stage 2, 3의 재활성화 토큰이 이메일로 발송됨

### 7.2 최초 로그인

브라우저에서 `dormtest01`로 로그인

> 로그인 성공 시 `last-login-tracker` 이벤트 리스너가 `lastLoginDate`를 현재 시각으로 자동 설정

### 7.3 lastLoginDate 생성 확인

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
SELECT u.username, a.name, a.value
FROM user_attribute a
JOIN user_entity u ON a.user_id = u.id
JOIN realm r ON u.realm_id = r.id
WHERE r.name = 'dormant-test'
  AND u.username = 'dormtest01'
  AND a.name = 'lastLoginDate';"
```

| 기대 결과 |
|---------|
| `lastLoginDate` 속성이 현재 시각으로 생성됨 |

---

## 8. Stage 1: ACTIVE → WARNING

**조건**: lastLoginDate = 335일 전 (경고 구간 진입)

### 8.1 실행 순서
1. 설정 SQL 실행
2. 1차 Sync 실행
3. 2차 Sync 실행

### 8.2 설정 SQL

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
UPDATE user_attribute
SET value = to_char(NOW() - INTERVAL '335 days', 'YYYY-MM-DD\"T\"HH24:MI:SS')
WHERE name = 'lastLoginDate'
  AND user_id = (
    SELECT u.id FROM user_entity u
    JOIN realm r ON u.realm_id = r.id
    WHERE r.name = 'dormant-test' AND u.username = 'dormtest01'
  );"
```

### 8.3 DB 검증

상태 조회 SQL 실행 후 확인

| 속성 | 기대값 |
|------|-------|
| dormantStatus | `WARNING` |
| dormantWarningDate | 현재 시각 (Sync 실행 시점) |

### 8.4 로그인 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| dormtest01 로그인 시도 | **로그인 성공** (WARNING은 차단하지 않음) |

> ⚠ 로그인 성공 시 `lastLoginDate`가 현재 시각으로 갱신됨
> Stage 2 진행 전 설정 SQL을 반드시 재실행할 것

### 8.5 멱등성 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| Sync 재실행 | 상태 변화 없음 (`dormantWarningDate` 이미 설정됨) |

---

## 9. Stage 2: WARNING → DORMANT

**조건**: lastLoginDate = 365일 전 (Stage 1 속성 유지, lastLoginDate만 변경)

### 9.1 실행 순서

1. 설정 SQL 실행 (초기화 없이 Stage 1 속성 유지)
2. 1차 Sync 실행()
3. 2차 Sync 실행

### 9.2 설정 SQL

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
UPDATE user_attribute
SET value = to_char(NOW() - INTERVAL '365 days', 'YYYY-MM-DD\"T\"HH24:MI:SS')
WHERE name = 'lastLoginDate'
  AND user_id = (
    SELECT u.id FROM user_entity u
    JOIN realm r ON u.realm_id = r.id
    WHERE r.name = 'dormant-test' AND u.username = 'dormtest01'
  );"
```

### 9.3 DB 검증

상태 조회 SQL 실행 후 확인

| 속성 | 기대값 |
|------|-------|
| dormantStatus | `DORMANT` |
| dormantSince | lastLoginDate + 365일 |

### 9.4 로그인 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| dormtest01 로그인 시도 | **휴면 안내 화면** (`account-dormant.ftl`) |

### 9.5 재활성화 검증

| # | 시나리오 | 방법 | 기대 결과 |
|---|---------|------|---------|
| R-01 | 유효 토큰 | 이메일로 수신한 토큰 입력 | 로그인 성공, 모든 휴면 속성 제거, lastLoginDate 갱신 |
| R-02 | 잘못된 토큰 | 임의 번호 입력 | `invalidToken` 오류 표시 |
| R-03 | 만료된 토큰 | 아래 SQL로 만료 조작 후 정상 토큰 입력 | `tokenExpired` 오류 표시 |
| R-04 | 취소 | 취소 버튼 클릭 | 로그인 취소 |

**R-03 만료 토큰 조작 SQL** (화면에서 토큰 발급 후 실행):

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
UPDATE user_attribute
SET value = to_char(NOW() - INTERVAL '2 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS')
WHERE name = 'reactivationTokenExpiry'
  AND user_id = (
    SELECT u.id FROM user_entity u
    JOIN realm r ON u.realm_id = r.id
    WHERE r.name = 'dormant-test' AND u.username = 'dormtest01'
  );"
```

> **R-01 완료 후 확인**: 상태 조회 SQL로 `dormantStatus` / `dormantSince` / `dormantWarningDate` /
> `reactivationToken` / `reactivationTokenExpiry` 속성이 모두 제거됐는지 확인
>
> **R-01 완료 후 Stage 3 진행 시**: DORMANT 상태로 복구 필요
> → 초기화 SQL 실행 → Stage 2 설정 SQL + Sync 2회 재실행

### 9.6 멱등성 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| Sync 재실행 | 상태 변화 없음 (`dormantStatus=DORMANT` 이미 설정됨) |

---

## 10. Stage 3: DORMANT → PENDING_DELETE

**조건**: dormantSince = 30일 전 (Stage 2 완료 후 dormantSince만 변경)

### 10.1 실행 순서

1. 설정 SQL 실행 (dormantSince만 변경)
2. 1차 Sync 실행
3. 2차 Sync 실행

### 10.2 설정 SQL

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
UPDATE user_attribute
SET value = to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD\"T\"HH24:MI:SS')
WHERE name = 'dormantSince'
  AND user_id = (
    SELECT u.id FROM user_entity u
    JOIN realm r ON u.realm_id = r.id
    WHERE r.name = 'dormant-test' AND u.username = 'dormtest01'
  );"
```

### 10.3 DB 검증

상태 조회 SQL 실행 후 확인

| 속성 | 기대값 |
|------|-------|
| dormantStatus | `PENDING_DELETE` |
| deletionWarningDate | 현재 시각 (Sync 실행 시점) |
| pendingDeleteDate | 현재 시각 (Sync 실행 시점) |
| finalDeleteDate | dormantSince + 90일 |

### 10.4 로그인 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| dormtest01 로그인 시도 | **삭제 예정 안내 화면** (`account-pending-delete.ftl`) |
| D-day 표시 | `finalDeleteDate` 날짜가 화면에 표시되는지 확인 |

### 10.5 재활성화 검증

| # | 시나리오 | 방법 | 기대 결과 |
|---|---------|------|---------|
| R-05 | 유효 토큰 | 이메일로 수신한 토큰 입력 | 로그인 성공, `finalDeleteDate` 포함 모든 삭제 속성 제거 |
| R-06 | 취소 | 취소 버튼 클릭 | 로그인 취소 |

> **R-05 완료 후 확인**: 상태 조회 SQL로 `dormantStatus` / `dormantSince` / `deletionWarningDate` /
> `pendingDeleteDate` / `finalDeleteDate` 속성이 모두 제거됐는지 확인
>
> **R-05 완료 후 Stage 4 진행 시**: DORMANT 상태로 복구 필요
> → 초기화 SQL 실행 → Stage 2 설정 SQL + Sync 2회 → Stage 3 설정 SQL + Sync 2회 재실행

### 10.6 멱등성 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| Sync 재실행 | 상태 변화 없음 (`deletionWarningDate` 이미 설정됨) |

---

## 11. Stage 4: PENDING_DELETE → DELETED

**조건**: dormantSince = 90일 전 (Stage 3 완료 후 dormantSince만 변경)

### 11.1 실행 순서

1. 설정 SQL 실행 (dormantSince만 변경)
2. 1차 Sync 실행
3. 2차 Sync 실행

### 11.2 설정 SQL

```sql
docker exec docker-postgres_db-1 psql -U keycloak -d keycloak -c "
UPDATE user_attribute
SET value = to_char(NOW() - INTERVAL '90 days', 'YYYY-MM-DD\"T\"HH24:MI:SS')
WHERE name = 'dormantSince'
  AND user_id = (
    SELECT u.id FROM user_entity u
    JOIN realm r ON u.realm_id = r.id
    WHERE r.name = 'dormant-test' AND u.username = 'dormtest01'
  );"
```

### 11.3 DB 검증

상태 조회 SQL 실행 후 확인

| 속성 | 기대값 |
|------|-------|
| dormantStatus | `DELETED` |
| deletedAt | 현재 시각 (Sync 실행 시점) |
| enabled | `false` |

### 11.4 로그인 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| dormtest01 로그인 시도 | **로그인 차단** (Keycloak 비활성 계정 처리) |

### 11.5 멱등성 검증

| 검증 항목 | 기대 결과 |
|---------|---------|
| Sync 재실행 | 상태 변화 없음 (`dormantStatus=DELETED` 스킵 처리됨) |

### 11.6 테스트 완료 후 복구

"3. 공통SQL"을 참조하여 테스트 완료후, 다음과 같이 복구작업을 실행한다.

```
1. 초기화 SQL 실행
2. enabled 복구 SQL 실행
3. 로그인 확인
```
