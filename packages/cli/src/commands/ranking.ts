import { apiGet } from "../api-client.js";

export async function rankingCommand(by: string = "exp") {
  const res = await apiGet(`/api/social/ranking?by=${by}`);
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const ranking = res.data.ranking as Array<{
    rank: number;
    nickname: string;
    value: number;
  }>;

  console.log(`  랭킹 (기준: ${by})`);
  console.log("  " + "─".repeat(30));
  for (const r of ranking) {
    console.log(`  ${String(r.rank).padStart(2)}. ${r.nickname.padEnd(12)} ${r.value}`);
  }
}
