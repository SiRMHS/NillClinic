import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
}

export function signJwt(payload: JwtPayload): string {
  if (!SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign(payload, SECRET, {
    expiresIn: 86400, // 24h in seconds
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
