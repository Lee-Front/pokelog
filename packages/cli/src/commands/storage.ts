import { apiGet, apiPost } from "../api-client.js";

export async function storageCommand() {
  const res = await apiGet("/api/game/storage");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const storage = res.data.storage as Array<{
    uid: string;
    species: string;
    level: number;
  }>;

  if (storage.length === 0) {
    console.log("보관함이 비어 있습니다.");
    return;
  }
  console.log("  보관함 포켓몬");
  console.log("  " + "─".repeat(30));
  for (const p of storage) {
    console.log(`  ${p.uid.slice(0, 8)}  ${p.species.padEnd(12)} Lv.${p.level}`);
  }
}

export async function withdrawCommand(uid: string) {
  const res = await apiPost("/api/game/storage/withdraw", { uid });
  if (res.ok) {
    console.log("보관함에서 파티로 이동했습니다!");
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function depositCommand(uid: string) {
  const res = await apiPost("/api/game/storage/deposit", { uid });
  if (res.ok) {
    console.log("파티에서 보관함으로 이동했습니다!");
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
