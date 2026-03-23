import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { UserData } from "../../../../shared/types.js";

const DATA_DIR = process.env.POKELOG_DATA_DIR || "pokelog-data";

function userPath(userId: string): string {
  return path.join(DATA_DIR, "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  return readJson<UserData>(userPath(userId));
}

export async function saveUser(userData: UserData): Promise<void> {
  await writeJson(userPath(userData.account.id), userData);
}

export async function getAllUsers(): Promise<UserData[]> {
  const usersDir = path.join(DATA_DIR, "users");
  try {
    const files = await fs.readdir(usersDir);
    const users: UserData[] = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const user = await readJson<UserData>(path.join(usersDir, file));
        if (user) users.push(user);
      }
    }
    return users;
  } catch {
    return [];
  }
}

export async function findUserByEmail(email: string): Promise<UserData | null> {
  const users = await getAllUsers();
  return users.find((u) => {
    return u.account.matchings.git?.emails.includes(email);
  }) || null;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  return user !== null;
}
