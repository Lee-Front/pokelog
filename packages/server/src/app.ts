import express from "express";
import fs from "node:fs";
import path from "node:path";
import { projectPath } from "./paths.js";
import { getConfig } from "./storage/config-store.js";
import { getMoves, getMoveById } from "./game/data-loader.js";
import { authRoutes } from "./routes/auth-routes.js";
import { userRoutes } from "./routes/user-routes.js";
import { gameRoutes } from "./routes/game-routes.js";
import { tradeRoutes } from "./routes/trade-routes.js";
import { eggRoutes } from "./routes/egg-routes.js";
import { evolutionRoutes } from "./routes/evolution-routes.js";
import { itemRoutes } from "./routes/item-routes.js";
import { fusionRoutes } from "./routes/fusion-routes.js";
import { storageRoutes } from "./routes/storage-routes.js";
import { shopRoutes } from "./routes/shop-routes.js";
import { battleRoutes } from "./routes/battle-routes.js";
import { socialRoutes } from "./routes/social-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { towerRoutes } from "./routes/tower-routes.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // 서버 메타데이터 (인증 불필요)
  app.get("/api/meta", async (_req, res) => {
    const config = await getConfig();
    res.json(config.meta);
  });

  // 기술 데이터 - 슬림 카탈로그 (CLI가 기술 정보 표시에 사용, 인증 불필요)
  app.get("/api/moves/catalog", (_req, res) => {
    const moves = getMoves();
    const slim = moves.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      category: m.category,
      power: m.power ?? 0,
      accuracy: m.accuracy ?? 0,
      pp: m.pp ?? 0,
      priority: m.priority ?? 0,
    }));
    res.json({ moves: slim });
  });

  // 기술 개별 조회
  app.get("/api/moves/:id", (req, res) => {
    const id = req.params.id;
    const move = getMoveById(id);
    if (!move) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ move });
  });

  // 아트 파일 읽기 헬퍼 — 경로 순회 방어 포함
  const BALL_ART_DIR = projectPath("data/colorscripts/small/ball");
  const POKEMON_ART_DIR = projectPath("data/colorscripts/small/regular");
  const EGG_ART_DIR = projectPath("data/colorscripts/small/egg");

  function safeReadArt(baseDir: string, name: string): string | null {
    const sanitized = name.replace(/[^a-zA-Z0-9-]/g, "");
    const resolved = path.resolve(baseDir, sanitized);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) return null;
    try { return fs.readFileSync(resolved, "utf-8"); } catch { return null; }
  }

  // 알 ANSI 아트 API
  app.get("/api/art/egg/:name", (req, res) => {
    const art = safeReadArt(EGG_ART_DIR, req.params.name);
    if (art) res.type("text/plain").send(art);
    else res.status(404).send("");
  });

  // 볼 ANSI 아트 API — /:species보다 먼저 등록해야 매칭됨
  app.get("/api/art/ball/:name", (req, res) => {
    const art = safeReadArt(BALL_ART_DIR, req.params.name);
    if (art) res.type("text/plain").send(art);
    else res.status(404).send("");
  });

  // 포켓몬 ANSI 아트 API (인증 불필요)
  app.get("/api/art/:species", (req, res) => {
    const art = safeReadArt(POKEMON_ART_DIR, req.params.species);
    if (art) res.type("text/plain").send(art);
    else res.status(404).send("");
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/game", gameRoutes);
  app.use("/api/game", tradeRoutes);
  app.use("/api/game", eggRoutes);
  app.use("/api/game", evolutionRoutes);
  app.use("/api/game", itemRoutes);
  app.use("/api/game", fusionRoutes);
  app.use("/api/game", storageRoutes);
  app.use("/api/shop", shopRoutes);
  app.use("/api/battle", battleRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/tower", towerRoutes);

  return app;
}
