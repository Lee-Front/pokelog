import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.POKELOG_JWT_SECRET;
if (!jwtSecret) {
  console.error("FATAL: POKELOG_JWT_SECRET environment variable is required");
  process.exit(1);
}
const JWT_SECRET: string = jwtSecret;
const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function issueToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
      return null;
    }
    const userId = "userId" in decoded ? decoded.userId : null;
    return typeof userId === "string" ? { userId } : null;
  } catch {
    return null;
  }
}
