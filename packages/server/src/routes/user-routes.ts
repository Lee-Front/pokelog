import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser, isEmailTaken } from "../storage/user-store.js";

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
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

userRoutes.put("/nickname", async (req: AuthRequest, res: Response) => {
  try {
    const { nickname } = req.body;
    if (!nickname) {
      res.status(400).json({ error: "닉네임을 입력해주세요" });
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
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

userRoutes.post("/match", async (req: AuthRequest, res: Response) => {
  try {
    const { app, identifier } = req.body;
    if (!app || !identifier) {
      res.status(400).json({ error: "앱과 식별자를 입력해주세요" });
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
        res.status(409).json({ error: "이미 등록된 이메일입니다" });
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
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

userRoutes.delete("/match", async (req: AuthRequest, res: Response) => {
  try {
    const { app, identifier } = req.body;
    if (!app || !identifier) {
      res.status(400).json({ error: "앱과 식별자를 입력해주세요" });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (app === "git" && user.account.matchings.git) {
      user.account.matchings.git.emails = user.account.matchings.git.emails.filter(
        (e) => e !== identifier,
      );
    } else {
      delete user.account.matchings[app];
    }

    await saveUser(user);
    res.json({ matchings: user.account.matchings });
  } catch (err) {
    console.error("Match delete error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
