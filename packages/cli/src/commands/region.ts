import { apiGet, apiPut } from "../api-client.js";
import { GRN, DIM, R, YEL } from "../ui/colors.js";
import { selectFrame } from "../ui/screen.js";
import { separator } from "../ui/prompts.js";

type RegionEntry = {
  id: string;
  name: string;
};

export async function regionCommand(region?: string) {
  if (region) {
    const response = await apiPut("/api/game/region", { region });
    if (!response.ok) {
      console.error(`Error: ${response.data.error}`);
      return;
    }
    console.log(`Region changed to ${response.data.regionName ?? region}.`);
    return;
  }

  const response = await apiGet("/api/game/regions");
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const currentRegion = String(response.data.currentRegion ?? "default");
  const regions = (response.data.regions ?? []) as RegionEntry[];

  if (regions.length === 0) {
    console.log("  이동 가능한 바이옴이 없습니다.");
    return;
  }

  const items = [
    separator(`  ${DIM}현재: ${GRN}${regions.find(r => r.id === currentRegion)?.name ?? currentRegion}${R}`),
    separator(""),
    ...regions.map((entry) => ({
      name: entry.id === currentRegion
        ? `${GRN}${entry.name}${R} ${DIM}(현재)${R}`
        : entry.name,
      value: entry.id,
      disabled: entry.id === currentRegion,
    })),
    separator(""),
    { name: `${DIM}뒤로${R}`, value: "__back__" },
  ];

  const selected = await selectFrame("바이옴 이동", items);
  if (!selected || selected === "__back__") return;

  const moveRes = await apiPut("/api/game/region", { region: selected });
  if (!moveRes.ok) {
    console.error(`  ${moveRes.data.error}`);
    return;
  }

  const name = regions.find(r => r.id === selected)?.name ?? selected;
  console.log(`  ${GRN}${name}${R}${YEL}(으)로 이동했습니다.${R}`);
}
