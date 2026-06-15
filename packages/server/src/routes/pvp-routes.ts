/**
 * 유저간 PvP REST 라우트 — Phase 1(친선전).
 * 실시간성은 클라이언트 폴링 전제(GET /pvp/matches/:id 로 상태·상대행동·라운드로그 조회).
 * WebSocket/SSE는 도입하지 않는다(Phase 1).
 */
import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { GameRuleError } from "../game/game-errors.js";
import type { PvpAction, PvpMode } from "../../../../shared/types.js";
import {
  createChallenge, acceptChallenge, declineChallenge,
  enqueue, dequeue, submitAction, forfeit, postChat,
  getMatchForUser, listMatches,
} from "../game/pvp.js";
import { childLogger } from "../logger.js";

const log = childLogger("pvp-routes");

export const pvpRoutes = Router();
pvpRoutes.use(authMiddleware);

/** GameRuleError는 상태코드 매핑, 그 외는 500. 핸들러 공통 처리. */
function handleError(err: unknown, res: Response, context: string): void {
  if (err instanceof GameRuleError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  log.error({ err }, context);
  res.status(500).json({ error: "서버 오류가 발생했습니다" });
}

function parseMode(value: unknown): PvpMode {
  if (value === "single" || value === "party") return value;
  throw new GameRuleError("mode는 'single' 또는 'party'여야 합니다.");
}

/** 요청 본문 → PvpAction 파싱·검증. */
function parseAction(body: Record<string, unknown>): PvpAction {
  const kind = body.kind;
  if (kind === "move") {
    if (typeof body.moveId !== "string") throw new GameRuleError("moveId가 필요합니다.");
    return { kind: "move", moveId: body.moveId };
  }
  if (kind === "switch") {
    if (typeof body.teamIndex !== "number" || !Number.isInteger(body.teamIndex)) {
      throw new GameRuleError("teamIndex(정수)가 필요합니다.");
    }
    return { kind: "switch", teamIndex: body.teamIndex };
  }
  throw new GameRuleError("kind는 'move' 또는 'switch'여야 합니다.");
}

// --- 지정 도전 ----------------------------------------------------------------

pvpRoutes.post("/challenges", async (req: AuthRequest, res: Response) => {
  try {
    const { opponentUserId, mode, teamUids } = req.body ?? {};
    if (typeof opponentUserId !== "string") {
      res.status(400).json({ error: "opponentUserId가 필요합니다." });
      return;
    }
    const match = await createChallenge({
      challengerUserId: req.userId!,
      opponentUserId,
      mode: parseMode(mode),
      challengerTeamUids: Array.isArray(teamUids) ? teamUids.map(String) : undefined,
    });
    res.status(201).json({ match });
  } catch (err) {
    handleError(err, res, "PvP challenge create error");
  }
});

pvpRoutes.post("/challenges/:id/accept", async (req: AuthRequest, res: Response) => {
  try {
    const match = await acceptChallenge(req.userId!, req.params.id);
    res.json({ match });
  } catch (err) {
    handleError(err, res, "PvP challenge accept error");
  }
});

pvpRoutes.post("/challenges/:id/decline", async (req: AuthRequest, res: Response) => {
  try {
    const match = await declineChallenge(req.userId!, req.params.id);
    res.json({ match });
  } catch (err) {
    handleError(err, res, "PvP challenge decline error");
  }
});

// --- 자동 대기열 --------------------------------------------------------------

pvpRoutes.post("/queue", async (req: AuthRequest, res: Response) => {
  try {
    const { mode, teamUids } = req.body ?? {};
    const result = await enqueue({
      userId: req.userId!,
      mode: parseMode(mode),
      teamUids: Array.isArray(teamUids) ? teamUids.map(String) : undefined,
    });
    if (result.matched) {
      res.status(201).json({ matched: true, match: result.match });
    } else {
      res.json({ matched: false });
    }
  } catch (err) {
    handleError(err, res, "PvP queue enqueue error");
  }
});

pvpRoutes.delete("/queue", async (req: AuthRequest, res: Response) => {
  try {
    await dequeue(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res, "PvP queue cancel error");
  }
});

// --- 매치 조회(폴링) ----------------------------------------------------------

pvpRoutes.get("/matches", async (req: AuthRequest, res: Response) => {
  try {
    const matches = await listMatches(req.userId!);
    res.json({ matches });
  } catch (err) {
    handleError(err, res, "PvP match list error");
  }
});

pvpRoutes.get("/matches/:id", async (req: AuthRequest, res: Response) => {
  try {
    const match = await getMatchForUser(req.userId!, req.params.id);
    res.json({ match });
  } catch (err) {
    handleError(err, res, "PvP match get error");
  }
});

// --- 행동/기권/채팅 -----------------------------------------------------------

pvpRoutes.post("/matches/:id/action", async (req: AuthRequest, res: Response) => {
  try {
    const action = parseAction(req.body ?? {});
    const match = await submitAction(req.userId!, req.params.id, action);
    res.json({ match });
  } catch (err) {
    handleError(err, res, "PvP action error");
  }
});

pvpRoutes.post("/matches/:id/forfeit", async (req: AuthRequest, res: Response) => {
  try {
    const match = await forfeit(req.userId!, req.params.id);
    res.json({ match });
  } catch (err) {
    handleError(err, res, "PvP forfeit error");
  }
});

pvpRoutes.post("/matches/:id/chat", async (req: AuthRequest, res: Response) => {
  try {
    const text = (req.body ?? {}).text;
    if (typeof text !== "string") {
      res.status(400).json({ error: "text가 필요합니다." });
      return;
    }
    const message = await postChat(req.userId!, req.params.id, text);
    res.status(201).json({ message });
  } catch (err) {
    handleError(err, res, "PvP chat error");
  }
});
