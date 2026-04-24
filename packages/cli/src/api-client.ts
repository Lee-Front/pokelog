import { getServerUrl, getToken, getAdminKey } from "./config.js";

/**
 * Thrown when an API request is made without a configured server URL.
 * Callers generally do not need to handle this; the CLI entrypoint
 * catches it via a top-level `unhandledRejection` listener, prints the
 * message, and exits 1. Utility files should NEVER call `process.exit`
 * directly — that couples request-making to process lifecycle.
 */
export class NoServerError extends Error {
  constructor() {
    super("서버가 설정되지 않았습니다. pokelog init --server <url> 을 먼저 실행하세요.");
    this.name = "NoServerError";
  }
}

async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    throw new NoServerError();
  }

  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (path.startsWith("/api/admin")) {
    const adminKey = (await getAdminKey()) || process.env.POKELOG_ADMIN_KEY || null;
    if (adminKey) headers["x-admin-key"] = adminKey;
  }

  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: "서버에 연결할 수 없습니다." } };
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

export async function apiGet(path: string) {
  return request("GET", path);
}

export async function apiPost(path: string, body?: unknown) {
  return request("POST", path, body);
}

export async function apiPut(path: string, body?: unknown) {
  return request("PUT", path, body);
}

export async function apiPatch(path: string, body?: unknown) {
  return request("PATCH", path, body);
}

export async function apiDelete(path: string, body?: unknown) {
  return request("DELETE", path, body);
}
