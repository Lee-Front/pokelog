import { Router } from "express";
import { getConfig, saveConfig } from "../storage/config-store.js";
import { getAllUsers } from "../storage/user-store.js";
import { pollAllRepos } from "../polling/polling-worker.js";
import type { ServerConfig } from "../../../../shared/types.js";

export const adminRoutes = Router();

const startTime = Date.now();

// Add repo
adminRoutes.post("/repo", async (req, res) => {
  try {
    const { url, branches } = req.body;
    if (!url) return res.status(400).json({ error: "url이 필요합니다" });

    const config = await getConfig();
    const exists = config.polling.repos.some((r) => r.url === url);
    if (exists) return res.status(409).json({ error: "이미 등록된 repo입니다" });

    config.polling.repos.push({ url, branches: branches || ["main"] });
    await saveConfig(config);
    res.json({ ok: true, repos: config.polling.repos });
  } catch (err) {
    res.status(500).json({ error: "서버 오류" });
  }
});

// List repos
adminRoutes.get("/repos", async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({ repos: config.polling.repos });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Remove repo
adminRoutes.delete("/repo", async (req, res) => {
  try {
    const { url } = req.body;
    const config = await getConfig();
    config.polling.repos = config.polling.repos.filter((r) => r.url !== url);
    await saveConfig(config);
    res.json({ ok: true, repos: config.polling.repos });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Get config
adminRoutes.get("/config", async (_req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Set config value
adminRoutes.put("/config", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "key가 필요합니다" });

    const config = await getConfig();
    const keys = key.split(".");
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>;
      if (!obj) return res.status(400).json({ error: `잘못된 경로: ${key}` });
    }
    obj[keys[keys.length - 1]] = value;
    await saveConfig(config);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Server status
adminRoutes.get("/status", async (_req, res) => {
  try {
    const config = await getConfig();
    const users = await getAllUsers();
    res.json({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      repoCount: config.polling.repos.length,
      userCount: users.length,
      pollingInterval: config.polling.intervalMinutes,
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// List users
adminRoutes.get("/users", async (_req, res) => {
  try {
    const users = await getAllUsers();
    res.json(
      users.map((u) => ({ id: u.account.id, nickname: u.account.nickname }))
    );
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Manual polling
adminRoutes.post("/polling/run", async (_req, res) => {
  try {
    await pollAllRepos();
    res.json({ ok: true, message: "Polling 완료" });
  } catch (err) {
    res.status(500).json({ error: "Polling 실패" });
  }
});
