export const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export const pct = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format((n || 0) * 100) + "%";

export const roiX = (spend: number, revenue: number) =>
  spend > 0 ? revenue / spend : 0;

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
