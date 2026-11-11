import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client. The anon key stays in server env (never shipped
// to the browser), and all DB access happens in server actions / server
// components. The app itself is gated by the login cookie.
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_ANON_KEY!;

export function db() {
  return createClient(url, key, { auth: { persistSession: false } });
}
