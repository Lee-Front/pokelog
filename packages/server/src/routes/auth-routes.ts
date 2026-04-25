import { Router } from "express";
import type { Request, Response } from "express";
import { hashPassword, verifyPassword, issueToken } from "../auth/auth.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { pollUserIntegrations } from "../polling/polling-worker.js";
import { createPokemon } from "../game/pokemon-factory.js";
import type { UserData } from "../../../../shared/types.js";

export const authRoutes = Router();

const VALID_STARTERS = ["bulbasaur", "charmander", "squirtle"];

authRoutes.post("/register", async (req: Request, res: Response) => {
  try {
    const { id, password, nickname, starter } = req.body;

    if (!id || !password || !nickname || !starter) {
      res.status(400).json({ error: "모든 필드를 입력해주세요" });
      return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      res.status(400).json({ error: "아이디는 영문/숫자만 가능합니다" });
      return;
    }

    if (!VALID_STARTERS.includes(starter)) {
      res.status(400).json({ error: "올바른 스타터를 선택해주세요 (bulbasaur, charmander, squirtle)" });
      return;
    }

    const existing = await getUser(id);
    if (existing) {
      res.status(409).json({ error: "이미 사용 중인 아이디입니다" });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const starterPokemon = createPokemon(starter, 5);

    const userData: UserData = {
      account: {
        id,
        password: hashedPassword,
        nickname,
        createdAt: new Date().toISOString(),
        matchings: {},
      },
      currentRegion: "default",
      points: 0,
      totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      encounterCeiling: { accumulatedBytes: 0 },
      party: [starterPokemon.uid],
      pokemon: [starterPokemon],
      eggs: [],
      pokedex: [starter],
      inventory: { pokeball: 5 },
      pendingEvents: [],
      pendingEvolutions: [],
      battleState: null,
      storage: [],
      log: [],
      integrations: [],
    };

    await saveUser(userData);
    const token = issueToken(id);
    res.status(201).json({ token });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

/**
 * Revoke every session currently holding a token for this user. We do
 * this by recording a cutoff timestamp on the user record; the auth
 * middleware then rejects any token whose `iat` predates the cutoff.
 *
 * The new token we issue in the response is usable immediately because
 * it is minted AFTER the cutoff.
 */
authRoutes.post("/logout-all", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    let newToken: string | null = null;
    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) return;
      // Pick a cutoff at the current second; record both the cutoff and
      // a successor token whose iat is strictly greater than the cutoff
      // (in seconds). Previous tokens have iat <= cutoffSec - 1 and are
      // therefore rejected by the auth middleware.
      const nowMs = Date.now();
      const cutoff = new Date(nowMs).toISOString();
      user.tokenInvalidatedAt = cutoff;
      await saveUser(user);
      // Mint successor token with explicit iat = floor(nowMs/1000) + 1
      // so it survives the cutoff check immediately, without waiting on
      // wall-clock time. This eliminates the prior ~1.1s mutex hold.
      const futureIat = Math.floor(nowMs / 1000) + 1;
      newToken = issueToken(userId, futureIat);
    });
    if (!newToken) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    res.json({ ok: true, token: newToken });
  } catch (err) {
    console.error("Logout-all error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

authRoutes.post("/login", async (req: Request, res: Response) => {
  try {
    const { id, password } = req.body;

    if (!id || !password) {
      res.status(400).json({ error: "아이디와 비밀번호를 입력해주세요" });
      return;
    }

    const user = await getUser(id);
    if (!user) {
      res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
      return;
    }

    const valid = await verifyPassword(password, user.account.password);
    if (!valid) {
      res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" });
      return;
    }

    const token = issueToken(id);
    res.json({ token });

    // trigger polling in background on login
    pollUserIntegrations(id).catch((e) => console.error("Login-triggered poll error:", e));
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
