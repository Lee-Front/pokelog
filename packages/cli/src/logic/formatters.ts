/**
 * 순수 포맷팅 유틸리티 — I/O 없음, 테스트 가능
 */

const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const GRN = "\x1b[32m";
const DIM = "\x1b[90m";
const R = "\x1b[0m";

/** HP 비율 → ANSI 색상 코드 */
export function hpColor(current: number, max: number): string {
  if (max <= 0) return DIM;
  const ratio = current / max;
  if (ratio <= 0.25) return RED;
  if (ratio <= 0.5) return YEL;
  return GRN;
}

/** PP 비율 → ANSI 색상 코드 */
export function ppColor(current: number, max: number): string {
  if (max <= 0) return DIM;
  const ratio = current / max;
  if (ratio <= 0.25) return RED;
  if (ratio <= 0.5) return YEL;
  return GRN;
}

/** 스크롤 위치 클램핑 */
export function clampScroll(scroll: number, totalItems: number, visibleCount: number): number {
  return Math.max(0, Math.min(scroll, Math.max(0, totalItems - visibleCount)));
}

/** 커서 위치 클램핑 */
export function clampCursor(cursor: number, totalItems: number): number {
  if (totalItems <= 0) return 0;
  return Math.max(0, Math.min(cursor, totalItems - 1));
}

/** 만료까지 남은 시간 포맷 */
export function formatTimeRemaining(expiresAt: string, now: Date = new Date()): string {
  const diff = new Date(expiresAt).getTime() - now.getTime();
  if (diff <= 0) return `${RED}만료${R}`;

  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  if (hours > 0) return `${DIM}${hours}h ${minutes}m${R}`;
  return `${YEL}${minutes}m${R}`;
}

/** 만료 여부 판별 */
export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() - now.getTime() <= 0;
}

/** 포켓몬 표시 이름 (닉네임 있으면 "닉네임 (종)" 형태) */
export function pokemonDisplayName(
  species: string,
  speciesName: string | null,
  nickname: string | null,
): string {
  const name = speciesName ?? species;
  return nickname ? `${nickname} (${name})` : name;
}

/** 교환 목록을 pending/resolved로 분리 */
export function partitionTrades<T extends { status: string }>(trades: T[]): {
  pending: T[];
  resolved: T[];
} {
  return {
    pending: trades.filter((t) => t.status === "pending"),
    resolved: trades.filter((t) => t.status !== "pending"),
  };
}

/** 아이템 slug → 표시 이름 */
export function formatSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** 파티 HP 동기화 — 새 파티 데이터에서 HP 반영 */
export function syncPartyHp<
  T extends { uid: string; hp: number; maxHp: number },
>(party: T[], newParty: Array<{ uid: string; hp: number; maxHp: number }>): T[] {
  return party.map((p) => {
    const updated = newParty.find((n) => n.uid === p.uid);
    if (updated) {
      return { ...p, hp: updated.hp, maxHp: updated.maxHp };
    }
    return p;
  });
}
