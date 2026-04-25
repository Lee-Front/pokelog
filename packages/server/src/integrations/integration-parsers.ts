import crypto from "node:crypto";
import type {
  GitIntegration,
  Integration,
  JiraIntegration,
  NotionIntegration,
  SlackIntegration,
} from "../../../../shared/types.js";
import { isRepoEmailTaken, normalizeRepoUrl } from "../storage/user-store.js";

/**
 * SSRF guard: refuse to accept integration endpoints that point at the
 * loopback interface or RFC1918/link-local ranges. Without this an
 * attacker who controls the integration body can use our backend (which
 * sits on the trusted side of any firewall) to scan internal services or
 * hit cloud-metadata endpoints (169.254.169.254) and exfiltrate IAM
 * credentials. We accept only http(s); explicit-IP literals in private
 * ranges are blocked, and DNS-resolved hostnames remain caller-responsibility
 * (a full TOCTOU-safe SSRF guard requires resolving + binding to specific
 * IPs, which is out of scope for this fix).
 */
export function isPrivateOrLocalUrl(urlString: string): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return true;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return true;

  const host = url.hostname.toLowerCase();
  if (!host) return true;

  // Strip [] from IPv6 literals so we can compare directly.
  const bareHost = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  if (bareHost === "localhost" || bareHost === "127.0.0.1" || bareHost === "::1") return true;
  if (bareHost === "0.0.0.0") return true;

  // IPv4 private/link-local ranges. Use simple regex; this is a coarse
  // check that complements (not replaces) network-level egress controls.
  if (/^127\./.test(bareHost)) return true;
  if (/^10\./.test(bareHost)) return true;
  if (/^192\.168\./.test(bareHost)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(bareHost)) return true;
  if (/^169\.254\./.test(bareHost)) return true; // link-local + EC2 metadata
  if (/^0\./.test(bareHost)) return true;

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) prefixes.
  if (/^f[cd][0-9a-f]{2}:/.test(bareHost)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(bareHost)) return true;

  return false;
}

export async function parseIntegrationInput(
  body: Record<string, unknown>,
  userId: string,
  existingId?: string,
): Promise<{ integration: Integration } | { error: string; status: number }> {
  const provider = String(body.provider ?? "git") as Integration["provider"];
  if (!["git", "github", "gitlab", "notion", "jira", "slack"].includes(provider)) {
    return { error: "지원하지 않는 provider입니다", status: 400 };
  }

  if (provider === "git" || provider === "github" || provider === "gitlab") {
    return parseGitIntegrationInput(body, userId, existingId, provider);
  }
  if (provider === "notion") {
    return parseNotionIntegrationInput(body, existingId);
  }
  if (provider === "jira") {
    return parseJiraIntegrationInput(body, existingId);
  }
  return parseSlackIntegrationInput(body, existingId);
}

async function parseGitIntegrationInput(
  body: Record<string, unknown>,
  userId: string,
  existingId: string | undefined,
  provider: GitIntegration["provider"],
): Promise<{ integration: GitIntegration } | { error: string; status: number }> {
  const config = (body.config as Record<string, unknown> | undefined) ?? {};
  const repoUrl = String(config.repoUrl ?? "").trim();
  if (!repoUrl) {
    return { error: "repoUrl을 입력해 주세요", status: 400 };
  }

  try {
    new URL(repoUrl);
  } catch {
    return { error: "repoUrl 형식이 올바르지 않습니다", status: 400 };
  }

  if (isPrivateOrLocalUrl(repoUrl)) {
    return { error: "내부/사설 호스트의 repoUrl은 허용되지 않습니다", status: 400 };
  }

  const emails = Array.isArray(body.emails)
    ? body.emails.map((email) => String(email).trim()).filter(Boolean)
    : [];

  for (const email of emails) {
    const taken = await isRepoEmailTaken(repoUrl, email, userId, existingId);
    if (taken) {
      return { error: `이미 다른 사용자가 등록한 repo/email 조합입니다: ${email}`, status: 409 };
    }
  }

  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const integration: GitIntegration = {
    id: existingId ?? crypto.randomUUID(),
    provider,
    label: String(body.label ?? normalizedRepoUrl),
    config: {
      repoUrl: normalizedRepoUrl,
      authMode: String(config.authMode ?? "public") as "public" | "token",
      token: typeof config.token === "string" ? config.token : undefined,
    },
    emails,
    status: String(body.status ?? "untested") as GitIntegration["status"],
    failCount: typeof body.failCount === "number" ? body.failCount : 0,
    addedAt: typeof body.addedAt === "string" ? body.addedAt : new Date().toISOString(),
    lastCheckedAt: typeof body.lastCheckedAt === "string" ? body.lastCheckedAt : undefined,
  };

  return { integration };
}

