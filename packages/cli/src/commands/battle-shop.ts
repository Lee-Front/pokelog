import { DIM, GRN, YEL, CYN, BLD, R } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";

type ShopItem = {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
};

function describe(item: ShopItem): string {
  const parts: string[] = [];
  if (item.healAmount) parts.push(`HP +${item.healAmount}`);
  if ((item.catchBonus ?? 0) > 0) parts.push(`포획률 +${Math.round(item.catchBonus! * 100)}%`);
  return parts.join("  ");
}

export async function battleShopCommand() {
  const res = await apiGet("/api/battle-shop");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }

  const items = res.data.items as Record<string, ShopItem>;
  const battleMoney = res.data.battleMoney as number;

  console.log("");
  console.log(`  ${BLD}배틀 상점${R}   ${DIM}배틀머니: ${YEL}${battleMoney} BM${R}`);
  console.log("  " + "─".repeat(44));
  for (const [key, item] of Object.entries(items)) {
    const price = `${YEL}${item.price} BM${R}`;
    const desc = describe(item);
    console.log(`  ${CYN}${key.padEnd(16)}${R} ${price.padEnd(18)} ${DIM}${desc}${R}`);
  }
  console.log("");
  console.log(`  ${DIM}구매: pokelog battle-buy <item> [수량]${R}`);
}

export async function battleBuyCommand(item: string, quantity: number) {
  const res = await apiPost("/api/battle-shop/buy", { item, quantity });
  if (res.ok) {
    console.log(`${GRN}${item} ${quantity}개 구매 완료! (남은 배틀머니: ${res.data.battleMoney} BM)${R}`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
