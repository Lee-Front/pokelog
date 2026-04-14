import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, GRN, RED, R, YEL } from "../ui/colors.js";
import { separator } from "../ui/prompts.js";
import { formatScreenMessage, runMenuLoop, type ScreenMessage } from "../ui/screen.js";

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
  type EggScreenState = { message: ScreenMessage | null };
  type EggScreenData = { points: number; tiers: EggTier[]; eggs: OwnedEgg[] };

  try {
    await runMenuLoop<EggScreenState, EggScreenData, string>({
      initialState: { message: null },
      pageSize: 16,
      load: async () => {
        const res = await apiGet("/api/game/eggs");
        if (!res.ok) {
          throw new Error(String(res.data.error ?? "Failed to load egg info"));
        }
        return {
          points: Number(res.data.points ?? 0),
          tiers: (res.data.tiers as EggTier[]) ?? [],
          eggs: (res.data.eggs as OwnedEgg[]) ?? [],
        };
      },
      prompt: () => "Egg menu",
      items: (data, state) => {
        const items: Array<{ name: string; value: string; disabled?: boolean } | { separator: string }> = [
          separator(`  ${BLD}Egg Gacha${R}   ${DIM}Points:${R} ${YEL}${data.points}P${R}`),
          separator(`  ${DIM}Buy a new egg or hatch one from your inventory.${R}`),
        ];

        for (const tier of data.tiers) {
          items.push({
            name: `Buy   ${tier.label.padEnd(12)} ${YEL}${tier.cost}P${R}`,
            value: `buy:${tier.tier}`,
            disabled: data.points < tier.cost,
          });
        }

        items.push(separator(" "));
        items.push(separator(`  ${BLD}Owned Eggs${R}`));

        if (data.eggs.length === 0) {
          items.push({ name: `${DIM}No eggs in inventory${R}`, value: "__empty__", disabled: true });
        } else {
          data.eggs.forEach((egg, index) => {
            items.push({
              name: `Hatch ${formatEggLabel(egg, data.tiers, index)}`,
              value: `hatch:${egg.id}`,
            });
          });
        }

        if (state.message) {
          items.push(separator(" "));
          items.push(separator(`  ${formatScreenMessage(state.message)}`));
        }

        items.push(separator(" "));
        items.push({ name: "Close", value: "__close__" });
        return items;
      },
      onSelect: async (selected, data, state) => {
        if (selected === "__close__") {
          return { state, close: true };
        }

        if (selected === "__empty__") {
          return state;
        }

        if (selected.startsWith("buy:")) {
          const tier = selected.slice(4);
          const buyRes = await apiPost("/api/game/eggs/buy", { tier });
          if (!buyRes.ok) {
            return { message: { tone: "error", text: String(buyRes.data.error ?? "Failed to buy egg") } };
          }

          const egg = buyRes.data.egg as OwnedEgg;
          const tierLabel = data.tiers.find((entry) => entry.tier === egg.tier)?.label ?? egg.tier;
          const remainingPoints = Number(buyRes.data.remainingPoints ?? 0);
          return {
            message: {
              tone: "success",
              text: `${tierLabel} purchased   Remaining: ${remainingPoints}P`,
            },
          };
        }

        if (selected.startsWith("hatch:")) {
          const eggId = selected.slice(6);
          const hatchRes = await apiPost("/api/game/eggs/hatch", { eggId });
          if (!hatchRes.ok) {
            return { message: { tone: "error", text: String(hatchRes.data.error ?? "Failed to hatch egg") } };
          }

          const pokemon = hatchRes.data.pokemon as { species: string; level: number };
          const destination = String(hatchRes.data.destination ?? "storage");
          const destinationLabel = destination === "party" ? "party" : "storage";
          return {
            message: {
              tone: "success",
              text: `${pokemon.species} Lv.${pokemon.level} hatched   Sent to: ${destinationLabel}`,
            },
          };
        }

        return state;
      },
    });
  } catch (error) {
    console.log(`  ${RED}${String(error instanceof Error ? error.message : "Failed to load egg info")}${R}`);
  }
}

