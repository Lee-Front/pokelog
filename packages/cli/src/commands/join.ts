import { addServer } from "../config.js";

export async function joinCommand(url: string) {
  // URL 정규화
  if (!url.startsWith("http")) {
    url = "http://" + url;
  }
  url = url.replace(/\/+$/, "");

  // 서버 메타데이터 조회
  console.log(`서버에 연결 중... ${url}`);
  try {
    const res = await fetch(`${url}/api/meta`);
    if (!res.ok) {
      console.error("서버에 연결할 수 없습니다. URL을 확인하세요.");
      return;
    }
    const meta = (await res.json()) as {
      serverId: string;
      serverName: string;
      displayName: string;
      apiVersion: string;
    };

    // 프로필 저장
    await addServer({
      id: meta.serverId,
      name: meta.serverName,
      url,
      displayName: meta.displayName,
      apiVersion: meta.apiVersion,
      joinedAt: new Date().toISOString(),
    });

    console.log(`\nJoined server: ${meta.displayName}`);
    console.log(`URL: ${url}`);
    console.log(`Current server set to: ${meta.serverName}`);
  } catch {
    console.error("서버에 연결할 수 없습니다. URL을 확인하세요.");
  }
}
