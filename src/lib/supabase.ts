import { createClient } from "@supabase/supabase-js";

// Supabase connection. Prefer env vars (Vercel); fall back to the project's
// own values so the app works out-of-the-box without any dashboard config.
// The anon key is protected by RLS + the app login gate.
const url = process.env.SUPABASE_URL || "https://vuwmsoubltlqicbyfvmz.supabase.co";
const key =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1d21zb3VibHRscWljYnlmdm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5NjY2MTYsImV4cCI6MjA4MjU0MjYxNn0.h23pi8-24GoGMx5e3umZWr23rmvZpMT3cUA51K5Yo18";

// Always read fresh — never let Next.js cache dashboard data.
export function db() {
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
