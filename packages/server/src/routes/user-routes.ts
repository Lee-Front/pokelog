import { Router } from "express";
import type { Response } from "express";
import type {
  NotionIntegration,
  JiraIntegration,
  SlackIntegration,
} from "../../../../shared/types.js";
import { parseIntegrationInput } from "../integrations/integration-parsers.js";
import { pollNotionIntegration } from "../integrations/notion-polling.js";
import { pollJiraIntegration } from "../integrations/jira-polling.js";
import { pollSlackIntegration } from "../integrations/slack-polling.js";
import { testIntegrationConnection } from "../integrations/provider-tests.js";
import { pollUserIntegrations } from "../polling/polling-worker.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getSyncState, saveSyncState } from "../storage/sync-state-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import {
  getUser,
  isEmailTaken,
  isGitIntegration,
  searchUsersByIdentity,
  saveUser,
} from "../storage/user-store.js";

// Apps that can be associated with a user via /api/user/match. Any value
// outside this set (and especially the JS reserved keys __proto__, constructor,
// prototype) is rejected so that a tainted body cannot pollute Object.prototype
// when we use the value as a key into user.account.matchings.
const ALLOWED_MATCH_APPS = new Set(["git", "notion", "jira", "slack", "github", "gitlab"]);

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

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
    console.error("User search error:", err);
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

    type Outcome = { kind: "ok" } | { kind: "not_found" };
    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };
      user.account.nickname = nickname;
      await saveUser(user);
      return { kind: "ok" };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    res.json({ nickname });
  } catch (err) {
    console.error("Nickname error:", err);
    res.status(500).json({ error: "닉네임을 변경하지 못했습니다" });
  }
});

userRoutes.post("/match", async (req: AuthRequest, res: Response) => {
  try {
    const { app, identifier } = req.body;
    if (typeof app !== "string" || typeof identifier !== "string" || !app || !identifier) {
      res.status(400).json({ error: "app과 identifier를 입력해 주세요" });
      return;
    }
    if (!ALLOWED_MATCH_APPS.has(app)) {
      res.status(400).json({ error: "유효하지 않은 app입니다" });
      return;
    }

    type Outcome =
      | { kind: "ok"; matchings: unknown }
      | { kind: "error"; status: number; message: string };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "error", status: 404, message: "사용자를 찾을 수 없습니다" };

      if (app === "git") {
        const taken = await isEmailTaken(identifier);
        if (taken) {
          return { kind: "error", status: 409, message: "이미 다른 사용자가 등록한 이메일입니다" };
        }

        if (!hasOwn(user.account.matchings, "git") || !user.account.matchings.git) {
          user.account.matchings.git = { emails: [] };
        }
        if (!user.account.matchings.git.emails.includes(identifier)) {
          user.account.matchings.git.emails.push(identifier);
        }
      } else {
        const existing = hasOwn(user.account.matchings, app)
          ? (user.account.matchings[app] as Record<string, unknown> | undefined)
          : undefined;
        const next = existing && typeof existing === "object" ? { ...existing } : {};
        next.identifier = identifier;
        user.account.matchings[app] = next;
      }

      await saveUser(user);
      return { kind: "ok", matchings: user.account.matchings };
    });

    if (outcome.kind === "error") {
      res.status(outcome.status).json({ error: outcome.message });
      return;
    }
    res.json({ matchings: outcome.matchings });
  } catch (err) {
    console.error("Match error:", err);
    res.status(500).json({ error: "match 정보를 저장하지 못했습니다" });
  }
});

userRoutes.delete("/match", async (req: AuthRequest, res: Response) => {
  try {
    const { app, identifier } = req.body;
    if (typeof app !== "string" || typeof identifier !== "string" || !app || !identifier) {
      res.status(400).json({ error: "app과 identifier를 입력해 주세요" });
      return;
    }
    if (!ALLOWED_MATCH_APPS.has(app)) {
      res.status(400).json({ error: "유효하지 않은 app입니다" });
      return;
    }

    type Outcome =
      | { kind: "ok"; matchings: unknown }
      | { kind: "error"; status: number; message: string };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "error", status: 404, message: "사용자를 찾을 수 없습니다" };

      if (app === "git" && hasOwn(user.account.matchings, "git") && user.account.matchings.git) {
        user.account.matchings.git.emails = user.account.matchings.git.emails.filter(
          (email) => email !== identifier,
        );
      } else if (hasOwn(user.account.matchings, app)) {
        delete user.account.matchings[app];
      }

      await saveUser(user);
      return { kind: "ok", matchings: user.account.matchings };
    });

    if (outcome.kind === "error") {
      res.status(outcome.status).json({ error: outcome.message });
      return;
    }
    res.json({ matchings: outcome.matchings });
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

    // trigger polling in background when user views integrations
    pollUserIntegrations(req.userId!).catch((e) => console.error("Integration-view poll error:", e));
  } catch (err) {
    console.error("Integration list error:", err);
    res.status(500).json({ error: "연동 목록을 불러오지 못했습니다" });
  }
});

userRoutes.post("/integrations", async (req: AuthRequest, res: Response) => {
  try {
    const parsed = await parseIntegrationInput(req.body, req.userId!);
    if ("error" in parsed) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }

    type Outcome =
      | { kind: "ok"; integration: typeof parsed.integration }
      | { kind: "not_found" };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };
      user.integrations.push(parsed.integration);
      await saveUser(user);
      return { kind: "ok", integration: parsed.integration };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    res.status(201).json({ integration: outcome.integration });
  } catch (err) {
    console.error("Integration create error:", err);
    res.status(500).json({ error: "연동을 생성하지 못했습니다" });
  }
});

