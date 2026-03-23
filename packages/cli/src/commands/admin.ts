import { apiPost, apiGet, apiDelete, apiPut } from "../api-client.js";

export async function adminRepoAdd(url: string, branches?: string) {
  const branchList = branches ? branches.split(",") : ["main"];
  const res = await apiPost("/api/admin/repo", { url, branches: branchList });
  if (res.ok) console.log(`Repo 등록 완료: ${url}`);
  else console.error(`오류: ${res.data.error}`);
}

export async function adminRepoList() {
  const res = await apiGet("/api/admin/repos");
  if (!res.ok) { console.error(`오류: ${res.data.error}`); return; }
  const repos = res.data.repos as Array<{ url: string; branches: string[] }>;
  for (const r of repos) {
    console.log(`  ${r.url} [${r.branches.join(", ")}]`);
  }
}

export async function adminRepoRemove(url: string) {
  const res = await apiDelete("/api/admin/repo", { url });
  if (res.ok) console.log(`Repo 제거 완료: ${url}`);
  else console.error(`오류: ${res.data.error}`);
}

export async function adminConfigShow() {
  const res = await apiGet("/api/admin/config");
  if (res.ok) console.log(JSON.stringify(res.data, null, 2));
  else console.error(`오류: ${res.data.error}`);
}

export async function adminConfigSet(key: string, value: string) {
  let parsed: unknown = value;
  try { parsed = JSON.parse(value); } catch { /* keep as string */ }
  const res = await apiPut("/api/admin/config", { key, value: parsed });
  if (res.ok) console.log(`설정 변경 완료: ${key}`);
  else console.error(`오류: ${res.data.error}`);
}

export async function adminStatus() {
  const res = await apiGet("/api/admin/status");
  if (!res.ok) { console.error(`오류: ${res.data.error}`); return; }
  const d = res.data;
  console.log(`  서버 상태`);
  console.log(`  업타임: ${d.uptime}초`);
  console.log(`  등록 repo: ${d.repoCount}개`);
  console.log(`  등록 유저: ${d.userCount}명`);
}

export async function adminUsers() {
  const res = await apiGet("/api/admin/users");
  if (!res.ok) { console.error(`오류: ${res.data.error}`); return; }
  const users = res.data as unknown as Array<{ id: string; nickname: string }>;
  for (const u of users) {
    console.log(`  ${u.id.padEnd(15)} ${u.nickname}`);
  }
}

export async function adminPollingRun() {
  console.log("Polling 실행 중...");
  const res = await apiPost("/api/admin/polling/run");
  if (res.ok) console.log("Polling 완료!");
  else console.error(`오류: ${res.data.error}`);
}

// ========== 테스트/디버그 ==========

export async function testCommit(userId: string, bytes: string) {
  const res = await apiPost("/api/admin/test/commit", { userId, bytes: parseInt(bytes, 10) });
  if (res.ok) {
    const d = res.data;
    console.log(`커밋 시뮬레이션 완료!`);
    console.log(`  경험치: +${d.exp}  포인트: +${d.points}`);
    console.log(`  콤보: ${d.combo}x (배율: ${d.multiplier})`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function testEncounter(userId: string, species?: string, level?: string) {
  const body: Record<string, unknown> = { userId };
  if (species) body.species = species;
  if (level) body.level = parseInt(level, 10);
  const res = await apiPost("/api/admin/test/encounter", body);
  if (res.ok) {
    const d = res.data.event as { id: string; species: string; level: number };
    console.log(`야생 ${d.species} Lv.${d.level} 출현! (이벤트: ${d.id.slice(0, 12)})`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function testGivePoints(userId: string, amount: string) {
  const res = await apiPost("/api/admin/test/give-points", { userId, amount: parseInt(amount, 10) });
  if (res.ok) console.log(`포인트 지급 완료! 현재: ${res.data.points}P`);
  else console.error(`오류: ${res.data.error}`);
}

export async function testGiveItem(userId: string, item: string, quantity?: string) {
  const res = await apiPost("/api/admin/test/give-item", { userId, item, quantity: parseInt(quantity || "1", 10) });
  if (res.ok) console.log(`아이템 지급 완료!`);
  else console.error(`오류: ${res.data.error}`);
}

export async function testGivePokemon(userId: string, species: string, level?: string) {
  const res = await apiPost("/api/admin/test/give-pokemon", { userId, species, level: parseInt(level || "5", 10) });
  if (res.ok) {
    const d = res.data.pokemon as { uid: string; species: string; level: number };
    console.log(`${d.species} Lv.${d.level} 지급 완료! (UID: ${d.uid.slice(0, 12)})`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
