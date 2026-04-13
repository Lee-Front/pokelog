import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, GRN, RED, R, YEL } from "../ui/colors.js";
import { rawSelect, separator } from "../ui/prompts.js";

interface EggTier {
  tier: string;
  label: string;
  cost: number;
}

interface OwnedEgg {
  id: string;
  tier: string;
  createdAt: string;
}

function formatEggLabel(egg: OwnedEgg, tiers: EggTier[], index: number): string {
  const label = tiers.find((tier) => tier.tier === egg.tier)?.label ?? egg.tier;
  const createdAt = new Date(egg.createdAt).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${label.padEnd(12)} ${DIM}#${String(index + 1).padStart(2, "0")}  ${createdAt}${R}`;
}

export async function eggCommand() {
  let message = "";

  while (true) {
    const res = await apiGet("/api/game/eggs");
    if (!res.ok) {
      console.log(`  ${RED}${String(res.data.error ?? "Failed to load egg info")}${R}`);
      return;
    }

    const points = Number(res.data.points ?? 0);
    const tiers = (res.data.tiers as EggTier[]) ?? [];
    const eggs = (res.data.eggs as OwnedEgg[]) ?? [];

    const items: Array<{ name: string; value: string; disabled?: boolean } | { separator: string }> = [
      separator(`  ${BLD}Egg Gacha${R}   ${DIM}Points:${R} ${YEL}${points}P${R}`),
      separator(`  ${DIM}Buy a new egg or hatch one from your inventory.${R}`),
    ];

    for (const tier of tiers) {
      items.push({
        name: `Buy   ${tier.label.padEnd(12)} ${YEL}${tier.cost}P${R}`,
        value: `buy:${tier.tier}`,
        disabled: points < tier.cost,
      });
    }

    items.push(separator(" "));
    items.push(separator(`  ${BLD}Owned Eggs${R}`));

    if (eggs.length === 0) {
      items.push({ name: `${DIM}No eggs in inventory${R}`, value: "__empty__", disabled: true });
    } else {
      eggs.forEach((egg, index) => {
        items.push({
          name: `Hatch ${formatEggLabel(egg, tiers, index)}`,
          value: `hatch:${egg.id}`,
        });
      });
    }

    if (message) {
      items.push(separator(" "));
      items.push(separator(`  ${message}`));
    }

    items.push(separator(" "));
    items.push({ name: "Close", value: "__close__" });

    const selected = await rawSelect("Egg menu", items, { pageSize: 16 });
    if (!selected || selected === "__close__") return;
    if (selected === "__empty__") continue;

    if (selected.startsWith("buy:")) {
      const tier = selected.slice(4);
      const buyRes = await apiPost("/api/game/eggs/buy", { tier });
      if (!buyRes.ok) {
        message = `${RED}${String(buyRes.data.error ?? "Failed to buy egg")}${R}`;
        continue;
      }

      const egg = buyRes.data.egg as OwnedEgg;
      const tierLabel = tiers.find((entry) => entry.tier === egg.tier)?.label ?? egg.tier;
      const remainingPoints = Number(buyRes.data.remainingPoints ?? 0);
      message = `${GRN}${tierLabel} purchased${R}   ${DIM}Remaining:${R} ${YEL}${remainingPoints}P${R}`;
      continue;
    }

    if (selected.startsWith("hatch:")) {
      const eggId = selected.slice(6);
      const hatchRes = await apiPost("/api/game/eggs/hatch", { eggId });
      if (!hatchRes.ok) {
        message = `${RED}${String(hatchRes.data.error ?? "Failed to hatch egg")}${R}`;
        continue;
      }

      const pokemon = hatchRes.data.pokemon as { species: string; level: number };
      const destination = String(hatchRes.data.destination ?? "storage");
      const destinationLabel = destination === "party" ? "party" : "storage";
      message = `${GRN}${BLD}${pokemon.species}${R}${GRN} Lv.${pokemon.level} hatched${R}   ${DIM}Sent to:${R} ${destinationLabel}`;
    }
  }
}
