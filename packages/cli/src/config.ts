import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".pokelog");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const AUTH_PATH = path.join(CONFIG_DIR, "auth.json");

// === Types ===

interface ServerProfile {
  id: string;
  name: string;
  url: string;
  displayName: string;
  apiVersion: string;
  joinedAt: string;
}

interface CliConfig {
  currentServerId: string | null;
  servers: ServerProfile[];
}

interface AuthStore {
  tokens: Record<string, { accessToken: string; savedAt: string }>;
  adminKeys?: Record<string, { key: string; savedAt: string }>;
}

// === Internal ===

async function ensureDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));

    // 구버전 마이그레이션: 단일 serverUrl → 멀티 프로필
    if (raw.serverUrl && !raw.servers) {
      const migrated: CliConfig = {
        currentServerId: "migrated",
        servers: [
          {
            id: "migrated",
            name: "default",
            url: raw.serverUrl,
            displayName: "Migrated Server",
            apiVersion: "1",
            joinedAt: new Date().toISOString(),
          },
        ],
      };
      // 구버전 토큰도 마이그레이션
      try {
        const authRaw = JSON.parse(await fs.readFile(AUTH_PATH, "utf-8"));
        if (authRaw.token && !authRaw.tokens) {
          const migratedAuth: AuthStore = {
            tokens: {
              migrated: { accessToken: authRaw.token, savedAt: new Date().toISOString() },
            },
          };
          await ensureDir();
          await fs.writeFile(AUTH_PATH, JSON.stringify(migratedAuth, null, 2));
        }
      } catch {
        // no auth to migrate
      }
      await ensureDir();
      await fs.writeFile(CONFIG_PATH, JSON.stringify(migrated, null, 2));
      return migrated;
    }

    return raw as CliConfig;
  } catch {
    return { currentServerId: null, servers: [] };
  }
}

async function saveConfig(config: CliConfig): Promise<void> {
  await ensureDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function loadAuth(): Promise<AuthStore> {
  try {
    const raw = JSON.parse(await fs.readFile(AUTH_PATH, "utf-8"));
    return (raw.tokens ? raw : { tokens: {}, adminKeys: {} }) as AuthStore;
  } catch {
    return { tokens: {}, adminKeys: {} };
  }
}

async function saveAuth(auth: AuthStore): Promise<void> {
  await ensureDir();
  await fs.writeFile(AUTH_PATH, JSON.stringify(auth, null, 2));
}

// === Public API ===

// 현재 활성 서버
export async function getCurrentServer(): Promise<ServerProfile | null> {
  const config = await loadConfig();
  if (!config.currentServerId) return null;
  return config.servers.find((s) => s.id === config.currentServerId) || null;
}

// 현재 서버 URL (api-client용)
export async function getServerUrl(): Promise<string | null> {
  const server = await getCurrentServer();
  return server?.url || null;
}

// 현재 서버명 (프롬프트용)
export async function getCurrentServerName(): Promise<string | null> {
  const server = await getCurrentServer();
  return server?.name || null;
}

// 서버 목록
export async function getServers(): Promise<ServerProfile[]> {
  const config = await loadConfig();
  return config.servers;
}

// 서버 참가
export async function addServer(profile: ServerProfile): Promise<void> {
  const config = await loadConfig();
  const existing = config.servers.findIndex((s) => s.id === profile.id);
  if (existing >= 0) {
    config.servers[existing] = profile; // 갱신
  } else {
    config.servers.push(profile);
  }
  config.currentServerId = profile.id;
  await saveConfig(config);
}

// 서버 전환
export async function switchServer(nameOrId: string): Promise<ServerProfile | null> {
  const config = await loadConfig();
  const server = config.servers.find((s) => s.id === nameOrId || s.name === nameOrId);
  if (!server) return null;
  config.currentServerId = server.id;
  await saveConfig(config);
  return server;
}

// 서버 제거
export async function removeServer(nameOrId: string): Promise<boolean> {
  const config = await loadConfig();
  const idx = config.servers.findIndex((s) => s.id === nameOrId || s.name === nameOrId);
  if (idx < 0) return false;
  const removed = config.servers[idx];
  config.servers.splice(idx, 1);
  if (config.currentServerId === removed.id) {
    config.currentServerId = config.servers[0]?.id || null;
  }
  // 토큰도 제거
  const auth = await loadAuth();
  delete auth.tokens[removed.id];
  await saveAuth(auth);
  await saveConfig(config);
  return true;
}

// 현재 서버의 토큰
export async function getToken(): Promise<string | null> {
  const server = await getCurrentServer();
  if (!server) return null;
  const auth = await loadAuth();
  return auth.tokens[server.id]?.accessToken || null;
}

// 현재 서버에 토큰 저장
export async function saveToken(token: string): Promise<void> {
  const server = await getCurrentServer();
  if (!server) return;
  const auth = await loadAuth();
  auth.tokens[server.id] = { accessToken: token, savedAt: new Date().toISOString() };
  await saveAuth(auth);
}

// 현재 서버의 토큰 제거
export async function clearToken(): Promise<void> {
  const server = await getCurrentServer();
  if (!server) return;
  const auth = await loadAuth();
  delete auth.tokens[server.id];
  await saveAuth(auth);
}

export async function getAdminKey(): Promise<string | null> {
  const server = await getCurrentServer();
  if (!server) return null;
  const auth = await loadAuth();
  return auth.adminKeys?.[server.id]?.key || null;
}

export async function saveAdminKey(key: string): Promise<void> {
  const server = await getCurrentServer();
  if (!server) return;
  const auth = await loadAuth();
  auth.adminKeys = auth.adminKeys ?? {};
  auth.adminKeys[server.id] = { key, savedAt: new Date().toISOString() };
  await saveAuth(auth);
}

export async function clearAdminKey(): Promise<void> {
  const server = await getCurrentServer();
  if (!server) return;
  const auth = await loadAuth();
  if (auth.adminKeys) {
    delete auth.adminKeys[server.id];
  }
  await saveAuth(auth);
}

// 서버가 하나도 없는지
export async function hasNoServers(): Promise<boolean> {
  const config = await loadConfig();
  return config.servers.length === 0;
}
