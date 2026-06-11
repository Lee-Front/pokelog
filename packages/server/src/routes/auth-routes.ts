import { Router } from "express";
import type { Request, Response } from "express";
import { hashPassword, verifyPassword, issueToken } from "../auth/auth.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { pollUserIntegrations } from "../polling/polling-worker.js";
import { createPokemon } from "../game/pokemon-factory.js";
import type { UserData } from "../../../../shared/types.js";
import { childLogger } from "../logger.js";
const log = childLogger("auth-routes");


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
      battleMoney: 0,
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
    log.error({ err }, "Register error");
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
    pollUserIntegrations(id).catch((e) => log.error({ err: e }, "Login-triggered poll error"));
  } catch (err) {
    log.error({ err }, "Login error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
