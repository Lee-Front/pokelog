# 연동 관리 (Connect) 기능 설계

**작성일**: 2026-03-29
**상태**: 승인됨

---

## 개요

사용자가 자신의 외부 서비스(GitHub, Notion, Jira, Slack 등)를 직접 연동하고 관리할 수 있는 UI 및 백엔드 기능. 커밋/문서 편집/이슈 완료 등의 활동이 포켓몬 경험치와 야생 조우 이벤트로 변환된다.

---

## 배경 및 문제

기존 구조의 한계:
- 레포 등록이 admin API 전용 → 유저가 직접 연동 불가
- 이메일 매칭(`match git <email>`)이 연동 설정과 분리되어 UX가 불편
- 서버 운영자가 유저마다 다른 레포를 미리 알 수 없음

---

## 설계 결정

### 연동 방식: 폴링

webhook 방식이 성능상 최선이나, 개인 PC 환경(공인 IP 없음, 방화벽 등)에서 외부 서비스가 서버로 push 할 수 없으므로 **폴링**을 채택.
소규모 사용(팀 단위 수십 명)에서는 폴링 부하가 무시할 수준.

### 데이터 오너십: 유저별

기존 admin 등록 방식 폐기. 각 유저의 데이터에 `integrations` 필드를 두고, 폴링 워커가 전체 유저의 integrations를 수집해 중복 제거 후 처리.
기존 `config.polling.repos` (admin 전용) 및 `POST /api/admin/repo` 엔드포인트는 폐기.

### 이메일 매칭: 연동 설정 내 통합

기존 `user.account.matchings.git.emails`를 integrations 내부로 흡수.
토큰 기반 연동 시 이메일 자동 감지, URL 기반 연동 시 직접 입력.

### 이메일 중복 정책

동일 이메일을 여러 유저가 등록할 수 없음. 연동 추가 시 서버에서 중복 체크 → 이미 다른 유저가 등록한 이메일이면 거부.

### 토큰 보안

API 토큰 등 민감한 값은 유저 JSON에 평문 저장.
현재 프로젝트 특성상(소규모, 개인 서버) 암호화 vault 도입은 과도함. 단, 파일 권한을 600으로 설정하고 `.gitignore`에 `pokelog-data/` 포함 필수. 추후 암호화 레이어 추가 고려.

---

## 지원 서비스

| 서비스 | 연동 방식 | 감시 범위 |
|--------|-----------|-----------|
| GitHub / GitLab | Personal Access Token | 계정 전체 레포 + 전체 브랜치 |
| Git (public URL) | 레포 URL 직접 입력 | 해당 레포 전체 브랜치 |
| Notion | Integration Token | 연결된 페이지 전체 |
| Jira | API Token + 서버 URL | 할당된 프로젝트 전체 |
| Slack | Bot Token | 지정 채널 |

> Private Git 레포(SSH/HTTPS+토큰) 지원은 이번 범위에서 제외. Public URL만 지원.
> 구조는 확장 가능하게 설계. 새 서비스 추가 시 provider 모듈과 보상 config만 추가하면 됨.

---

## 데이터 구조

### 유저 데이터 (`user.integrations`)

```typescript
interface Integration {
  id: string;           // UUID
  provider: "github" | "gitlab" | "git" | "notion" | "jira" | "slack";
  label: string;        // 표시용 이름 (예: "github.com/myuser")
  config: Record<string, string>;  // 토큰, URL 등 provider별 설정값
  emails: string[];     // 커밋 author email (git 계열만 사용)
  status: "untested" | "testing" | "ok" | "error";
  lastError?: string;
  failCount: number;    // 연속 실패 횟수 (3회 초과 시 폴링 일시 중단)
  addedAt: string;      // ISO 8601 UTC
  lastCheckedAt?: string;
}
```

`UserData`에 `integrations: Integration[]` 필드 추가 (shared/types.ts).

### 서버 보상 config (`config.rewards`)

```json
{
  "rewards": {
    "git": {
      "commit": 50
    },
    "notion": {
      "page_created": 30,
      "page_edited": 10
    },
    "jira": {
      "issue_done": 100,
      "issue_created": 10,
      "issue_commented": 5
    },
    "slack": {
      "message": 5,
      "cooldownMinutes": 5,
      "dailyMax": 20
    }
  }
}
```

운영자가 `PUT /api/admin/config`로 조정 가능.

---

## UI 흐름

### 진입점

- 인터랙티브 모드: `connect` 명령어 (help 메뉴에 추가)
- CLI 직접 실행: `pokelog connect`

### 화면 1: 서비스 목록

```
  연동 관리
  ──────────────────────────────────────────────────
  ↑↓ 탐색   Enter 선택   Esc 뒤로

  ❯ GitHub / GitLab   ● 연동됨 (2개)
    Git (URL)         ○ 미연동
    Notion            ● 연동됨 (1개)
    Jira              ○ 미연동
    Slack             ✗ 오류
```

