"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "./supabase";
import { checkCredentials, makeToken, COOKIE_NAME } from "./auth";

export async function login(formData: FormData) {
  const user = String(formData.get("user") || "");
  const pass = String(formData.get("pass") || "");
  if (!checkCredentials(user, pass)) {
    redirect("/login?e=1");
  }
  cookies().set(COOKIE_NAME, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

export async function logout() {
  cookies().delete(COOKIE_NAME);
  redirect("/login");
}

export async function createOffer(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const status = String(formData.get("status") || "rodando");
  await db().from("offers").insert({ name, status, started_at: new Date().toISOString().slice(0, 10) });
  revalidatePath("/");
}

export async function updateOfferStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await db().from("offers").update({ status }).eq("id", id);
  revalidatePath("/");
  revalidatePath(`/ofertas/${id}`);
}

export async function saveEntry(formData: FormData) {
  const offer_id = String(formData.get("offer_id"));
  const entry_date = String(formData.get("entry_date"));
  const spend = Number(formData.get("spend") || 0);
  const revenue = Number(formData.get("revenue") || 0);
  // upsert: one row per offer per day
  await db()
    .from("daily_entries")
    .upsert({ offer_id, entry_date, spend, revenue }, { onConflict: "offer_id,entry_date" });
  revalidatePath("/");
  revalidatePath(`/ofertas/${offer_id}`);
}

export async function deleteEntry(formData: FormData) {
  const id = String(formData.get("id"));
  const offer_id = String(formData.get("offer_id"));
  await db().from("daily_entries").delete().eq("id", id);
  revalidatePath("/");
  revalidatePath(`/ofertas/${offer_id}`);
}

export async function saveFixedExpense(formData: FormData) {
  const id = formData.get("id") ? String(formData.get("id")) : null;
  const name = String(formData.get("name") || "").trim();
  const amount = Number(formData.get("amount") || 0);
  const active = formData.get("active") === "on" || formData.get("active") === "true";
  if (id) {
    await db().from("fixed_expenses").update({ name, amount, active }).eq("id", id);
  } else if (name) {
    await db().from("fixed_expenses").insert({ name, amount, active: true });
  }
  revalidatePath("/despesas");
  revalidatePath("/");
}

export async function deleteFixedExpense(formData: FormData) {
  const id = String(formData.get("id"));
  await db().from("fixed_expenses").delete().eq("id", id);
  revalidatePath("/despesas");
  revalidatePath("/");
}

export async function saveGoal(formData: FormData) {
  const month = String(formData.get("month")); // YYYY-MM
  const profit_target = Number(formData.get("profit_target") || 0);
  await db()
    .from("goals")
    .upsert({ month: `${month}-01`, profit_target }, { onConflict: "month" });
  revalidatePath("/");
}

export async function saveRecurring(formData: FormData) {
  const month = String(formData.get("month")); // YYYY-MM
  const amount = Number(formData.get("amount") || 0);
  await db()
    .from("recurring_revenue")
    .upsert({ month: `${month}-01`, amount }, { onConflict: "month" });
  revalidatePath("/");
}
