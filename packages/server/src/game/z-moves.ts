// Z기술(Z-move) 단순화 구현 — 배틀당 1회, 공격기 전용.
//
// **단순화(MVP) 문서화**:
//  - Z크리스탈/Z링 등 아이템은 데이터에 없으므로 발명하지 않는다. 발동은 행동 플래그(zmove:true)
//    + 배틀당 1회 게이트(battle.zMoveUsed)만으로 처리한다.
//  - 크리스탈 타입 매칭(노말Z·불꽃Z…) 없음 — 어떤 공격기든 위력만 Z파워로 증폭한다.
//  - Z상태기(능력 상승 등 status-Z 부가효과) 없음 — status 기술에는 쓸 수 없다(라우트에서 400 거부).
//
// 본가 Gen7 Z파워 환산표(기존 위력 → Z위력). 핵심 helper로 분리해 테스트 가능하게 둔다.

/**
 * 기존 기술의 위력(basePower)을 Z기술 위력으로 환산한다(순수 함수).
 * 본가 표:
 *   ≤55 → 100, 60–65 → 120, 70–75 → 140, 80–85 → 160, 90–95 → 175,
 *   100 → 180, 110 → 185, 120–125 → 190, 130 → 195, ≥140 → 200.
 */
export function getZPower(basePower: number): number {
  if (basePower <= 55) return 100;
  if (basePower <= 65) return 120; // 60–65
  if (basePower <= 75) return 140; // 70–75
  if (basePower <= 85) return 160; // 80–85
  if (basePower <= 95) return 175; // 90–95
  if (basePower <= 100) return 180; // 100
  if (basePower <= 110) return 185; // 110
  if (basePower <= 125) return 190; // 120–125
  if (basePower <= 130) return 195; // 130
  return 200; // ≥140 (135은 본가에 없으나 안전하게 200으로 수렴)
}
