# Battle Status Conditions Design

Date: 2026-04-14

## Goal

배틀 상태이상 시스템 구현. moves.json의 ailment 데이터를 활용하여 원작 포켓몬과 동일한 상태이상 메카닉을 구현한다.

## Status Classification

### Primary (하나만, 배틀 후 유지)

| 상태 | 효과 | 해제 조건 |
|------|------|----------|
| poison | 턴 종료 시 maxHP의 1/8 데미지 | 치료 |
| burn | 턴 종료 시 maxHP의 1/16 데미지, 물리 공격력 0.5x | 치료 |
| paralysis | 25% 확률 행동 불가, 스피드 0.5x | 치료 |
| sleep | 1-3턴 행동 불가 후 자동 해제 | 턴 경과 또는 치료 |
| freeze | 매턴 20% 확률 해동, 얼면 행동 불가 | 확률 해동 또는 치료 |

### Volatile (중복 가능, 배틀 종료 시 해제)

| 상태 | 효과 | 턴 수 |
|------|------|-------|
| confusion | 33% 확률 자해 (공격력 기반 40 파워) | 1-4턴 |
| trap | 턴 종료 시 maxHP의 1/8 데미지, 교체 불가 | 4-5턴 |
| leech-seed | 턴 종료 시 maxHP의 1/8 흡수 (상대 회복) | 영구 (배틀 내) |
| infatuation | 50% 확률 행동 불가 | 영구 (배틀 내) |
| disable | 마지막 사용 기술 사용 불가 | 4턴 |
| nightmare | 잠든 상태에서 턴 종료 시 maxHP의 1/4 데미지 | 잠듦 해제 시 같이 해제 |
| yawn | 다음 턴 종료 시 잠듦 부여 | 1턴 |
| torment | 같은 기술 연속 사용 불가 | 영구 (배틀 내) |
| embargo | 아이템 사용 불가 | 5턴 |
| heal-block | 회복 기술/아이템 불가 | 5턴 |
| ingrain | 매턴 HP 회복, 교체 불가 | 영구 (배틀 내) |
| perish-song | 3턴 후 기절 | 3턴 카운트다운 |

## Type Changes

```typescript
// shared/types.ts

type PrimaryStatus = "poison" | "burn" | "paralysis" | "sleep" | "freeze";

interface VolatileStatus {
  id: string;
  turnsRemaining: number;
}

// OwnedPokemon에 추가
statusCondition?: PrimaryStatus | null;
sleepTurns?: number; // sleep 잔여 턴 추적

// BattleState에 추가
playerVolatile?: VolatileStatus[];
wildVolatile?: VolatileStatus[];
playerLastMoveId?: string; // torment/disable 용
wildLastMoveId?: string;
```

## Turn Flow

```
1. 턴 시작 (pre-attack)
   ├─ sleep: sleepTurns 감소, 0이면 해제, 아니면 행동 불가
   ├─ freeze: 20% 확률 해동, 아니면 행동 불가
   ├─ paralysis: 25% 확률 행동 불가
   ├─ confusion: turnsRemaining 감소, 33% 확률 자해
   └─ infatuation: 50% 확률 행동 불가

2. 공격 실행
   ├─ burn: 물리 공격력 0.5x 적용 (calculateDamage에서)
   ├─ paralysis: 스피드 0.5x 적용 (턴 순서에서)
   ├─ 데미지 계산 + meta + stat changes
   └─ ailment 부여: ailmentChance% 확률로 상대에게 적용

3. 턴 종료 (end-of-turn)
   ├─ poison: maxHP의 1/8
   ├─ burn: maxHP의 1/16
   ├─ leech-seed: maxHP의 1/8 흡수
   ├─ trap: maxHP의 1/8
   ├─ nightmare: 잠든 상태면 maxHP의 1/4
   ├─ ingrain: maxHP의 1/16 회복
   ├─ yawn: 카운트 0이면 sleep 부여
   ├─ perish-song: 카운트 0이면 기절
   └─ volatile turnsRemaining 감소, 0이면 해제
```

## Heal Command Change

`healPokemon()` 함수에서 HP/PP 회복 + `statusCondition = null` + `sleepTurns = undefined`.

## Test Plan

- 단위: applyPrimaryStatus, checkPreAttack, applyEndOfTurn 순수 함수
- 통합: 배틀 API에서 ailment 부여 → 턴 데미지 → 치료
- E2E: 전투 → 독 걸림 → 배틀 후 유지 확인 → heal로 치료 확인
