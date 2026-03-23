import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".pokelog");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const AUTH_PATH = path.join(CONFIG_DIR, "auth.json");

async function ensureDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

export async function getServerUrl(): Promise<string | null> {
  try {
    const data = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
    return data.serverUrl || null;
  } catch {
    return null;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  await ensureDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify({ serverUrl: url }, null, 2));
}

export async function getToken(): Promise<string | null> {
  try {
    const data = JSON.parse(await fs.readFile(AUTH_PATH, "utf-8"));
    return data.token || null;
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  await ensureDir();
  await fs.writeFile(AUTH_PATH, JSON.stringify({ token }, null, 2));
}

export async function clearToken(): Promise<void> {
  try {
    await fs.unlink(AUTH_PATH);
  } catch {
    // ignore
  }
}
