import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

function getJwtSecret(): string {
  const secret = process.env.POKELOG_JWT_SECRET;
  if (!secret) {
    throw new Error("POKELOG_JWT_SECRET environment variable is required");
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function issueToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: "30d" });
}

export interface TokenPayload {
  userId: string;
  /** Seconds-since-epoch, as set by jsonwebtoken. Present for any token issued by issueToken. */
  iat?: number;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
      return null;
    }
    const userId = "userId" in decoded ? decoded.userId : null;
    if (typeof userId !== "string") return null;
    const iat = "iat" in decoded && typeof decoded.iat === "number" ? decoded.iat : undefined;
    return { userId, iat };
  } catch {
    return null;
  }
}
