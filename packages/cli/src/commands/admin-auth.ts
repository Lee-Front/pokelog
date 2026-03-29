import { apiGet } from "../api-client.js";
import { clearAdminKey, getAdminKey, saveAdminKey } from "../config.js";
import { inputPrompt } from "../ui/prompts.js";

export async function ensureAdminKey(): Promise<boolean> {
  const existing = await getAdminKey();
  if (existing) return true;

  const entered = (await inputPrompt("관리자 키 (POKELOG_ADMIN_KEY):")).trim();
  if (!entered) return false;
  await saveAdminKey(entered);
  return true;
}

export async function handleAdminAuthFailure(error: unknown): Promise<boolean> {
  const message = String(error ?? "");
  if (!message.includes("Invalid admin key")) return false;

  await clearAdminKey();
  console.log("  저장된 관리자 키가 올바르지 않습니다. 다시 입력하세요.");
  const entered = (await inputPrompt("관리자 키 (POKELOG_ADMIN_KEY):")).trim();
  if (!entered) return false;
  await saveAdminKey(entered);
  return true;
}

export async function getCurrentUserId(): Promise<string | null> {
  const res = await apiGet("/api/user/profile");
  if (!res.ok) return null;
  const account = res.data.account as { id?: string } | undefined;
  return account?.id || null;
}
