# 연동 관리 (Connect) 기능 설계

**작성일**: 2026-03-29
**상태**: 승인됨

---

## 개요

사용자가 자신의 외부 서비스(GitHub, Notion, Jira, Slack 등)를 직접 연동하고 관리할 수 있는 UI 및 백엔드 기능. 커밋/문서 편집/이슈 완료 등의 활동이 포켓몬 경험치와 야생 조우 이벤트로 변환된다.

최종 범위는 Git, Notion, Jira, Slack 전체를 포함하지만 구현은 순차적으로 진행한다.
우선순위는 `git -> notion -> jira -> slack` 이며, **Phase 1은 Git 연동**이다.

---

## 배경 및 문제

기존 구조의 한계:
- 레포 등록이 admin API 전용 → 유저가 직접 연동 불가
- 이메일 매칭(`match git <email>`)이 레포 설정과 분리되어 UX가 불편
- 개인 레포와 팀 레포를 같은 방식으로 다루기 어려움
- 서버 운영자가 유저마다 다른 레포를 미리 알 수 없음

---

## 설계 결정

### 연동 방식: 폴링

webhook 방식이 성능상 최선이나, 개인 PC 환경(공인 IP 없음, 방화벽 등)에서 외부 서비스가 서버로 push 할 수 없으므로 **폴링**을 채택.
소규모 사용(팀 단위 수십 명)에서는 폴링 부하가 무시할 수준.

### 데이터 오너십: 유저별

기존 admin 등록 방식 폐기. 각 유저의 데이터에 `integrations` 필드를 두고, 폴링 워커가 전체 유저의 integrations를 수집해 중복 제거 후 처리.
기존 `config.polling.repos` (admin 전용) 및 `POST /api/admin/repo` 엔드포인트는 폐기.

### Git 식별 방식: 레포 중심 + 선택적 이메일 필터

Git 계열 연동의 기본 단위는 "계정"이 아니라 **레포지토리**다.

- 개인 레포처럼 레포 전체 활동이 곧 내 활동인 경우:
  이메일 필터 없이 레포 전체 커밋을 집계
- 팀 레포처럼 여러 사람이 함께 쓰는 경우:
  해당 레포에 대해 이메일 필터를 지정해 내 커밋만 집계

즉 Git 연동은 `repoUrl + optional emails[]` 구조를 갖는다.

토큰 기반 연동 시 이메일 자동 감지 기능을 제공할 수 있고, URL 기반 연동 시 이메일을 직접 입력할 수 있다.

### 이메일 중복 정책

같은 레포를 여러 유저가 등록하는 것은 허용한다.

단, **같은 레포에서 같은 이메일을 서로 다른 유저가 등록하는 것은 금지**한다.
연동 추가 또는 수정 시 서버에서 중복 체크 → 이미 다른 유저가 같은 `repoUrl + email` 조합을 등록했으면 거부.

이메일이 비어 있는 "전체 집계" 모드의 경우, 같은 레포를 여러 유저가 모두 전체 집계로 등록하면 보상이 중복 지급될 수 있으므로 UI에서 명확히 경고한다.

### 토큰 보안

API 토큰 등 민감한 값은 유저 JSON에 평문 저장.
현재 프로젝트 특성상(소규모, 개인 서버) 암호화 vault 도입은 과도함. 단, 파일 권한을 600으로 설정하고 `.gitignore`에 `pokelog-data/` 포함 필수. 추후 암호화 레이어 추가 고려.

---

## 지원 서비스

| 서비스 | 연동 방식 | 감시 범위 |
|--------|-----------|-----------|
| GitHub / GitLab | Personal Access Token 또는 레포 선택 | 선택한 레포 전체 브랜치 |
| Git (public URL) | 레포 URL 직접 입력 | 해당 레포 전체 브랜치 |
| Notion | Integration Token | 연결된 페이지 전체 |
| Jira | API Token + 서버 URL | 할당된 프로젝트 전체 |
| Slack | Bot Token | 지정 채널 |