### 화면 2: 서비스 상세 (예: GitHub)

```
  GitHub / GitLab
  ──────────────────────────────────────────────────
  ↑↓ 탐색   Enter 선택   D 삭제   T 테스트   Esc 뒤로

  ❯ [+ 새 토큰 추가]
    github.com/alice   ✓ 정상    마지막 확인 5분 전
    gitlab.com/alice   ✗ 오류    토큰 만료 (3회 실패)
```

- D 삭제: "정말 삭제할까요? (Y/N)" 확인 후 진행
- T 테스트: 10초 타임아웃, 타임아웃 시 "연결 시간 초과" 표시
- 오류 3회 이상 연속 실패 항목은 자동 폴링 중단, 수동 테스트로만 재활성화

### 화면 3: 추가 입력 (예: GitHub 토큰 추가)

```
  GitHub 토큰 추가
  ──────────────────────────────────────────────────
  ↑↓ 탐색   Esc 취소

  Personal Access Token (repo 권한 필요):
  > ghp_xxxxxxxxxxxx▌

  [Enter] 테스트 연결 시작
```

테스트 연결 중:
```
  [연결 테스트 중...]   (Esc로 취소)
  ✓ github.com/alice 확인됨
  ✓ 이메일 alice@example.com 자동 감지됨

  [Enter] 저장
```

Git URL 수동 입력 시 흐름:
1. URL 입력 (필수)
2. 테스트 연결 (git ls-remote로 접근 가능 여부 확인)
3. 커밋 author 이메일 입력 (필수, 미입력 시 저장 불가)
4. 저장

---

## 백엔드 변경

### 새 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/user/integrations` | 내 연동 목록 조회 |
| POST | `/api/user/integrations` | 연동 추가 |
| DELETE | `/api/user/integrations/:id` | 연동 삭제 |
| POST | `/api/user/integrations/:id/test` | 연동 테스트 |

### 레거시 API

`POST /api/user/match`, `DELETE /api/user/match` 엔드포인트는 마이그레이션 완료 후 제거.

### 폴링 워커 변경

기존: `config.polling.repos` (admin 등록 목록) 기반
변경: 전체 유저의 `integrations` 수집 → provider별 처리

```
전체 유저 순회
  → integrations 수집
  → git 계열: URL 중복 제거 후 fetch → 커밋 email로 유저 매칭 → 보상 계산
  → notion: 유저별 토큰으로 변경 감지 → 보상 계산
  → jira: 유저별 토큰으로 이슈 상태 변경 감지 → 보상 계산
  → slack: 유저별 토큰으로 채널 메시지 감지 → 쿨다운/일일상한 적용 → 보상 계산
  → failCount >= 3 인 integration은 폴링 건너뜀
```

폴링 워커를 provider별 모듈로 분리:
- `polling/providers/git-provider.ts`
- `polling/providers/notion-provider.ts`
- `polling/providers/jira-provider.ts`
- `polling/providers/slack-provider.ts`

### 자동 재시도 정책

연속 3회 실패 시 해당 integration의 `status = "error"`, 폴링 중단.
유저가 수동으로 "테스트 연결"을 실행하면 `failCount` 초기화 후 재활성화.

---

## 마이그레이션

서버 시작 시 `runMigrations()` 실행. 각 마이그레이션은 idempotent.

```typescript
// migration v1: matchings.git.emails → integrations
for each user:
  if user.account.matchings.git.emails exists:
    create Integration {
      provider: "git",
      label: "legacy",
      emails: user.account.matchings.git.emails,
      status: "untested",
      ...
    }
    push to user.integrations
    delete user.account.matchings.git
    save user
```

마이그레이션 상태는 `pokelog-data/migrations.json`에 기록. 이미 실행된 마이그레이션은 재실행하지 않음.

---

## 보상 계산

### Git 계열
기존 로직 유지 (바이트 변화량 기반). `config.rewards.git.commit`은 바이트당 배율에 곱해지는 기본 보상 계수.

### 기타 서비스
이벤트 종류별 고정 보상값. Slack은 `cooldownMinutes`, `dailyMax` 적용.
모든 보상은 운영자가 config에서 조정 가능.

---

## 타임스탬프 처리

모든 타임스탬프는 ISO 8601 UTC로 저장. CLI 표시 시 로컬 시간대로 변환 (`Intl.DateTimeFormat` 사용).

---

## 미결 사항

- Private Git 레포 지원 (SSH 키 또는 HTTPS 토큰) — 장기 과제
- GitHub App / OAuth 방식 지원 — 장기 과제
- 토큰 암호화 저장 — 장기 과제
