# Battle Transformations Design

Date: 2026-04-14

## Scope

원시회귀 (2종), 메가진화 (48종), 기가맥스 (32종) 구현.
융합 제외. 테라스탈 제외.

## 공통 전제 작업

### 1. Variant 데이터 채우기
82개 battle-form variant에 typing/baseStatsOverride를 PokeAPI에서 sync.
기존 `scripts/pokeapi/variants.mjs`를 재활용 (battle-form도 포함하도록).

### 2. 아이템 추가
- 메가스톤 46종 (종별 고유)
- Red Orb, Blue Orb (원시회귀)
- Key Stone (메가진화 활성화용, 유저 레벨 아이템)
- Dynamax Band (기가맥스 활성화용, 유저 레벨 아이템)

### 3. BattleState 확장
```ts
// 추가 필드
transformationType?: "mega" | "gigantamax" | "primal" | null;
transformationUsed?: boolean;  // 이번 배틀에서 이미 사용했는지
gmaxTurnsRemaining?: number;   // 기가맥스 3턴 카운트다운
playerPreTransformHp?: number; // 기가맥스 원래 HP (복귀용)
playerPreTransformMaxHp?: number;
```

## Phase 1: 원시회귀 (2종)

### 메카닉
- 그라우돈 + Red Orb → 원시그라우돈 (자동, 배틀 시작 시)
- 가이오가 + Blue Orb → 원시가이오가 (자동, 배틀 시작 시)
- 배틀 종료 시 원래로 복귀
- 원시그라우돈: Ground/Fire, BST 770
- 원시가이오가: Water, BST 770

### 구현
- battle /start에서 활성 포켓몬의 heldItem 확인
- groudon + red-orb → playerBattleForm = "groudon-primal"
- kyogre + blue-orb → playerBattleForm = "kyogre-primal"
- 배틀 중 variant override 스탯/타입 적용
- getBattleEndForm에 추가

## Phase 2: 메가진화 (48종)

### 메카닉
- 포켓몬이 해당 메가스톤을 지닌 상태 + 유저가 Key Stone 보유
- 배틀 중 플레이어가 "메가진화 + 기술 사용" 선택
- 배틀당 1회만 가능
- 배틀 종료 시 복귀

### 구현
- 새 배틀 액션: `{ action: "fight", moveId: "...", mega: true }`
- mega: true일 때:
  1. transformationUsed 체크
  2. 메가스톤 held item 검증
  3. Key Stone 인벤토리 검증
  4. playerBattleForm 설정
  5. transformationType = "mega", transformationUsed = true
- 스탯은 variant의 baseStatsOverride로 전투 중 재계산
- 레이퀘자 특수 케이스: 메가스톤 불필요, dragon-ascent 기술 알고 있으면 가능

## Phase 3: 기가맥스 (32종)

### 메카닉
- 포켓몬에 gigantamaxFactor 플래그 필요 (OwnedPokemon에 추가)
- 유저가 Dynamax Band 보유
- 배틀 중 "기가맥스 + 기술 사용" 선택
- 배틀당 1회만 (메가와 공유 — 메가 OR 기가맥스 하나만)
- 3턴 지속 후 자동 복귀
- HP 1.5배 (활성화 시 증가, 복귀 시 비율 유지하며 감소)

### 구현
- 새 배틀 액션: `{ action: "fight", moveId: "...", gigantamax: true }`
- HP 처리:
  - 활성화: hp *= 1.5, maxHp *= 1.5 (올림)
  - 복귀: hp = floor(hp * originalMaxHp / gmaxMaxHp), maxHp = originalMaxHp
- 턴 종료 시 gmaxTurnsRemaining 감소, 0이면 자동 복귀
- G-Max 전용 기술은 일단 구현 안 함 (일반 기술로 대체)

## 테스트 계획

- variant sync 후 typing/stats 데이터 검증
- 원시회귀: 배틀 시작 시 자동 발동 + 타입 변경 확인 + 배틀 종료 복귀
- 메가진화: fight + mega 옵션 → 폼 변경 → 1회 제한 → 복귀
- 기가맥스: fight + gigantamax → HP 증가 → 3턴 → 자동 복귀 + HP 비율 유지