function parseNotionIntegrationInput(
  body: Record<string, unknown>,
  existingId?: string,
): { integration: NotionIntegration } | { error: string; status: number } {
  const config = (body.config as Record<string, unknown> | undefined) ?? {};
  const token = String(config.token ?? "").trim();
  if (!token) {
    return { error: "Notion token을 입력해 주세요", status: 400 };
  }

  const integration: NotionIntegration = {
    id: existingId ?? crypto.randomUUID(),
    provider: "notion",
    label: String(body.label ?? "Notion"),
    config: {
      token,
    },
    status: String(body.status ?? "untested") as NotionIntegration["status"],
    failCount: typeof body.failCount === "number" ? body.failCount : 0,
    addedAt: typeof body.addedAt === "string" ? body.addedAt : new Date().toISOString(),
    lastCheckedAt: typeof body.lastCheckedAt === "string" ? body.lastCheckedAt : undefined,
  };

  return { integration };
}

function parseJiraIntegrationInput(
  body: Record<string, unknown>,
  existingId?: string,
): { integration: JiraIntegration } | { error: string; status: number } {
  const config = (body.config as Record<string, unknown> | undefined) ?? {};
  const baseUrl = String(config.baseUrl ?? "").trim();
  const email = String(config.email ?? "").trim();
  const apiToken = String(config.apiToken ?? "").trim();
  if (!baseUrl || !email || !apiToken) {
    return { error: "Jira baseUrl, email, apiToken을 입력해 주세요", status: 400 };
  }

  try {
    new URL(baseUrl);
  } catch {
    return { error: "Jira baseUrl 형식이 올바르지 않습니다", status: 400 };
  }

  if (isPrivateOrLocalUrl(baseUrl)) {
    return { error: "내부/사설 호스트의 Jira baseUrl은 허용되지 않습니다", status: 400 };
  }

  const projectKey = String(config.projectKey ?? "").trim();
  const integration: JiraIntegration = {
    id: existingId ?? crypto.randomUUID(),
    provider: "jira",
    label: String(body.label ?? (projectKey || new URL(baseUrl).hostname)),
    config: {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      email,
      apiToken,
      projectKey: projectKey || undefined,
    },
    status: String(body.status ?? "untested") as JiraIntegration["status"],
    failCount: typeof body.failCount === "number" ? body.failCount : 0,
    addedAt: typeof body.addedAt === "string" ? body.addedAt : new Date().toISOString(),
    lastCheckedAt: typeof body.lastCheckedAt === "string" ? body.lastCheckedAt : undefined,
  };

  return { integration };
}

function parseSlackIntegrationInput(
  body: Record<string, unknown>,
  existingId?: string,
): { integration: SlackIntegration } | { error: string; status: number } {
  const config = (body.config as Record<string, unknown> | undefined) ?? {};
  const botToken = String(config.botToken ?? "").trim();
  if (!botToken) {
    return { error: "Slack botToken을 입력해 주세요", status: 400 };
  }

  const teamId = String(config.teamId ?? "").trim();
  const channelId = String(config.channelId ?? "").trim();
  const integration: SlackIntegration = {
    id: existingId ?? crypto.randomUUID(),
    provider: "slack",
    label: String(body.label ?? (teamId || channelId || "Slack")),
    config: {
      botToken,
      teamId: teamId || undefined,
      channelId: channelId || undefined,
    },
    status: String(body.status ?? "untested") as SlackIntegration["status"],
    failCount: typeof body.failCount === "number" ? body.failCount : 0,
    addedAt: typeof body.addedAt === "string" ? body.addedAt : new Date().toISOString(),
    lastCheckedAt: typeof body.lastCheckedAt === "string" ? body.lastCheckedAt : undefined,
  };

  return { integration };
}