userRoutes.patch("/integrations/:id", async (req: AuthRequest, res: Response) => {
  try {
    type Outcome =
      | { kind: "ok"; integration: unknown }
      | { kind: "not_found" }
      | { kind: "integration_missing" }
      | { kind: "parse_error"; status: number; error: string };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };

      const idx = user.integrations.findIndex((integration) => integration.id === req.params.id);
      if (idx < 0) return { kind: "integration_missing" };

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
      if ("error" in parsed) return { kind: "parse_error", status: parsed.status, error: parsed.error };

      user.integrations[idx] = {
        ...parsed.integration,
        id: current.id,
        addedAt: current.addedAt,
        failCount: current.failCount,
        lastCheckedAt: current.lastCheckedAt,
        lastError: current.lastError,
      };
      await saveUser(user);
      return { kind: "ok", integration: user.integrations[idx] };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "integration_missing") {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "parse_error") {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.json({ integration: outcome.integration });
  } catch (err) {
    console.error("Integration update error:", err);
    res.status(500).json({ error: "연동 정보를 수정하지 못했습니다" });
  }
});

userRoutes.delete("/integrations/:id", async (req: AuthRequest, res: Response) => {
  try {
    type Outcome =
      | { kind: "ok" }
      | { kind: "not_found" }
      | { kind: "integration_missing" };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };

      const before = user.integrations.length;
      user.integrations = user.integrations.filter((integration) => integration.id !== req.params.id);
      if (user.integrations.length === before) {
        return { kind: "integration_missing" };
      }

      await saveUser(user);
      return { kind: "ok" };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "integration_missing") {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }
    res.json({});
  } catch (err) {
    console.error("Integration delete error:", err);
    res.status(500).json({ error: "연동을 삭제하지 못했습니다" });
  }
});

userRoutes.post("/integrations/:id/test", async (req: AuthRequest, res: Response) => {
  try {
    // Fetch the user once outside the lock so the (potentially slow)
    // network round-trip in testIntegrationConnection doesn't hold the
    // user lock. We re-read inside the lock to apply the result.
    const userSnapshot = await getUser(req.userId!);
    if (!userSnapshot) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const snapshotIntegration = userSnapshot.integrations.find((entry) => entry.id === req.params.id);
    if (!snapshotIntegration) {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }

    const result = await testIntegrationConnection(snapshotIntegration);

    type Outcome =
      | { kind: "ok"; integration: unknown }
      | { kind: "not_found" }
      | { kind: "integration_missing" };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };
      const integration = user.integrations.find((entry) => entry.id === req.params.id);
      if (!integration) return { kind: "integration_missing" };

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
      return { kind: "ok", integration };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "integration_missing") {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }

    res.json({
      ok: result.ok,
      integration: outcome.integration,
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
    type Outcome =
      | { kind: "ok"; integration: unknown; result: unknown }
      | { kind: "not_found" }
      | { kind: "integration_missing" }
      | { kind: "unsupported" };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };

      const integration = user.integrations.find((entry) => entry.id === req.params.id);
      if (!integration) return { kind: "integration_missing" };

      if (!["notion", "jira", "slack"].includes(integration.provider) || !("config" in integration)) {
        return { kind: "unsupported" };
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

      return { kind: "ok", integration, result };
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "integration_missing") {
      res.status(404).json({ error: "연동 정보를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "unsupported") {
      res.status(400).json({ error: "수동 sync는 Notion, Jira, Slack 연동만 지원합니다" });
      return;
    }

    res.json({
      ok: true,
      integration: outcome.integration,
      result: outcome.result,
    });
  } catch (err) {
    console.error("Integration sync error:", err);
    res.status(500).json({ error: "연동 sync 실행 중 오류가 발생했습니다" });
  }
});

// Pokemon IV appraisal (canon "Judge" app). Returns per-stat + total verdict
// text mirroring the in-game appraiser's flavor lines.
userRoutes.get("/judge/:uid", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const pokemon = [...user.pokemon, ...user.storage].find(
      (p) => p.uid === req.params.uid,
    );
    if (!pokemon) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    if (!pokemon.ivs) {
      res.json({
        legacy: true,
        species: pokemon.species,
        nickname: pokemon.nickname ?? null,
        message: "개체값 판정 불가 (레거시 포켓몬)",
      });
      return;
    }

    const ivs = pokemon.ivs;
    const total = ivs.hp + ivs.attack + ivs.defense + ivs.spAttack + ivs.spDefense + ivs.speed;
    const verdict = total >= 181 ? "환상적이야!"
      : total >= 151 ? "정말 대단해!"
      : total >= 121 ? "꽤 괜찮아"
      : "좀 더 노력해볼까";

    const perStat: Record<string, { value: number; verdict: string }> = {};
    for (const [k, v] of Object.entries(ivs)) {
      perStat[k] = {
        value: v,
        verdict: v === 31 ? "최고다!"
          : v >= 26 ? "훌륭해"
          : v >= 16 ? "그럭저럭"
          : v >= 1 ? "아쉽네"
          : "안 좋아",
      };
    }

    res.json({
      legacy: false,
      species: pokemon.species,
      nickname: pokemon.nickname ?? null,
      total,
      verdict,
      ivs,
      perStat,
    });
  } catch (err) {
    console.error("judge error:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});
