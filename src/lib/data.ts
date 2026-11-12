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

export type InvoicePayment = {
  id: string; paid_date: string; amount: number; source: "PF" | "PJ" | "Outro"; note: string | null;
};

export async function getTotalSpendAllTime(): Promise<number> {
  const { data } = await db().from("daily_entries").select("spend");
  return (data || []).reduce((s, r) => s + Number((r as { spend: number }).spend), 0);
}

export async function getInvoicePayments(): Promise<InvoicePayment[]> {
  const { data } = await db().from("invoice_payments").select("*").order("paid_date", { ascending: false });
  return (data || []) as InvoicePayment[];
}

export async function getSetting(key: string): Promise<number> {
  const { data } = await db().from("app_settings").select("num").eq("key", key).maybeSingle();
  return data ? Number((data as { num: number }).num) : 0;
}

export type EffectiveExpense = { id: string; name: string; amount: number; active: boolean };

export async function getFixedExpensesForMonth(month: string): Promise<EffectiveExpense[]> {
  const [cat, over] = await Promise.all([
    db().from("fixed_expenses").select("*").order("name"),
    db().from("fixed_expense_months").select("*").eq("month", `${month}-01`),
  ]);
  const overrides = (over.data || []) as { expense_id: string; active: boolean | null; amount: number | null }[];
  return ((cat.data || []) as FixedExpense[]).map((c) => {
    const o = overrides.find((x) => x.expense_id === c.id);
    return {
      id: c.id,
      name: c.name,
      amount: o && o.amount != null ? Number(o.amount) : Number(c.amount),
      active: o && o.active != null ? o.active : c.active,
    };
  });
}

export function effectiveTotal(list: EffectiveExpense[]) {
  return list.filter((e) => e.active).reduce((s, e) => s + Number(e.amount), 0);
}

export async function getSelectedMonth(): Promise<string | null> {
  const { data } = await db().from("app_settings").select("txt").eq("key", "sel_month").maybeSingle();
  const v = data ? (data as { txt: string | null }).txt : null;
  return v || null;
}

export type VariableExpense = { id: string; month: string; spent_date: string | null; description: string; amount: number };

export async function getVariableExpenses(month: string): Promise<VariableExpense[]> {
  const { data } = await db()
    .from("variable_expenses")
    .select("*")
    .eq("month", `${month}-01`)
    .order("spent_date", { ascending: true });
  return (data || []) as VariableExpense[];
}

export function variableTotal(list: VariableExpense[]) {
  return list.reduce((s, e) => s + Number(e.amount), 0);
}

export async function getEntriesSince(startISO: string): Promise<DailyEntry[]> {
  const { data, error } = await db()
    .from("daily_entries")
    .select("*")
    .gte("entry_date", startISO)
    .order("entry_date");
  if (error) throw error;
  return data as DailyEntry[];
}
