import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
import { getAvailableEvolutionOptions } from "../game/pending-evolution.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { childLogger } from "../logger.js";
const log = childLogger("storage-routes");


const MAX_PARTY_SIZE = 6;

export const storageRoutes = Router();
storageRoutes.use(authMiddleware);

storageRoutes.get("/storage", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const region = user.currentRegion ?? "default";
    // 계산 전용(비영속) 진화 가능 여부/선택지를 응답용 스프레드 복제본에만 부착한다(저장 객체 불변).
    const withEvolution = user.storage.map((p) => {
      const options = getAvailableEvolutionOptions(user, p, { region });
      const sp = getSpeciesByName(p.species);
      return {
        ...p,
        evolutionAvailable: options.length > 0,
        evolutionOptions: options,
        isLegendary: sp?.isLegendary === true,
        isMythical: sp?.isMythical === true,
      };
    });

    res.json({ storage: withEvolution });
  } catch (err) {
    log.error({ err }, "Storage error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

storageRoutes.post("/storage/withdraw", async (req: AuthRequest, res: Response) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      res.status(400).json({ error: "포켓몬 UID를 입력해주세요" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      if (user.party.length >= MAX_PARTY_SIZE) {
        res.status(400).json({ error: "파티가 가득 찼습니다" });
        return;
      }

      const pokemonIndex = user.storage.findIndex((p) => p.uid === uid);
      if (pokemonIndex === -1) {
        res.status(404).json({ error: "보관함에서 포켓몬을 찾을 수 없습니다" });
        return;
      }

      const [pokemon] = user.storage.splice(pokemonIndex, 1);
      user.pokemon.push(pokemon);
      user.party.push(pokemon.uid);
      await saveUser(user);
      res.json({ message: "포켓몬을 꺼냈습니다", uid: pokemon.uid });
    });
  } catch (err) {
    log.error({ err }, "Withdraw error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

storageRoutes.post("/storage/deposit", async (req: AuthRequest, res: Response) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      res.status(400).json({ error: "포켓몬 UID를 입력해주세요" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      if (user.party.length <= 1) {
        res.status(400).json({ error: "파티에 최소 1마리는 있어야 합니다" });
        return;
      }

      const pokemonIndex = user.pokemon.findIndex((p) => p.uid === uid);
      if (pokemonIndex === -1) {
        res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
        return;
      }

      if (!user.party.includes(uid)) {
        res.status(400).json({ error: "파티에 있는 포켓몬만 맡길 수 있습니다" });
        return;
      }

      const [pokemon] = user.pokemon.splice(pokemonIndex, 1);
      user.party = user.party.filter((u) => u !== uid);
      user.storage.push(pokemon);
      await saveUser(user);
      res.json({ message: "포켓몬을 맡겼습니다", uid: pokemon.uid });
    });
  } catch (err) {
    log.error({ err }, "Deposit error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 포켓몬 풀어주기: 파티/보관함에서 영구 제거. 파티 마지막 1마리는 전멸 방지를 위해 금지.
storageRoutes.post("/pokemon/:uid/release", async (req: AuthRequest, res: Response) => {
  try {
    const { uid } = req.params;

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      const inParty = user.party.includes(uid);
      const partyIndex = user.pokemon.findIndex((p) => p.uid === uid);
      const storageIndex = user.storage.findIndex((p) => p.uid === uid);

      if (partyIndex === -1 && storageIndex === -1) {
        res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
        return;
      }

      // 파티의 유일한 1마리는 풀어줄 수 없다(전멸 방지). 보관함이거나 파티에 2마리+ 일 때만 허용.
      if (inParty && user.party.length <= 1) {
        res.status(400).json({ error: "마지막 포켓몬은 풀어줄 수 없습니다" });
        return;
      }

      if (partyIndex !== -1) {
        user.pokemon.splice(partyIndex, 1);
        user.party = user.party.filter((u) => u !== uid);
      } else {
        user.storage.splice(storageIndex, 1);
      }
      await saveUser(user);
      res.json({ ok: true });
    });
  } catch (err) {
    log.error({ err }, "Release error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 포켓몬 여러 마리 한번에 풀어주기(파티/보관함 상관없이 uid 배열). 단일 release와 달리 하나라도
// 무효한 uid가 섞이면 전부 거부(all-or-nothing) — 부분 실행 시 클라이언트가 뭐가 빠졌는지
// 추적하기 번거롭기 때문. 전멸 방지 규칙도 배치로 일반화: 이 배치를 반영한 뒤 파티에 최소
// 1마리는 남아야 한다(파티는 소유 전체의 부분집합이므로, 이 조건이 곧 "최소 1마리는 남는다"도
// 함께 보장한다 — 파티가 이미 늘 1마리 이상이므로).
storageRoutes.post("/pokemon/release-many", async (req: AuthRequest, res: Response) => {
  try {
    const { uids } = req.body as { uids?: unknown };
    if (!Array.isArray(uids) || uids.length === 0 || !uids.every((u) => typeof u === "string")) {
      res.status(400).json({ error: "풀어줄 포켓몬 uid 배열을 입력해주세요" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      const uidSet = new Set<string>(uids as string[]);
      const ownedIds = new Set([
        ...user.pokemon.map((p) => p.uid),
        ...user.storage.map((p) => p.uid),
      ]);
      const missing = [...uidSet].filter((u) => !ownedIds.has(u));
      if (missing.length > 0) {
        res.status(404).json({ error: "존재하지 않는 포켓몬이 포함돼 있습니다" });
        return;
      }

      const remainingParty = user.party.filter((u) => !uidSet.has(u));
      if (remainingParty.length === 0) {
        res.status(400).json({ error: "파티에 최소 1마리는 남아야 합니다" });
        return;
      }

      user.pokemon = user.pokemon.filter((p) => !uidSet.has(p.uid));
      user.storage = user.storage.filter((p) => !uidSet.has(p.uid));
      user.party = remainingParty;
      await saveUser(user);
      res.json({ released: [...uidSet] });
    });
  } catch (err) {
    log.error({ err }, "Release-many error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 파티에서 여러 마리를 한번에 보관함으로 맡긴다. 선택한 uid가 전부 현재 파티 소속이어야
// 하고(보관함에 이미 있는 걸 또 맡기는 건 무의미하므로 하나라도 파티 밖이면 전부 거부),
// 옮긴 뒤 파티에 최소 1마리는 남아야 한다(release-many와 동일한 전멸 방지 규칙).
storageRoutes.post("/storage/deposit-many", async (req: AuthRequest, res: Response) => {
  try {
    const { uids } = req.body as { uids?: unknown };
    if (!Array.isArray(uids) || uids.length === 0 || !uids.every((u) => typeof u === "string")) {
      res.status(400).json({ error: "옮길 포켓몬 uid 배열을 입력해주세요" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      const uidSet = new Set<string>(uids as string[]);
      const notInParty = [...uidSet].filter((u) => !user.party.includes(u));
      if (notInParty.length > 0) {
        res.status(400).json({ error: "파티에 있는 포켓몬만 맡길 수 있습니다" });
        return;
      }

      const remainingParty = user.party.filter((u) => !uidSet.has(u));
      if (remainingParty.length === 0) {
        res.status(400).json({ error: "파티에 최소 1마리는 남아야 합니다" });
        return;
      }

      const moving = user.pokemon.filter((p) => uidSet.has(p.uid));
      user.pokemon = user.pokemon.filter((p) => !uidSet.has(p.uid));
      user.storage.push(...moving);
      user.party = remainingParty;
      await saveUser(user);
      res.json({ deposited: moving.map((p) => p.uid) });
    });
  } catch (err) {
    log.error({ err }, "Deposit-many error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
