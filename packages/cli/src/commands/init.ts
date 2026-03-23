import { saveServerUrl } from "../config.js";

export async function initCommand(serverUrl: string) {
  await saveServerUrl(serverUrl);
  console.log(`서버 설정 완료: ${serverUrl}`);
}
