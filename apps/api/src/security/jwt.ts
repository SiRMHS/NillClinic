import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  /** User.tokenVersion at issue time; a mismatch means the token was revoked. */
  v: number;
}

export function signJwt(payload: JwtPayload): string {
  if (!SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(payload, SECRET, {
    // 8h rather than 24h: this is a clinic back-office, and a shorter window
    // limits how long a leaked token stays useful.
    expiresIn: Number(process.env.JWT_EXPIRES_SECONDS ?? 60 * 60 * 8),
    algorithm: "HS256",
    issuer: "jordan-clinic",
  } as jwt.SignOptions);
}

export function verifyJwt(token: string): JwtPayload {
  if (!SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.verify(token, SECRET, {
    algorithms: ["HS256"],
    issuer: "jordan-clinic",
  }) as unknown as JwtPayload;
}
