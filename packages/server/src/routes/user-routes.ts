import { Router } from "express";
import type { Response } from "express";
import type {
  GitIntegration,
  NotionIntegration,
  JiraIntegration,
  SlackIntegration,
} from "../../../../shared/types.js";
import { parseIntegrationInput } from "../integrations/integration-parsers.js";
import { pollNotionIntegration } from "../integrations/notion-polling.js";
import { pollJiraIntegration } from "../integrations/jira-polling.js";
import { pollSlackIntegration } from "../integrations/slack-polling.js";
import { testIntegrationConnection } from "../integrations/provider-tests.js";
import { pollUserIntegrations, getRepoAuthorEmails } from "../polling/polling-worker.js";
import { redactUrlCredentials } from "../polling/git-client.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import {
  getUser,
  isEmailTaken,
  isGitIntegration,
  isRepoEmailTaken,
  searchUsersByIdentity,
  saveUser,
} from "../storage/user-store.js";
import { childLogger } from "../logger.js";

const log = childLogger("user-routes");

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
    log.error({ err }, "Profile error");
    res.status(500).json({ error: "프로필을 불러오지 못했습니다" });
  }
});

userRoutes.get("/search", async (req: AuthRequest, res: Response) => {
  try {
    const query = String(req.query.q ?? "").trim();
    const limit = Math.max(1, Math.min(20, Number(req.query.limit ?? 10) || 10));
    if (!query) {
      res.json({ users: [] });
      return;
    }

    const users = await searchUsersByIdentity(query, {
      excludeUserId: req.userId!,
      limit,
    });
    res.json({ users });
  } catch (err) {
    log.error({ err }, "User search error");
    res.status(500).json({ error: "Failed to search users." });
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
    log.error({ err }, "Nickname error");
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
    log.error({ err }, "Match error");
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
    log.error({ err }, "Match delete error");
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

    // trigger polling in background when user views integrations
    pollUserIntegrations(req.userId!).catch((e) => log.error({ err: e }, "Integration-view poll error"));
  } catch (err) {
    log.error({ err }, "Integration list error");
    res.status(500).json({ error: "연동 목록을 불러오지 못했습니다" });
  }
});

// Clone a repo and return its commit author emails so the form can offer them
// as checkboxes. Either {id} (reuse a saved integration's stored config/token,
// no token re-entry) or {provider, config} (validated, not saved). Git errors
// can embed the token-bearing URL, so every message is redacted before it
// leaves the server.
userRoutes.post("/integrations/repo-authors", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    let config: GitIntegration["config"];
    if (typeof req.body.id === "string" && req.body.id) {
      const existing = user.integrations.find((entry) => entry.id === req.body.id);
      if (!existing || !isGitIntegration(existing)) {
        res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
        return;
      }
      config = existing.config;
    } else {
      const parsed = await parseIntegrationInput(req.body, req.userId!);
      if ("error" in parsed) {
        res.status(parsed.status).json({ error: parsed.error });
        return;
      }
      if (!isGitIntegration(parsed.integration)) {
        res.status(400).json({ error: "git 계열 연동만 author 이메일을 조회할 수 있습니다" });
        return;
      }
      config = parsed.integration.config;
    }

    if (!config.repoUrl?.trim()) {
      res.status(400).json({ error: "repoUrl을 입력해 주세요" });
      return;
    }

    try {
      const emails = await getRepoAuthorEmails(config.repoUrl, config.authMode, config.token, {
        caCertPath: config.caCertPath,
        insecureSkipTls: config.insecureSkipTls,
      });
      res.json({ emails });
    } catch (err) {
      const message = redactUrlCredentials(err instanceof Error ? err.message : "레포 접근에 실패했습니다");
      log.error({ err: message }, "repo-authors clone error");
      res.status(502).json({ error: message });
    }
  } catch (err) {
    log.error({ err }, "repo-authors error");
    res.status(500).json({ error: "author 이메일을 불러오지 못했습니다" });
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
    log.error({ err }, "Integration create error");
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
    log.error({ err }, "Integration update error");
    res.status(500).json({ error: "연동 정보를 수정하지 못했습니다" });
  }
});

// Update only the attributed emails on a git integration, leaving every other
// field (repoUrl/token/status/...) untouched. Used by the form's "edit emails"
// flow after the user re-picks from the author checkboxes.
userRoutes.patch("/integrations/:id/emails", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const idx = user.integrations.findIndex((entry) => entry.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }
    const current = user.integrations[idx];
    if (!isGitIntegration(current)) {
      res.status(400).json({ error: "git 계열 연동만 이메일을 수정할 수 있습니다" });
      return;
    }

    if (!Array.isArray(req.body.emails)) {
      res.status(400).json({ error: "emails 배열을 입력해 주세요" });
      return;
    }
    const emails = req.body.emails.map((email: unknown) => String(email).trim()).filter(Boolean);

    for (const email of emails) {
      const taken = await isRepoEmailTaken(current.config.repoUrl, email, req.userId!, current.id);
      if (taken) {
        res.status(409).json({ error: `이미 다른 사용자가 등록한 repo/email 조합입니다: ${email}` });
        return;
      }
    }

    current.emails = emails;
    await saveUser(user);
    res.json({ integration: current });
  } catch (err) {
    log.error({ err }, "Integration emails update error");
    res.status(500).json({ error: "이메일을 수정하지 못했습니다" });
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
    log.error({ err }, "Integration delete error");
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
    log.error({ err }, "Integration test error");
    res.status(500).json({ error: "연결 테스트에 실패했습니다" });
  }
});

userRoutes.post("/integrations/:id/sync", async (req: AuthRequest, res: Response) => {
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

    if (!["notion", "jira", "slack"].includes(integration.provider) || !("config" in integration)) {
      res.status(400).json({ error: "수동 sync는 Notion, Jira, Slack 연동만 지원합니다" });
      return;
    }

    const syncState = await getSyncState();
    let result: unknown;

    if (integration.provider === "notion") {
      result = await pollNotionIntegration(user, integration as NotionIntegration, syncState);
    } else if (integration.provider === "jira") {
      result = await pollJiraIntegration(user, integration as JiraIntegration, syncState);
    } else if (integration.provider === "slack") {
      result = await pollSlackIntegration(user, integration as SlackIntegration, syncState);
    }

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
    log.error({ err }, "Integration sync error");
    res.status(500).json({ error: "연동 sync 실행 중 오류가 발생했습니다" });
  }
});

