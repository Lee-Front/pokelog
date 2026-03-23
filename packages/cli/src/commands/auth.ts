import { apiPost } from "../api-client.js";
import { saveToken, clearToken } from "../config.js";
import { inputPrompt, passwordPrompt, selectAction } from "../ui/prompts.js";

export async function registerCommand() {
  const id = await inputPrompt("아이디:");
  const pw = await passwordPrompt("비밀번호:");
  const nickname = await inputPrompt("닉네임:");
  const starter = await selectAction("스타터 포켓몬을 선택하세요:", [
    { name: "이상해씨 (풀)", value: "bulbasaur" },
    { name: "파이리 (불꽃)", value: "charmander" },
    { name: "꼬부기 (물)", value: "squirtle" },
  ]);

  const res = await apiPost("/api/auth/register", { id, password: pw, nickname, starter });
  if (res.ok) {
    await saveToken(res.data.token as string);
    console.log(`회원가입 완료! ${starter}와 함께 모험을 시작합니다!`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function loginCommand() {
  const id = await inputPrompt("아이디:");
  const pw = await passwordPrompt("비밀번호:");

  const res = await apiPost("/api/auth/login", { id, password: pw });
  if (res.ok) {
    await saveToken(res.data.token as string);
    console.log("로그인 성공!");
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}

export async function logoutCommand() {
  await clearToken();
  console.log("로그아웃 완료.");
}