> Git Phase 1에서는 Public URL 기반 등록을 우선 지원한다.
> GitHub / GitLab 토큰 연동은 이후 단계에서 레포 선택과 이메일 자동 감지 기능으로 확장한다.
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
  status: "untested" | "testing" | "ok" | "error";
  lastError?: string;
  failCount: number;    // 연속 실패 횟수 (3회 초과 시 폴링 일시 중단)
  addedAt: string;      // ISO 8601 UTC
  lastCheckedAt?: string;
}
```

`UserData`에 `integrations: Integration[]` 필드 추가 (shared/types.ts).

Git 계열 provider는 아래 확장 필드를 사용한다.

```typescript
interface GitIntegration extends Integration {
  provider: "github" | "gitlab" | "git";
  config: {
    repoUrl: string;
    authMode?: "public" | "token";
    token?: string;
  };
  emails?: string[]; // 비어 있으면 해당 레포 전체 커밋 집계
}
```

판정 규칙:

- `emails`가 비어 있거나 없으면 해당 레포의 모든 커밋을 내 활동으로 인정
- `emails`가 있으면 `author email`이 포함된 커밋만 내 활동으로 인정

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
- Phase 1에서는 Git provider만 먼저 노출하고, 다른 provider는 준비중 상태로 보여줄 수 있음

### 화면 1: 서비스 목록

```
  연동 관리
  ──────────────────────────────────────────────────
  ↑↓ 탐색   Enter 선택   Esc 뒤로

  ❯ GitHub / GitLab   ● 연동됨 (2개)
    Git (URL)         ○ 미연동
    Notion            준비중
    Jira              준비중
    Slack             준비중
```

### 화면 2: 서비스 상세 (예: Git)

```
  Git 연동
  ──────────────────────────────────────────────────
  ↑↓ 탐색   Enter 선택   D 삭제   T 테스트   Esc 뒤로

  ❯ [+ 새 토큰 추가]
    team-repo          ✓ 정상    전체 집계
    company-api        ✓ 정상    alice@co.com, alice@users.noreply.github.com
```

- D 삭제: "정말 삭제할까요? (Y/N)" 확인 후 진행
- T 테스트: 10초 타임아웃, 타임아웃 시 "연결 시간 초과" 표시
- 오류 3회 이상 연속 실패 항목은 자동 폴링 중단, 수동 테스트로만 재활성화

### 화면 3: 추가 입력 (예: Git 레포 추가)

```
  Git 레포 추가
  ──────────────────────────────────────────────────
  ↑↓ 탐색   Esc 취소

  Repository URL:
  > https://github.com/org/team-repo.git▌

  [Enter] 테스트 연결 시작
```

테스트 연결 중:
```
  [연결 테스트 중...]   (Esc로 취소)
  ✓ repository 확인됨

  이 레포 전체 커밋을 내 활동으로 집계할까요?
  [예] 전체 집계
  [아니오] 이메일 필터 지정

  [Enter] 저장
```

Git URL 수동 입력 시 흐름:
1. URL 입력 (필수)
2. 테스트 연결 (git ls-remote로 접근 가능 여부 확인)
3. "전체 집계" 여부 선택
4. 전체 집계가 아니면 커밋 author 이메일 1개 이상 입력
5. 저장

팀 레포에서 전체 집계를 선택하는 경우 경고 문구를 노출:

> 이 설정은 해당 레포의 모든 작성자 커밋을 내 활동으로 집계합니다.

---

## 백엔드 변경

### 새 API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/user/integrations` | 내 연동 목록 조회 |
| POST | `/api/user/integrations` | 연동 추가 |
| PATCH | `/api/user/integrations/:id` | 연동 수정 (이메일 필터 포함) |
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
  → git 계열: repoUrl 중복 제거 후 fetch
             → integration별로 이메일 필터 적용
             → 전체 집계면 레포 전체 커밋 인정
             → 이메일 필터가 있으면 author email 기준으로 매칭
             → 보상 계산
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
      config: { repoUrl: "" },
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
기존 로직 유지 (바이트 변화량 기반).

- 레포 전체 집계 integration: 해당 레포의 모든 커밋 반영
- 이메일 필터 integration: `author email` 일치 커밋만 반영

`config.rewards.git.commit`은 바이트당 배율에 곱해지는 기본 보상 계수.

### 기타 서비스
이벤트 종류별 고정 보상값. Slack은 `cooldownMinutes`, `dailyMax` 적용.
모든 보상은 운영자가 config에서 조정 가능.

---

## 타임스탬프 처리

모든 타임스탬프는 ISO 8601 UTC로 저장. CLI 표시 시 로컬 시간대로 변환 (`Intl.DateTimeFormat` 사용).

---

## 미결 사항

- admin repo 기반 polling과 integrations 기반 polling의 병행 기간 운영 방식
- Private Git 레포 지원 (SSH 키 또는 HTTPS 토큰) — 장기 과제
- GitHub App / OAuth 방식 지원 — 장기 과제
- 토큰 암호화 저장 — 장기 과제
