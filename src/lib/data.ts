import { db } from "./supabase";
import type { Offer, DailyEntry, FixedExpense, Goal } from "./types";

export async function getOffers(): Promise<Offer[]> {
  const { data, error } = await db().from("offers").select("*").order("created_at");
  if (error) throw error;
  return data as Offer[];
}

export async function getOffer(id: string): Promise<Offer | null> {
  const { data } = await db().from("offers").select("*").eq("id", id).maybeSingle();
  return (data as Offer) ?? null;
}

export async function getEntries(month?: string, offerId?: string): Promise<DailyEntry[]> {
  let q = db().from("daily_entries").select("*").order("entry_date");
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    q = q.gte("entry_date", `${month}-01`).lt("entry_date", next);
  }
  if (offerId) q = q.eq("offer_id", offerId);
  const { data, error } = await q;
  if (error) throw error;
  return data as DailyEntry[];
}

export async function getFixedExpenses(): Promise<FixedExpense[]> {
  const { data, error } = await db().from("fixed_expenses").select("*").order("name");
  if (error) throw error;
  return data as FixedExpense[];
}

export async function getGoal(month: string): Promise<Goal | null> {
  const { data } = await db()
    .from("goals")
    .select("*")
    .eq("month", `${month}-01`)
    .maybeSingle();
  return (data as Goal) ?? null;
}

// ---- aggregations ----
export type Totals = { spend: number; revenue: number; profit: number; roi: number };

export function sumEntries(entries: DailyEntry[]): Totals {
  const spend = entries.reduce((s, e) => s + Number(e.spend), 0);
  const revenue = entries.reduce((s, e) => s + Number(e.revenue), 0);
  const profit = revenue - spend;
  const roi = spend > 0 ? revenue / spend : 0;
  return { spend, revenue, profit, roi };
}

export function byDay(entries: DailyEntry[]) {
  const map = new Map<string, { spend: number; revenue: number }>();
  for (const e of entries) {
    const cur = map.get(e.entry_date) || { spend: 0, revenue: 0 };
    cur.spend += Number(e.spend);
    cur.revenue += Number(e.revenue);
    map.set(e.entry_date, cur);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v, profit: v.revenue - v.spend }));
}

export function fixedTotal(exp: FixedExpense[]) {
  return exp.filter((e) => e.active).reduce((s, e) => s + Number(e.amount), 0);
}

export async function getRecurring(month: string): Promise<number> {
  const { data } = await db()
    .from("recurring_revenue")
    .select("amount")
    .eq("month", `${month}-01`)
    .maybeSingle();
  return data ? Number((data as { amount: number }).amount) : 0;
}
