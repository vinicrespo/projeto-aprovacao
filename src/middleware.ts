import { NextResponse, type NextRequest } from "next/server";

const secret = process.env.AUTH_SECRET || "dev-secret-change-me";

async function hmacHex(message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function valid(token?: string) {
  if (!token) return false;
  const [v, sig] = token.split(".");
  if (v !== "ok" || !sig) return false;
  return sig === (await hmacHex("ok"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login")) return NextResponse.next();
  const token = req.cookies.get("dr_session")?.value;
  if (!(await valid(token))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
