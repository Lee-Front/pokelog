import express from "express";
import fs from "node:fs";
import { projectPath } from "./paths.js";
import { getConfig } from "./storage/config-store.js";
import { authRoutes } from "./routes/auth-routes.js";
import { userRoutes } from "./routes/user-routes.js";
import { gameRoutes } from "./routes/game-routes.js";
import shopRoutes from "./routes/shop-routes.js";
import battleRoutes from "./routes/battle-routes.js";
import socialRoutes from "./routes/social-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  // 서버 메타데이터 (인증 불필요)
  app.get("/api/meta", async (_req, res) => {
    const config = await getConfig();
    res.json(config.meta);
  });

  // 볼 ANSI 아트 API — /:species보다 먼저 등록해야 매칭됨
  app.get("/api/art/ball/:name", (req, res) => {
    const name = req.params.name.replace(/[^a-zA-Z0-9-]/g, "");
    const artPath = projectPath("data/colorscripts/small/ball", name);
    try {
      const art = fs.readFileSync(artPath, "utf-8");
      res.type("text/plain").send(art);
    } catch {
      res.status(404).send("");
    }
  });

  // 포켓몬 ANSI 아트 API (인증 불필요)
  app.get("/api/art/:species", (req, res) => {
    const species = req.params.species.replace(/[^a-zA-Z0-9-]/g, "");
    const artPath = projectPath("data/colorscripts/small/regular", species);
    try {
      const art = fs.readFileSync(artPath, "utf-8");
      res.type("text/plain").send(art);
    } catch {
      res.status(404).send("");
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/game", gameRoutes);
  app.use("/api/shop", shopRoutes);
  app.use("/api/battle", battleRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/admin", adminRoutes);

  return app;
}
