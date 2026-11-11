import { cookies } from "next/headers";
import { createHmac } from "crypto";

const COOKIE = "dr_session";
const secret = process.env.AUTH_SECRET || "dev-secret-change-me";

function sign(value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function makeToken() {
  const v = "ok";
  return `${v}.${sign(v)}`;
}

export function isValid(token?: string | null) {
  if (!token) return false;
  const [v, sig] = token.split(".");
  return !!v && sig === sign(v);
}

export function checkCredentials(user: string, pass: string) {
  const U = process.env.APP_USER || "teste";
  const P = process.env.APP_PASSWORD || "teste";
  return user === U && pass === P;
}

export function isLoggedIn() {
  return isValid(cookies().get(COOKIE)?.value);
}

export const COOKIE_NAME = COOKIE;
