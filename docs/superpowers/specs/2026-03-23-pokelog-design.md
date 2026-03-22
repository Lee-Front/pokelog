# pokelog 설계 문서

커밋으로 포켓몬을 키우는 개발자 동기부여 CLI 도구

---

## 목차

1. [시스템 아키텍처](#1-시스템-아키텍처)
2. [데이터 저장 구조](#2-데이터-저장-구조)
3. [데이터 수집 (Polling)](#3-데이터-수집-polling)
4. [유저 시스템](#4-유저-시스템)
5. [보상 체계](#5-보상-체계)
6. [콤보 시스템](#6-콤보-시스템)
7. [야생 조우 시스템](#7-야생-조우-시스템)
8. [전투 시스템](#8-전투-시스템)
9. [포획 시스템](#9-포획-시스템)
10. [포켓몬 데이터](#10-포켓몬-데이터)
11. [성장 시스템](#11-성장-시스템)
12. [상점 시스템](#12-상점-시스템)
13. [소셜 기능](#13-소셜-기능)
14. [관리자 기능](#14-관리자-기능)
15. [CLI 인터페이스](#15-cli-인터페이스)
16. [확장 계획](#16-확장-계획)

---

## 1. 시스템 아키텍처

### 1.1 개요

단일 Node.js(TypeScript) 서버와 CLI 클라이언트로 구성된다. 서버는 REST API 제공, git repo polling, 게임 로직 처리를 하나의 프로세스에서 수행한다. CLI는 서버 API를 호출하는 경량 클라이언트이다.

### 1.2 구성도

```
┌────────────────────────────────┐
│       Node.js 서버 (단일)       │
│                                │
│  ┌──────────┐  ┌────────────┐ │
│  │ REST API │  │  Polling   │ │
│  │ (게임/   │  │  Worker    │ │
│  │  관리자)  │  │ (주기적)   │ │
│  └────┬─────┘  └─────┬──────┘ │
│       │               │       │
│       └───────┬───────┘       │
│               │               │
│        ┌──────┴──────┐        │
│        │ JSON 파일    │        │
│        │ (데이터 저장) │        │
│        └─────────────┘        │
└────────────────────────────────┘
         ▲
         │ HTTP
    ┌────┴────┐
    │   CLI   │
    └─────────┘
```

### 1.3 기술 스택

| 항목 | 기술 |
|------|------|
| 언어 | TypeScript |
| 런타임 | Node.js |
| API 프레임워크 | Express 또는 Fastify |
| 데이터 저장 | JSON 파일 |
| CLI | Node.js (서버 API 호출) |
| 터미널 출력 | ANSI 24-bit True Color + 유니코드 반블록 문자 |
| CLI 인터랙션 | inquirer (화살표 키 선택, 리스트, 입력 등) |

### 1.4 패키지 구조

```
pokelog/
  ├── packages/
  │   ├── server/          # API 서버 + Polling Worker
  │   └── cli/             # CLI 클라이언트
  ├── data/                # 게임용 정적 데이터 (포켓몬, 기술, 아이템 등)
  └── pokelog-data/        # 런타임 데이터 (유저, 설정 등) - gitignore 대상
```

---

## 2. 데이터 저장 구조

### 2.1 개요

모든 데이터는 JSON 파일로 관리한다. DB를 사용하지 않는다. 데이터는 단순 텍스트이며, 유저 수가 적고 동시 접근이 낮은 환경을 전제한다.

**동시 쓰기 보호**: Polling Worker와 API가 동시에 같은 유저 파일을 쓸 수 있으므로, atomic write 패턴(임시 파일에 쓰고 rename)을 사용한다.

### 2.2 디렉토리 구조

```
pokelog-data/
  ├── config.json              # 서버 설정
  ├── polling/
  │   └── sync-state.json      # repo별 마지막 확인 커밋 해시
  └── users/
      ├── user1.json           # 유저별 전체 데이터
      └── user2.json
```

### 2.3 config.json

서버 전역 설정. 관리자가 관리한다.

```json
{
  "server": {
    "port": 3000
  },
  "polling": {
    "intervalMinutes": 5,
    "repos": [
      {
        "url": "https://git.company.com/team/project-a.git",
        "branches": ["main", "develop"]
      },
      {
        "url": "https://git.company.com/team/project-b.git",
        "branches": ["main"]
      }
    ]
  },
  "rewards": {
    "expPerByte": 1.0,
    "pointsPerByte": 0.5,
    "combo": {
      "bytesPerMinute": 200,
      "multipliers": [1.0, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
      "maxMultiplier": 2.0
    },
    "encounter": {
      "baseChance": 0.15,
      "ceilingBytes": 10000,
      "timeLimitHours": 48
    }
  },
  "shop": {
    "items": {
      "pokeball": { "name": "몬스터볼", "price": 100, "catchBonus": 1.0 },
      "superball": { "name": "수퍼볼", "price": 300, "catchBonus": 1.5 },
      "hyperball": { "name": "하이퍼볼", "price": 800, "catchBonus": 2.0 },
      "potion": { "name": "상처약", "price": 50, "healAmount": 20 },
      "superPotion": { "name": "좋은상처약", "price": 200, "healAmount": 50 }
    }
  }
}
```

### 2.4 sync-state.json

polling 상태 추적. repo별, 브랜치별 마지막으로 확인한 커밋 해시를 저장한다.

```json
{
  "repos": {
    "https://git.company.com/team/project-a.git": {
      "main": "abc1234...",
      "develop": "def5678..."
    },
    "https://git.company.com/team/project-b.git": {
      "main": "ghi9012..."
    }
  }
}
```

### 2.5 유저 파일 (user1.json)

유저 한 명의 모든 데이터를 하나의 파일에 저장한다.

```json
{
  "account": {
    "id": "user1",
    "password": "hashed_password",
    "nickname": "이재혁",
    "createdAt": "2026-03-23T00:00:00Z",
    "matchings": {
      "git": {
        "emails": ["jhlee@company.com", "jhlee@gmail.com"]
      }
    }
  },
  "points": 4200,
  "totalExp": 128000,
  "combo": {
    "count": 3,
    "lastCommitAt": "2026-03-23T14:30:00Z",
    "lastCommitBytes": 1500
  },
  "encounterCeiling": {
    "accumulatedBytes": 7500
  },
  "party": ["pokemon-a1b2c3d4", "pokemon-e5f6g7h8"],
  "pokemon": [
    {
      "uid": "pokemon-a1b2c3d4",
      "species": "pikachu",
      "nickname": null,
      "level": 15,
      "exp": 320,
      "hp": 38,
      "maxHp": 48,
      "stats": {
        "attack": 32,
        "defense": 20,
        "speed": 45,
        "spAttack": 38,
        "spDefense": 25
      },
      "moves": [
        { "id": "thunderbolt", "pp": 15, "maxPp": 15 },
        { "id": "quick-attack", "pp": 30, "maxPp": 30 },
        { "id": "iron-tail", "pp": 15, "maxPp": 15 }
      ],
      "caughtAt": "2026-03-20T10:00:00Z"
    }
  ],
  "pokedex": ["pikachu", "charmander", "squirtle"],
  "inventory": {
    "pokeball": 5,
    "superball": 2,
    "hyperball": 0,
    "potion": 3,
    "superPotion": 1
  },
  "pendingEvents": [
    {
      "id": "evt-001",
      "type": "wild_encounter",
      "pokemon": {
        "species": "charmander",
        "level": 8,
        "hp": 28,
        "maxHp": 28,
        "stats": { "attack": 15, "defense": 12, "speed": 18, "spAttack": 20, "spDefense": 14 },
        "moves": [
          { "id": "scratch", "pp": 35, "maxPp": 35 },
          { "id": "ember", "pp": 25, "maxPp": 25 }
        ]
      },
      "createdAt": "2026-03-23T10:00:00Z",
      "expiresAt": "2026-03-25T10:00:00Z"
    }
  ],
  "battleState": null,
  "storage": [],
  "log": [
    {
      "type": "reward",
      "commit": "abc1234",
      "repo": "project-a",
      "bytes": 1500,
      "exp": 1500,
      "points": 750,
      "comboMultiplier": 1.4,
      "timestamp": "2026-03-23T14:30:00Z"
    },
    {
      "type": "encounter",
      "species": "charmander",
      "eventId": "evt-001",
      "timestamp": "2026-03-23T14:30:00Z"
    }
  ]
  // log 배열은 최근 200건만 유지한다. 오래된 항목은 자동 삭제.
}
```

---

## 3. 데이터 수집 (Polling)

### 3.1 개요

서버가 config에 등록된 git repo들을 주기적으로 polling하여 새 커밋을 감지한다. 각 프로젝트에는 아무런 설정을 하지 않는다. 모든 설정은 pokelog 서버에서만 관리한다.

### 3.2 동작 흐름

```
1. 서버 시작 시 각 repo의 bare clone 생성 (없으면)
2. intervalMinutes 간격으로 polling 사이클 실행
3. 각 repo에 대해:
   a. git fetch origin
   b. 각 추적 브랜치에 대해:
      - sync-state에서 마지막 확인 해시 조회
      - git log lastHash..origin/branch --format --numstat 실행
      - 새 커밋이 있으면 각 커밋에 대해:
        i.   author email로 유저 매칭
        ii.  바이트 변화량 계산
        iii. 보상 산정 (경험치, 포인트, 콤보, 조우 판정)
        iv.  유저 데이터 갱신
      - sync-state 업데이트
```

### 3.3 바이트 변화량 계산

```bash
# 커밋의 변경된 파일별 old/new blob 해시 추출
git diff-tree -r <commit>

# 각 blob의 크기 조회
git cat-file -s <old_blob>
git cat-file -s <new_blob>

# 바이트 변화량 계산 (파일별):
# 파일 추가: new_size 전체
# 파일 삭제: old_size 전체
# 파일 수정: max(old_size, new_size) — 리팩토링(같은 크기를 다시 작성)도 작업량으로 인정
# 전체 바이트 변화량 = 모든 파일의 변화량 합산
```

삭제 작업도 작업량으로 인정한다. 파일 수정 시 `max()`를 사용하여 크기 변화 없는 리팩토링도 공정하게 반영한다.

### 3.4 머지 커밋 필터링

머지 커밋(부모가 2개 이상)은 보상 산정에서 제외한다. 머지 커밋은 이미 계산된 커밋들의 중복이므로 이중 보상을 방지한다.

```
if commit.parents.length >= 2:
    skip  # 머지 커밋 무시
```

### 3.5 bare clone 관리

```
pokelog-data/
  └── repos/
      ├── project-a.git/    # bare clone
      └── project-b.git/    # bare clone
```

서버가 내부적으로 관리하며, 유저에게 노출되지 않는다.

---

## 4. 유저 시스템

### 4.1 회원가입

- **아이디**: 고유, 영문+숫자, 로그인에 사용
- **비밀번호**: 해시 저장 (bcrypt 등)
- **닉네임**: 가입 후 설정, 언제든 변경 가능, 표시용 이름
- **스타터 포켓몬**: 가입 시 스타터 3종 (이상해씨/파이리/꼬부기) 중 하나를 선택하여 첫 포켓몬으로 지급. 자동으로 파티에 편성된다.

### 4.2 매칭 시스템

유저가 자신의 계정에 각 연동 앱별 식별 정보를 등록한다. **동일한 식별자(이메일 등)를 여러 유저가 등록할 수 없다.** 중복 등록 시도 시 거부한다.

```json
"matchings": {
  "git": {
    "emails": ["jhlee@company.com", "jhlee@gmail.com"]
  }
}
```

**확장 구조**: 새로운 연동 앱이 추가되면 matchings에 새 키를 추가하면 된다.

```json
"matchings": {
  "git": { "emails": ["jhlee@company.com"] },
  "notion": { "userId": "notion-user-abc123" },
  "jira": { "accountId": "jira-acc-xyz789" }
}
```

각 연동 모듈은 자신의 매칭 키 구조를 정의하고, 해당 키로 유저를 식별한다.

### 4.3 인증

- CLI에서 로그인 시 아이디/비밀번호 입력
- 서버가 토큰(JWT 등) 발급
- CLI가 로컬에 토큰 저장하여 이후 요청에 사용
- 가벼운 사내/개인용이므로 복잡한 보안은 적용하지 않음

### 4.4 CLI 로컬 설정

```
~/.pokelog/
  ├── config.json    # 서버 URL
  └── auth.json      # 로그인 토큰
```

---

## 5. 보상 체계

### 5.1 개요

커밋이 감지되면 바이트 변화량을 기준으로 **경험치**와 **포인트**를 동시에 지급한다.

- **경험치**: 보유 포켓몬(파티)의 성장에 사용
- **포인트**: 화폐, 상점에서 아이템 구매에 사용

### 5.2 산정 공식

```
기본 경험치 = 바이트 변화량 × expPerByte (config)
기본 포인트 = 바이트 변화량 × pointsPerByte (config)

최종 경험치 = 기본 경험치 × 콤보 배율
최종 포인트 = 기본 포인트 × 콤보 배율
```

### 5.3 경험치 분배

파티에 포함된 포켓몬들에게 경험치를 분배한다.

- 파티 포켓몬 수로 균등 분배
- 예: 파티 2마리, 경험치 1000 → 각 500씩
- **파티 최대 크기: 6마리**. 파티가 가득 찬 상태에서 새 포켓몬 포획 시 보관함으로 이동
- **파티가 비어있는 경우**: 스타터 포켓몬이 반드시 지급되므로 정상 흐름에서는 발생하지 않음. 만약 발생 시 경험치는 totalExp에만 누적

### 5.4 설정 가능한 값

| 항목 | config 키 | 기본값 | 설명 |
|------|-----------|--------|------|
| 바이트당 경험치 | expPerByte | 1.0 | 1바이트 = 1 경험치 |
| 바이트당 포인트 | pointsPerByte | 0.5 | 1바이트 = 0.5 포인트 |

---

## 6. 콤보 시스템

### 6.1 개요

일정 기준 이상의 작업 밀도로 연속 커밋하면 콤보가 쌓이고, **모든 보상에 배율이 적용**된다.

### 6.2 콤보 판정

```
if 이전 커밋 기록 없음 (첫 커밋):
    combo.count = 1  # 콤보 판정 없이 1로 시작 (배율 1.0)
else:
    커밋 간 작업 밀도 = 바이트 변화량 / 이전 커밋과의 간격(분)
    if 작업 밀도 >= bytesPerMinute (config):
        combo.count += 1
    else:
        combo.count = 1  # 리셋 시 0이 아닌 1 (현재 커밋은 새 콤보의 시작)
```

즉, combo.count는 항상 최소 1이다. 0은 존재하지 않는다. 배율 테이블의 인덱스 0은 사용되지 않는 예비값이다.

### 6.3 배율 테이블

config의 `combo.multipliers` 배열로 관리한다. 인덱스 = 콤보 수.

```
콤보 0: 1.0배 (콤보 없음)
콤보 1: 1.0배 (첫 커밋)
콤보 2: 1.2배
콤보 3: 1.4배
콤보 4: 1.6배
콤보 5: 1.8배
콤보 6+: 2.0배 (상한, maxMultiplier)
```

### 6.4 콤보 적용 범위

- 경험치 배율
- 포인트 배율
- 야생 조우 확률 배율

### 6.5 설정 가능한 값

| 항목 | config 키 | 기본값 | 설명 |
|------|-----------|--------|------|
| 분당 기준 바이트 | combo.bytesPerMinute | 200 | 이 이상이면 콤보 유지 |
| 배율 테이블 | combo.multipliers | [1.0, 1.0, 1.2, ...] | 콤보 수별 배율 |
| 최대 배율 | combo.maxMultiplier | 2.0 | 배율 상한 |

---

## 7. 야생 조우 시스템

### 7.1 개요

커밋 보상 처리 시 확률적으로 야생 포켓몬이 출현한다. 출현한 포켓몬은 pendingEvents에 저장되며, 사용자가 CLI로 확인하고 전투/포획을 진행한다. 타임 리미트 내에 처리하지 않으면 사라진다.

### 7.2 조우 확률

```
실효 확률 = baseChance × 콤보 배율

매 커밋마다:
  if random() < 실효 확률:
    야생 조우 발생
```

### 7.3 천장 시스템

확률에 관계없이, 누적 바이트가 `ceilingBytes`에 도달하면 무조건 1회 조우가 발생한다.

```
encounterCeiling.accumulatedBytes += 커밋 바이트 변화량

if accumulatedBytes >= ceilingBytes:
    야생 조우 강제 발생
    accumulatedBytes = 0  # 리셋
```

천장 도달과 확률 조우가 동시에 발생할 경우, 1회만 발생한다.

### 7.4 출현 포켓몬 결정

지역(region)의 출현 테이블에서 가중치 기반 랜덤으로 결정한다.

```json
// data/regions/default.json
{
  "name": "default",
  "encounters": [
    { "species": "pidgey", "weight": 100, "levelRange": [2, 5] },
    { "species": "rattata", "weight": 100, "levelRange": [2, 5] },
    { "species": "pikachu", "weight": 20, "levelRange": [3, 7] },
    { "species": "charmander", "weight": 10, "levelRange": [5, 10] },
    { "species": "dratini", "weight": 3, "levelRange": [8, 15] }
  ]
}
```

기본 지역(default)은 전체 포켓몬이 레어도별 가중치로 등록된다. 추후 바이옴 시스템 추가 시 새 지역 파일만 추가하면 된다.

### 7.5 타임 리미트

- 조우 발생 시 `expiresAt` 기록 (현재 시간 + timeLimitHours)
- 만료된 이벤트는 다음 polling 시 자동 제거
- 기본값: 48시간

### 7.6 야생 포켓몬 레벨

출현 테이블의 `levelRange` 내에서 랜덤으로 결정된다. 레벨에 따라 HP, 스탯, 보유 기술이 결정된다.

### 7.7 설정 가능한 값

| 항목 | config 키 | 기본값 | 설명 |
|------|-----------|--------|------|
| 기본 조우 확률 | encounter.baseChance | 0.15 | 15% |
| 천장 바이트 | encounter.ceilingBytes | 10000 | 10KB 누적 시 보장 |
| 타임 리미트 | encounter.timeLimitHours | 48 | 48시간 |

---

## 8. 전투 시스템

### 8.1 개요

야생 포켓몬을 만났을 때, 사용자는 CLI에서 턴제 커맨드 전투를 진행한다. 포켓몬 원작의 간소화 버전이다.

### 8.2 전투 진입

사용자가 `pokelog encounter <id>` 명령어로 pendingEvent에 진입하면 전투가 시작된다. 전투 진입 시 파티에서 출전할 포켓몬을 선택한다. 전투 상태는 `battleState`에 저장되어 중간에 나가도 이어할 수 있다.

**포켓몬 교체**: 전투 중 행동 선택에서 "포켓몬 교체"를 선택하면 파티의 다른 포켓몬으로 교체할 수 있다. 교체 시 해당 턴의 행동을 소모한다 (야생 포켓몬이 먼저 공격).

**전투 불가 조건**: 파티의 모든 포켓몬 HP가 0이면 전투에 진입할 수 없다. 상점에서 회복 아이템을 사용하여 HP를 회복해야 한다.

```json
"battleState": {
  "eventId": "evt-001",
  "myPokemonUid": "pikachu-001",
  "turn": 3,
  "wild": {
    "species": "charmander",
    "level": 8,
    "hp": 12,
    "maxHp": 28,
    "stats": { ... },
    "moves": [ ... ]
  }
}
```

### 8.3 턴 흐름

```
매 턴:
  1. 사용자 행동 선택
     - 싸우기: 기술 선택 → 데미지 계산
     - 몬스터볼: 포획 시도 (9장 참조)
     - 아이템: 회복 아이템 사용
     - 포켓몬 교체: 파티 내 다른 포켓몬으로 교체
     - 도망치기: 전투 종료, 이벤트 소멸

  2. 선공/후공 판정: 스피드 스탯 비교

  3. 선공 측 행동 실행
     - 데미지 적용
     - HP 0 이하 시 전투 종료

  4. 후공 측 행동 실행
     - 야생 포켓몬은 보유 기술 중 랜덤 사용
     - 데미지 적용
     - HP 0 이하 시 전투 종료

  5. 턴 종료, 다음 턴으로
```

### 8.4 데미지 계산

포켓몬 원작 공식의 간소화 버전:

```
1. 명중 판정: random(0~100) < 기술 accuracy → 명중, 아니면 빗나감
2. 데미지 계산 (명중 시):
   데미지 = (((2 × 레벨 / 5 + 2) × 기술위력 × 공격 / 방어) / 50 + 2) × 타입상성 × 랜덤(0.85~1.0)

- 물리 기술: 공격 = attack, 방어 = defense
- 특수 기술: 공격 = spAttack, 방어 = spDefense
- 타입 상성: 효과 좋음 2.0, 보통 1.0, 효과 없음 0.5, 면역 0
```

### 8.5 전투 결과

| 결과 | 처리 |
|------|------|
| 야생 포켓몬 HP 0 | 전투 승리 — 포인트/경험치 보상, 아이템 드롭 가능 |
| 내 포켓몬 HP 0 | 기절 — 파티에 다른 포켓몬이 있으면 교체, 전원 기절 시 패배. 이벤트 소멸, 페널티 없음 |
| 도망치기 | 전투 포기 — 이벤트 소멸 |
| 포획 성공 | 포켓몬 획득 (9장 참조) |

### 8.6 전투 보상

전투 승리 시:
- **경험치**: `야생 포켓몬 레벨 × 50` (출전 포켓몬에게 지급)
- **포인트**: `야생 포켓몬 레벨 × 10`
- **아이템 드롭**: 30% 확률로 몬스터볼 1개 획득

---

## 9. 포획 시스템

### 9.1 개요

전투 중 몬스터볼을 사용하여 야생 포켓몬 포획을 시도한다. 볼 종류와 야생 포켓몬의 남은 HP에 따라 포획 확률이 결정된다.

### 9.2 포획 확률 공식

```
포획 확률 = min(1.0, 볼 보정 × (1 - 현재HP / 최대HP) × 0.5 + 기본 포획률)

- 기본 포획률: 포켓몬 종류별로 다름 (레어할수록 낮음)
- 볼 보정: 몬스터볼 1.0, 수퍼볼 1.5, 하이퍼볼 2.0
- HP가 낮을수록 포획 확률 상승
```

예시 (기본 포획률 0.3인 포켓몬):
```
몬스터볼(1.0) + HP 100% → min(1.0, 1.0 × 0.0 × 0.5 + 0.3) = 0.30 (30%)
몬스터볼(1.0) + HP 30%  → min(1.0, 1.0 × 0.7 × 0.5 + 0.3) = 0.65 (65%)
하이퍼볼(2.0) + HP 10%  → min(1.0, 2.0 × 0.9 × 0.5 + 0.3) = 1.00 (100%)
```

### 9.3 포획 성공 시

- 야생 포켓몬이 현재 상태(레벨, HP, 기술) 그대로 유저의 pokemon 목록에 추가
- 고유 UID 부여: `crypto.randomUUID()` 사용 (예: `"pokemon-a1b2c3d4-e5f6-7890-abcd-ef1234567890"`)
- 파티에 빈 슬롯이 있으면 자동 편성, 가득 차면 storage(보관함)로 이동
- pokedex에 종류 등록 (최초 포획 시)
- pendingEvent 제거
- 인벤토리에서 사용한 볼 차감

### 9.4 포획 실패 시

- 사용한 볼은 소모됨
- 전투 계속 (다음 턴으로)
- 야생 포켓몬이 턴 행동 실행

### 9.5 포켓몬별 기본 포획률

```json
// data/pokemon/species.json 내 각 포켓몬 항목
{
  "species": "pikachu",
  "catchRate": 0.3,    // 30% 기본 포획률
  ...
}
```

레어도별 기준:
- 일반: 0.4 ~ 0.5
- 희귀: 0.2 ~ 0.3
- 레어: 0.1 ~ 0.15
- 전설: 0.03 ~ 0.05

---

## 10. 포켓몬 데이터

### 10.1 개요

실제 포켓몬 데이터를 사용한다. 비영리 목적이며, pokemon-colorscripts 프로젝트의 ANSI 아트를 터미널 출력에 활용한다.

### 10.2 정적 데이터 구조

```
data/
  ├── pokemon/
  │   ├── species.json          # 포켓몬 종류별 기본 데이터
  │   └── evolution.json        # 진화 조건 테이블
  ├── moves/
  │   └── moves.json            # 기술 데이터
  ├── types/
  │   └── type-chart.json       # 타입 상성표
  ├── regions/
  │   └── default.json          # 기본 출현 테이블
  └── colorscripts/             # pokemon-colorscripts에서 가져온 ANSI 아트
      ├── small/
      └── large/
```

### 10.3 species.json 항목

```json
{
  "id": 25,
  "species": "pikachu",
  "name": "피카츄",
  "types": ["electric"],
  "baseStats": {
    "hp": 35,
    "attack": 55,
    "defense": 40,
    "spAttack": 50,
    "spDefense": 50,
    "speed": 90
  },
  "catchRate": 0.3,
  "expGroup": "medium-fast",
  "learnset": {
    "1": ["thunder-shock", "growl"],
    "5": ["tail-whip"],
    "10": ["quick-attack"],
    "15": ["thunderbolt"]
  },
  "maxMoves": 4
}
```

### 10.4 moves.json 항목

```json
{
  "id": "thunderbolt",
  "name": "10만볼트",
  "type": "electric",
  "category": "special",
  "power": 90,
  "accuracy": 100,
  "pp": 15,
  "description": "강한 전격으로 공격한다."
}
```

### 10.5 type-chart.json

18가지 타입 간의 상성 배율표.

```json
{
  "electric": {
    "water": 2.0,
    "flying": 2.0,
    "ground": 0,
    "electric": 0.5,
    "grass": 0.5,
    "dragon": 0.5
  }
}
```

명시되지 않은 조합은 1.0 (보통 효과).

### 10.6 ANSI 아트

pokemon-colorscripts의 colorscripts 디렉토리를 그대로 사용한다.
- ANSI 24-bit True Color escape sequence + 유니코드 반블록 문자(▄, ▀)로 구성
- UTF-8 인코딩으로 읽어서 터미널에 출력

---

## 11. 성장 시스템

### 11.1 레벨업

경험치가 필요량에 도달하면 레벨업한다.

```
필요 경험치 테이블 (medium-fast 그룹 기준):
  레벨 N에 필요한 누적 경험치 = N^3

  예: 레벨 10 = 1,000 exp
      레벨 20 = 8,000 exp
      레벨 50 = 125,000 exp
      레벨 100 = 1,000,000 exp (최대)
```

### 11.2 스탯 계산

레벨업 시 스탯이 상승한다.

```
HP = ((baseHp × 2 × 레벨) / 100) + 레벨 + 10
기타 = ((baseStat × 2 × 레벨) / 100) + 5
```

원작의 간소화 버전으로 개체값(IV), 노력치(EV)는 사용하지 않는다.

### 11.3 기술 습득

레벨업 시 learnset에 정의된 기술을 습득할 수 있다.

- 기술 슬롯은 최대 4개
- 슬롯이 가득 찬 경우 사용자가 교체할 기술 선택
- 교체는 CLI에서 인터랙티브로 처리

### 11.4 진화

진화 조건 충족 시 진화 가능하다.

```json
// data/pokemon/evolution.json
{
  "pikachu": {
    "evolvesTo": "raichu",
    "condition": { "type": "level", "level": 30 }
  },
  "charmander": {
    "evolvesTo": "charmeleon",
    "condition": { "type": "level", "level": 16 }
  }
}
```

- 레벨업 시 조건 충족 여부를 확인하고, 사용자에게 진화 여부를 묻는다
- 진화 시 스탯/외형/습득 가능 기술이 변경됨
- 1차적으로 레벨 조건만 구현, 추후 아이템 진화 등 확장 가능

---

## 12. 상점 시스템

### 12.1 개요

포인트를 사용하여 아이템을 구매한다.

### 12.2 아이템 목록

| 아이템 | 가격 | 효과 |
|--------|------|------|
| 몬스터볼 | 100P | 포획 보정 1.0배 |
| 수퍼볼 | 300P | 포획 보정 1.5배 |
| 하이퍼볼 | 800P | 포획 보정 2.0배 |
| 상처약 | 50P | HP 20 회복 |
| 좋은상처약 | 200P | HP 50 회복 |

### 12.3 구매 흐름

```
pokelog shop              # 상점 목록 표시 (현재 보유 포인트 함께 표시)
pokelog buy pokeball 5    # 몬스터볼 5개 구매

- 포인트 부족 시 구매 불가 메시지
- 구매 성공 시 포인트 차감, 인벤토리에 추가
```

### 12.4 아이템 사용

회복 아이템은 **전투 중과 전투 밖 모두** 사용할 수 있다.

- **전투 중**: 행동 선택에서 "아이템" 선택 → 회복 아이템 사용 → 턴 소모 (야생 포켓몬이 공격)
- **전투 밖**: `pokelog use potion <pokemon_uid>` 명령어로 언제든 사용 가능

### 12.5 확장

추후 진화석, 특수 볼, 스탯 강화 아이템 등 추가 가능. config의 shop.items에 항목을 추가하면 된다.

---

## 13. 소셜 기능

### 13.1 랭킹

여러 기준으로 랭킹을 확인할 수 있다.

```
pokelog ranking              # 기본: 총 경험치 기준
pokelog ranking --by level   # 최고 레벨 포켓몬 기준
pokelog ranking --by pokedex # 도감 수 기준
pokelog ranking --by points  # 보유 포인트 기준
```

### 13.2 다른 유저 확인

```
pokelog profile <nickname>   # 닉네임, 파티 포켓몬, 도감 수 등 공개 정보
```

비밀번호, 매칭 정보 등 민감 정보는 표시하지 않는다.

### 13.3 추후 확장

- 유저 간 포켓몬 배틀 (PvP)
- 포켓몬 교환

---

## 14. 관리자 기능

### 14.1 개요

서버 관리자가 repo 등록, 서버 설정을 관리한다. `pokelog-admin` 명령어를 통해 접근한다.

### 14.2 명령어

```bash
# repo 관리
pokelog-admin repo add <url> [--branches main,develop]
pokelog-admin repo list
pokelog-admin repo remove <url>

# 설정 확인/변경
pokelog-admin config show
pokelog-admin config set polling.intervalMinutes 3
pokelog-admin config set rewards.expPerByte 1.5
pokelog-admin config set rewards.combo.bytesPerMinute 150

# 상태 확인
pokelog-admin status                # 서버 상태, 마지막 polling 시간 등
pokelog-admin users                 # 등록된 유저 목록
pokelog-admin polling run           # 수동 polling 실행
```

### 14.3 권한

사내/개인 서버 용도이므로 별도 관리자 인증은 구현하지 않는다. `pokelog-admin`은 서버에 직접 접근 가능한 사람만 사용하는 것을 전제한다.

---

## 15. CLI 인터페이스

### 15.1 전체 명령어 목록

```bash
# === 초기 설정 ===
pokelog init --server <url>             # 서버 URL 설정 (최초 1회)

# === 계정 ===
pokelog register                        # 회원가입 (아이디, 비밀번호, 닉네임, 스타터 선택)
pokelog login                           # 로그인
pokelog logout                          # 로그아웃
pokelog profile                         # 내 프로필
pokelog nickname <name>                 # 닉네임 변경
pokelog match <app> <identifier>        # 매칭 정보 추가 (예: pokelog match git jhlee@co.com)
pokelog unmatch <app> <identifier>      # 매칭 정보 제거

# === 게임 ===
pokelog status                          # 현황 요약 (오늘 커밋, 경험치, 포인트, 콤보 등)
pokelog events                          # 미확인 이벤트 목록
pokelog encounter <id>                  # 야생 조우 진입 (턴제 전투)
pokelog party                           # 내 파티 확인
pokelog party set <uid> [<uid> ...]     # 파티 편성
pokelog pokemon <uid>                   # 포켓몬 상세 정보
pokelog storage                         # 보관함 포켓몬 목록
pokelog storage withdraw <uid>          # 보관함에서 파티로 이동
pokelog storage deposit <uid>           # 파티에서 보관함으로 이동
pokelog pokedex                         # 도감
pokelog inventory                       # 인벤토리 확인
pokelog shop                            # 상점
pokelog buy <item> [quantity]           # 아이템 구매
pokelog use <item> <pokemon_uid>        # 아이템 사용 (회복 등)

# === 소셜 ===
pokelog ranking [--by <criteria>]       # 랭킹
pokelog profile <nickname>              # 다른 유저 확인

# === 관리자 ===
pokelog-admin repo add <url> [--branches ...]
pokelog-admin repo list
pokelog-admin repo remove <url>
pokelog-admin config show
pokelog-admin config set <key> <value>
pokelog-admin status
pokelog-admin users
pokelog-admin polling run
```

### 15.2 출력 예시

#### pokelog status
```
╔══════════════════════════════════════╗
║          pokelog - 이재혁            ║
╠══════════════════════════════════════╣
║ 오늘 커밋:    5회                    ║
║ 획득 경험치:  3,200 (×1.4 콤보)     ║
║ 획득 포인트:  1,600                  ║
║ 현재 콤보:    3x                     ║
║ 보유 포인트:  4,200P                 ║
║ 미확인 이벤트: 2건                   ║
╚══════════════════════════════════════╝
```

#### pokelog encounter
```
야생 파이리가 나타났다!

     [ANSI 아트로 파이리 출력]

  파이리 Lv.8
  HP: ████████████████ 28/28

  내 포켓몬: 꼬부기 Lv.12
  HP: ████████████████ 48/48

  > 싸우기              ← 화살표 키로 이동, Enter로 선택
    몬스터볼
    아이템
    포켓몬 교체
    도망치기
```

#### pokelog party
```
  파티 포켓몬
  ──────────────────
  1. 꼬부기    Lv.12  HP: 44/48  [물]
  2. 파이리    Lv.8   HP: 28/28  [불꽃]
  3. (빈 슬롯)
  4. (빈 슬롯)
  5. (빈 슬롯)
  6. (빈 슬롯)
```

### 15.3 인터랙티브 UI

CLI의 모든 선택 인터페이스는 **inquirer** 라이브러리를 사용하여 키보드 조작 기반으로 구현한다.

- **화살표 키**: 항목 이동
- **Enter**: 선택 확정
- **숫자 키**: 빠른 선택 (선택적)

적용 대상:
- 전투: 행동 선택 (싸우기/몬스터볼/아이템/도망), 기술 선택
- 상점: 아이템 선택, 수량 입력
- 파티 편성: 포켓몬 선택
- 기술 교체: 교체할 기술 선택
- 진화 확인: 진화 여부 선택

### 15.4 서버 연결

- CLI는 `~/.pokelog/config.json`에 저장된 서버 URL로 API를 호출한다
- 초기 설정: `pokelog init --server http://localhost:3000`

---

## 16. 확장 계획

### 16.1 연동 앱 추가

git 외에 다른 서비스 연동을 추가할 수 있다. 각 연동 모듈은 다음을 정의한다:

1. **매칭 키 구조**: 유저의 matchings에 들어갈 형태
2. **Polling 로직**: 해당 서비스에서 작업량을 가져오는 방법
3. **바이트 변환 기준**: 해당 서비스의 작업량을 바이트로 환산하는 공식

```
예시 - Notion 연동:
  매칭: { "notion": { "userId": "..." } }
  Polling: Notion API로 수정된 페이지/블록 조회
  변환: 블록 1개 = 100바이트 환산 (설정 가능)
```

### 16.2 바이옴/지역 시스템

- 지역별 출현 테이블 추가 (`data/regions/forest.json` 등)
- 사용자가 `pokelog travel <region>`으로 지역 이동
- 지역별 특정 타입 포켓몬 출현 확률 상승

### 16.3 PvP 배틀

- 같은 서버의 유저 간 포켓몬 대전
- `pokelog battle <nickname>` — 대전 신청
- 상대가 수락하면 턴제 배틀 진행

### 16.4 기타

- 포켓몬 교환
- 업적/도전과제 시스템
- 진화석 등 특수 아이템
- 일일 출석 보너스
