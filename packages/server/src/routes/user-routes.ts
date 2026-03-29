import { Router } from "express";
import type { Response } from "express";
import crypto from "node:crypto";
import type {
  GitIntegration,
  Integration,
  JiraIntegration,
  NotionIntegration,
  SlackIntegration,
} from "../../../../shared/types.js";
import { pollNotionIntegration } from "../integrations/notion-polling.js";
import { testIntegrationConnection } from "../integrations/provider-tests.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import {
  getUser,
  isEmailTaken,
  isGitIntegration,
  isRepoEmailTaken,
  normalizeRepoUrl,
  saveUser,
} from "../storage/user-store.js";

export const userRoutes = Router();
userRoutes.use(authMiddleware);

userRoutes.get("/profile", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const { password, ...accountWithoutPassword } = user.account;
    res.json({ ...user, account: accountWithoutPassword });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ error: "프로필을 불러오지 못했습니다" });
  }
});

userRoutes.put("/nickname", async (req: AuthRequest, res: Response) => {
  try {
    const { nickname } = req.body;
    if (!nickname) {
      res.status(400).json({ error: "nickname을 입력해 주세요" });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    user.account.nickname = nickname;
    await saveUser(user);
    res.json({ nickname });
  } catch (err) {
    console.error("Nickname error:", err);
    res.status(500).json({ error: "닉네임을 변경하지 못했습니다" });
  }
});

userRoutes.post("/match", async (req: AuthRequest, res: Response) => {
  try {
    const { app, identifier } = req.body;
    if (!app || !identifier) {
      res.status(400).json({ error: "app과 identifier를 입력해 주세요" });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (app === "git") {
      const taken = await isEmailTaken(identifier);
      if (taken) {
        res.status(409).json({ error: "이미 다른 사용자가 등록한 이메일입니다" });
        return;
      }

      if (!user.account.matchings.git) {
        user.account.matchings.git = { emails: [] };
      }
      if (!user.account.matchings.git.emails.includes(identifier)) {
        user.account.matchings.git.emails.push(identifier);
      }
    } else {
      if (!user.account.matchings[app]) {
        user.account.matchings[app] = {};
      }
      (user.account.matchings[app] as Record<string, unknown>).identifier = identifier;
    }

    await saveUser(user);
    res.json({ matchings: user.account.matchings });
  } catch (err) {
    console.error("Match error:", err);
    res.status(500).json({ error: "match 정보를 저장하지 못했습니다" });
  }
});

userRoutes.delete("/match", async (req: AuthRequest, res: Response) => {
  try {
    const { app, identifier } = req.body;
    if (!app || !identifier) {
      res.status(400).json({ error: "app과 identifier를 입력해 주세요" });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (app === "git" && user.account.matchings.git) {
      user.account.matchings.git.emails = user.account.matchings.git.emails.filter(
        (email) => email !== identifier,
      );
    } else {
      delete user.account.matchings[app];
    }

    await saveUser(user);
    res.json({ matchings: user.account.matchings });
  } catch (err) {
    console.error("Match delete error:", err);
    res.status(500).json({ error: "match 정보를 삭제하지 못했습니다" });
  }
});

userRoutes.get("/integrations", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({ integrations: user.integrations });
  } catch (err) {
    console.error("Integration list error:", err);
    res.status(500).json({ error: "연동 목록을 불러오지 못했습니다" });
  }
});

userRoutes.post("/integrations", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const parsed = await parseIntegrationInput(req.body, req.userId!);
    if ("error" in parsed) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }

    user.integrations.push(parsed.integration);
    await saveUser(user);
    res.status(201).json({ integration: parsed.integration });
  } catch (err) {
    console.error("Integration create error:", err);
    res.status(500).json({ error: "연동을 생성하지 못했습니다" });
  }
});

userRoutes.patch("/integrations/:id", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const idx = user.integrations.findIndex((integration) => integration.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }

    const current = user.integrations[idx];
    const parsed = await parseIntegrationInput(
      {
        provider: current.provider,
        label: req.body.label ?? current.label,
        config: {
          ...("config" in current ? current.config : {}),
          ...(typeof req.body.config === "object" && req.body.config ? req.body.config : {}),
        },
        emails: req.body.emails ?? (isGitIntegration(current) ? current.emails ?? [] : undefined),
        status: req.body.status ?? current.status,
        failCount: current.failCount,
        addedAt: current.addedAt,
        lastCheckedAt: current.lastCheckedAt,
      },
      req.userId!,
      current.id,
    );
    if ("error" in parsed) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }

    user.integrations[idx] = {
      ...parsed.integration,
      id: current.id,
      addedAt: current.addedAt,
      failCount: current.failCount,
      lastCheckedAt: current.lastCheckedAt,
      lastError: current.lastError,
    };
    await saveUser(user);
    res.json({ integration: user.integrations[idx] });
  } catch (err) {
    console.error("Integration update error:", err);
    res.status(500).json({ error: "연동 정보를 수정하지 못했습니다" });
  }
});

userRoutes.delete("/integrations/:id", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const before = user.integrations.length;
    user.integrations = user.integrations.filter((integration) => integration.id !== req.params.id);
    if (user.integrations.length === before) {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }

    await saveUser(user);
    res.json({ ok: true });
  } catch (err) {
    console.error("Integration delete error:", err);
    res.status(500).json({ error: "연동을 삭제하지 못했습니다" });
  }
});

userRoutes.post("/integrations/:id/test", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const integration = user.integrations.find((entry) => entry.id === req.params.id);
    if (!integration) {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }

    const result = await testIntegrationConnection(integration);
    integration.lastCheckedAt = new Date().toISOString();
    if (result.ok) {
      integration.status = "ok";
      integration.failCount = 0;
      delete integration.lastError;
    } else {
      integration.status = "error";
      integration.failCount += 1;
      integration.lastError = result.lastError || "connection test failed";
    }

    await saveUser(user);
    res.json({
      ok: result.ok,
      integration,
      warning: result.warning,
      metadata: result.metadata,
    });
  } catch (err) {
    console.error("Integration test error:", err);
    res.status(500).json({ error: "연결 테스트에 실패했습니다" });
  }
});

userRoutes.post("/integrations/:id/sync", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "?ÑŠìŠœ?ë¨®? ï§¡ì– ì“£ ???ë†ë’¿?ëˆë–Ž" });
      return;
    }

    const integration = user.integrations.find((entry) => entry.id === req.params.id);
    if (!integration) {
      res.status(404).json({ error: "?ê³•ë£ž ?ëº£ë‚«ç‘œ?ï§¡ì– ì“£ ???ë†ë’¿?ëˆë–Ž" });
      return;
    }

    if (integration.provider !== "notion" || !("config" in integration)) {
      res.status(400).json({ error: "ìˆ˜ë™ syncëŠ” í˜„ìž¬ Notion integrationë§Œ ì§€ì›í•©ë‹ˆë‹¤" });
      return;
    }

    const syncState = await getSyncState();
    const result = await pollNotionIntegration(user, integration, syncState);
    integration.lastCheckedAt = new Date().toISOString();
    integration.status = "ok";
    integration.failCount = 0;
    delete integration.lastError;

    await saveUser(user);
    await saveSyncState(syncState);

    res.json({
      ok: true,
      integration,
      result,
    });
  } catch (err) {
    console.error("Integration sync error:", err);
    res.status(500).json({ error: "?ê³•ë£ž sync ?ì‹¤í–‰ ì¤‘ ì˜¤ë¥˜ê°€ ë°œìƒí–ˆìŠµë‹ˆë‹¤" });
  }
});

async function parseIntegrationInput(
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
