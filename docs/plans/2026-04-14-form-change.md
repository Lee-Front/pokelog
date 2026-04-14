# Reversible Form Change Design

Date: 2026-04-14

## Scope

융합(큐레무/네크로즈마/칼렉스) 제외, 나머지 30종 전부 구현.
메가진화/기가맥스/원시회귀는 별도 후순위 — 시스템적으로 고려만.

## 1단계: 아이템 기반 폼 체인지 (20종)

필드에서 아이템을 사용하여 포켓몬의 폼(variantId)을 변경.
배틀 밖에서 적용, 변경 후 영구 유지(다시 아이템으로 복귀 가능).

### 대상 종 + 트리거 아이템

| 종 | 폼들 | 트리거 방식 |
|---|------|-----------|
| rotom | heat, wash, frost, fan, mow | 로토무 카탈로그 (전용 아이템) |
| shaymin | land ↔ sky | 그라시디아 꽃 |
| giratina | altered ↔ origin | 백금옥 (지닌 물건) |
| dialga | base ↔ origin | 큰금강옥 (지닌 물건) |
| palkia | base ↔ origin | 큰백옥 (지닌 물건) |
| tornadus | incarnate ↔ therian | 비추는거울 |
| thundurus | incarnate ↔ therian | 비추는거울 |
| landorus | incarnate ↔ therian | 비추는거울 |
| enamorus | incarnate ↔ therian | 비추는거울 |
| hoopa | confined ↔ unbound | 징벌의항아리 |
| deoxys | normal ↔ attack/defense/speed | 운석 |
| genesect | base ↔ burn/chill/douse/shock | 드라이브 (지닌 물건) |
| arceus | base ↔ 17 타입 | 플레이트 (지닌 물건) |
| silvally | base ↔ 17 타입 | 메모리 (지닌 물건) |
| oricorio | baile ↔ pau/pom-pom/sensu | 꿀 아이템 |
| furfrou | natural ↔ 9 트림 | 그루밍 |
| zacian | hero ↔ crowned | 녹슨검 (지닌 물건) |
| zamazenta | hero ↔ crowned | 녹슨방패 (지닌 물건) |

### 구현 방식

1. 새 API: `POST /api/game/form-change`
   - body: `{ pokemonUid, targetFormId }`
   - 종별로 허용된 폼 목록 검증
   - 아이템 소비가 필요한 경우 인벤토리 차감
   - variantId 변경 + variant의 typing/stats override 적용

2. 폼 체인지 규칙 데이터: `data/pokemon/form-change-rules.json`
   ```json
   {
     "rotom": {
       "type": "catalog",
       "forms": ["rotom-heat", "rotom-wash", "rotom-frost", "rotom-fan", "rotom-mow"],
       "revertTo": null
     },
     "giratina": {
       "type": "held-item",
       "item": "griseous-orb",
       "form": "giratina-origin",
       "revertTo": null
     }
   }
   ```

3. CLI: pokemon detail 화면에 "폼 체인지" 액션 추가 (해당 종일 때만)

## 2단계: 배틀 내 폼 체인지 (12종)

배틀 중 자동으로 폼이 바뀜. 배틀 종료 시 원래 폼으로 복귀.

### 날씨 시스템 (신규)

BattleState에 `weather?: "sun" | "rain" | "hail" | "sandstorm"` 추가.
날씨 변경 기술(sunny-day, rain-dance, hail, sandstorm) 사용 시 설정.
기본 5턴 지속, 턴 종료 시 카운트 감소.

날씨 효과:
- sun: 불꽃 1.5x, 물 0.5x
- rain: 물 1.5x, 불꽃 0.5x
- hail: 얼음 타입 아닌 포켓몬 매턴 1/16 데미지
- sandstorm: 바위/땅/강철 아닌 포켓몬 매턴 1/16 데미지

### 배틀 폼 체인지 대상

| 종 | 트리거 | 복귀 |
|---|--------|------|
| castform | 날씨 변경 시 폼 변경 | 날씨 종료 시 기본 |
| cherrim | 맑음 시 sunshine | 맑음 종료 시 기본 |
| aegislash | 공격 기술 → blade, 킹실드 → shield | 배틀 종료 시 shield |
| wishiwashi | HP>25% + Lv20+ → school | HP<=25% → solo |
| morpeko | 매턴 full-belly ↔ hangry | 배틀 종료 시 full-belly |
| cramorant | Surf/Dive 후 gulping(HP>50%) 또는 gorging(HP<=50%) | 피격 시 기본+데미지 |
| eiscue | 물리 피격 시 ice → noice | 우박 시 noice → ice |
| minior | HP<=50% → core(색상), HP>50% → meteor | 배틀 종료 시 meteor |
| darmanitan | HP<=50% → zen (젠모드 특성) | HP>50% → standard |
| zygarde | HP<=50% → complete (스웜체인지 특성) | 배틀 종료 시 원래 폼 |
| mimikyu | 첫 피격 → busted (분류 특성) | 배틀 종료 시 disguised |
| meloetta | 고대의 노래 → aria ↔ pirouette | 배틀 종료 시 aria |

### 구현 방식

1. BattleState에 `activeFormId` 추가 (플레이어/야생 각각)
2. 턴 흐름에 폼 체인지 체크 포인트 삽입:
   - 공격 전: 에기슬래쉬 스탠스 체인지
   - 공격 후: 크레버스 꿀꺽, 메로엣타
   - HP 변경 후: 이시와시, 메테노, 다르마탄, 지가르데
   - 피격 후: 따라큐, 아이스페이스
   - 턴 종료: 모르페코, 날씨 폼
3. 폼 변경 시 variant의 typing/stats override 적용
4. 배틀 종료 시 원래 variantId로 복귀

## 테스트 계획

- 단위: 폼 체인지 규칙 검증, 날씨 데미지
- 통합: API로 폼 변경 → pokemon detail에서 확인
- E2E: 로토무 폼 변경 → 배틀에서 타입 확인
