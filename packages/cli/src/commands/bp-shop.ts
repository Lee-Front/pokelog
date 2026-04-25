import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, R, YEL, CYN, GRN, RED } from "../ui/colors.js";

interface BpShopEntry {
  id: string;
  name: string;
  bp: number;
  category: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  "core-held": "핵심 지닌물건",
  "choice": "선택 시리즈",
  "buffer": "단발 버퍼",
  "field-rock": "날씨/스크린",
  "terrain-seed": "테라인 시드",
  "training": "EV 훈련 도구",
  "nature-mint": "성격 민트",
  "transform": "변신 아이템",
  "rare": "특수",
};

export async function bpShopCommand(): Promise<void> {
  const res = await apiGet("/api/tower/bp-shop");
  if (!res.ok) {
    console.error(`오류: ${String(res.data.error ?? "BP 상점을 불러올 수 없습니다")}`);
    return;
  }

  const bp = res.data.bp as number;
  const items = res.data.items as BpShopEntry[];

  const grouped = new Map<string, BpShopEntry[]>();
  for (const entry of items) {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry);
    grouped.set(entry.category, list);
  }

  console.log(`\n  ${BLD}── BP 상점 ──${R}`);
  console.log(`  ${DIM}보유 BP:${R} ${YEL}${BLD}${bp}${R}`);
  console.log(`  ${DIM}구매: pokelog bp-buy <item> [quantity]${R}`);

  for (const [cat, entries] of grouped) {
    console.log(`\n  ${CYN}${BLD}${CATEGORY_LABELS[cat] ?? cat}${R}  ${DIM}(${entries.length})${R}`);
    console.log("  " + "─".repeat(50));
    entries.sort((a, b) => a.bp - b.bp || a.id.localeCompare(b.id));
    for (const e of entries) {
      const id = e.id.padEnd(24);
      const name = e.name.padEnd(16);
      console.log(`    ${DIM}${id}${R} ${name} ${YEL}${e.bp}BP${R}`);
    }
  }
  console.log();
}

export async function bpBuyCommand(item: string, quantity: number): Promise<void> {
  if (!Number.isFinite(quantity) || quantity < 1) {
    console.error("quantity 는 1 이상이어야 합니다");
    return;
  }
  const res = await apiPost("/api/tower/bp-shop/buy", { item, quantity });
  if (!res.ok) {
    console.error(`${RED}오류:${R} ${String(res.data.error ?? "구매 실패")}`);
    return;
  }
  const purchased = res.data.purchased as { id: string; name: string; quantity: number; totalCost: number };
  console.log(`${GRN}✓${R} ${purchased.name} ${purchased.quantity}개 구매 (-${purchased.totalCost}BP, 잔여 ${res.data.bp}BP)`);
}
