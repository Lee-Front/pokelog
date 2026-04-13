import { apiGet, apiPut } from "../api-client.js";

type RegionEntry = {
  id: string;
  name: string;
};

export async function regionCommand(region?: string) {
  if (!region) {
    const response = await apiGet("/api/game/regions");
    if (!response.ok) {
      console.error(`Error: ${response.data.error}`);
      return;
    }

    const currentRegion = String(response.data.currentRegion ?? "default");
    const regions = (response.data.regions ?? []) as RegionEntry[];

    console.log(`Current region: ${currentRegion}`);
    for (const entry of regions) {
      const marker = entry.id === currentRegion ? "*" : " ";
      console.log(`${marker} ${entry.id} - ${entry.name}`);
    }
    return;
  }

  const response = await apiPut("/api/game/region", { region });
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
      return;
  }

  console.log(`Region changed to ${response.data.regionName ?? region}.`);
}
