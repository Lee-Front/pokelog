import { apiGet, apiPut, apiPost, apiDelete } from "../api-client.js";
import { invalidateHeaderCache, printHeader } from "../ui/display.js";

export async function profileCommand(nickname?: string) {
  const path = nickname ? `/api/social/profile/${encodeURIComponent(nickname)}` : "/api/user/profile";
  const res = await apiGet(path);
  if (res.ok) {
    const d = res.data;
    console.log(`닉네임: ${d.nickname}`);
    console.log(`총 경험치: ${d.totalExp}`);
    console.log(`보유 포인트: ${d.points}P`);
    console.log(`도감: ${(d.pokedex as string[])?.length || d.pokedexCount}종`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function nicknameCommand(name?: string) {
  if (!name) {
    const { rawInput } = await import("../ui/prompts.js");
    const result = await rawInput("새 닉네임: ");
    if (!result || !result.trim()) return;
    name = result.trim();
  }
  const res = await apiPut("/api/user/nickname", { nickname: name });
  if (res.ok) {
    console.log(`  닉네임 변경 완료: ${name}`);
    invalidateHeaderCache();
  } else {
    console.error(`  오류: ${res.data.error}`);
  }
}

export async function matchCommand(app: string, identifier: string) {
  const res = await apiPost("/api/user/match", { app, identifier });
  if (res.ok) {
    console.log(`매칭 추가 완료: ${app} → ${identifier}`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function unmatchCommand(app: string, identifier: string) {
  const res = await apiDelete("/api/user/match", { app, identifier });
  if (res.ok) {
    console.log(`매칭 제거 완료: ${app} → ${identifier}`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
