import { Shell } from "@/components/Shell";
import { Stat } from "@/components/ui";
import { BarChart } from "@/components/Chart";
import { MonthPicker } from "@/components/MonthPicker";
import {
  getOffers, getEntries, getFixedExpensesForMonth, getGoal, getRecurring,
  sumEntries, byDay, effectiveTotal, getSelectedMonth,
  getVariableExpenses, variableTotal, getEntriesSince,
} from "@/lib/data";
import { brl, monthKey, monthLabel, todayISO } from "@/lib/format";
import { saveGoal, saveRecurring } from "@/lib/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: { m?: string } }) {
  const month = searchParams?.m || (await getSelectedMonth()) || monthKey();
  // últimos 7 dias (data corrida, independente do mês selecionado)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const last7Dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return iso(d); }); // hoje -> -6
  const start7 = last7Dates[6];
  const [offers, entries, fixed, goal, recurring, variaveis, last7] = await Promise.all([
    getOffers(), getEntries(month), getFixedExpensesForMonth(month), getGoal(month), getRecurring(month), getVariableExpenses(month), getEntriesSince(start7),
  ]);

  const totals = sumEntries(entries);
  const revenueTotal = totals.revenue + recurring;
  const grossProfit = revenueTotal - totals.spend;
  const roi = totals.spend > 0 ? revenueTotal / totals.spend : 0;
  const fixedCost = effectiveTotal(fixed);
  const varCost = variableTotal(variaveis);
  const netProfit = grossProfit - fixedCost - varCost;
  const target = goal?.profit_target || 0;
  const distance = target - netProfit;

  const perOffer = offers.map((o) => {
    const t = sumEntries(entries.filter((e) => e.offer_id === o.id));
    const e7 = last7.filter((e) => e.offer_id === o.id);
    const days = last7Dates.map((date) => {
      const row = e7.find((e) => e.entry_date === date);
      const spend = row ? Number(row.spend) : null;
      const revenue = row ? Number(row.revenue) : null;
      return {
        date,
        has: !!row,
        spend, revenue,
        profit: row ? Number(row.revenue) - Number(row.spend) : null,
        roi: row && Number(row.spend) > 0 ? Number(row.revenue) / Number(row.spend) : row ? 0 : null,
      };
    });
    return { offer: o, ...t, days };
  });

  return (
    <Shell active="consolidado">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-mut text-sm">Consolidado Geral</div>
            <h1 className="text-2xl font-semibold">{monthLabel(month)}</h1>
          </div>
          <MonthPicker month={month} path="/" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Gasto (tráfego)" value={brl(totals.spend)} tone="neg" />
          <Stat label="Receita total" value={brl(revenueTotal)} tone="pos" sub={`dias ${brl(totals.revenue)} + recorrência ${brl(recurring)}`} />
          <Stat label="Lucro bruto" value={brl(grossProfit)} tone={grossProfit >= 0 ? "pos" : "neg"} sub="receita − gasto" />
          <Stat label="ROI" value={roi.toFixed(2) + "x"} sub="receita / gasto" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Despesas fixas" value={brl(fixedCost)} tone="neg" sub="ferramentas do mês" />
          <Stat label="Despesas variáveis" value={brl(varCost)} tone="neg" sub="BM, perfil, conta..." />
          <Stat label="Lucro líquido" value={brl(netProfit)} tone={netProfit >= 0 ? "pos" : "neg"} sub="lucro − fixas − variáveis" />
          <Stat label="Distância da meta" value={brl(distance)} tone={distance <= 0 ? "pos" : "neutral"} sub={distance <= 0 ? "meta batida 🎉" : `meta ${brl(target)}`} />
        </div>

        <form action={saveRecurring} className="card flex flex-wrap items-end gap-3">
          <input type="hidden" name="month" value={month} />
          <div className="flex-1 min-w-[220px]">
            <label className="label">Recorrência / receita variável do mês (todas as ofertas)</label>
            <div className="relative">
              <input type="number" step="0.01" name="amount" defaultValue={recurring} className="input" />
            </div>
          </div>
          <button className="btn">Salvar recorrência</button>
          <p className="text-mut text-xs w-full">Valor geral, somado à receita consolidada. Flexível — atualize à vontade (chargeback, receita extra, etc).</p>
        </form>

        <section className="card">
          <h2 className="font-semibold mb-3">Gasto × Receita por dia (todas as ofertas)</h2>
          <BarChart data={byDay(entries)} />
          <div className="flex gap-4 text-xs text-mut mt-1">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-neg/70 inline-block rounded-sm" /> Gasto</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-pos/70 inline-block rounded-sm" /> Receita (dos dias)</span>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Ofertas</h2>
            <Link href="/nova-oferta" className="btn-ghost text-sm">+ Nova oferta</Link>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {perOffer.map(({ offer, spend, revenue, profit, roi, days }) => (
              <Link key={offer.id} href={`/ofertas/${offer.id}`} className="card hover:border-brand transition block">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{offer.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border border-line ${offer.status === "rodando" ? "text-pos" : "text-mut"}`}>{offer.status}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-sm [&>div]:whitespace-nowrap">
                  <div><div className="label">Gasto (mês)</div>{brl(spend)}</div>
                  <div><div className="label">Receita</div>{brl(revenue)}</div>
                  <div className={profit >= 0 ? "text-pos" : "text-neg"}><div className="label">Lucro</div>{brl(profit)}</div>
                  <div><div className="label">ROI</div>{roi.toFixed(2)}x</div>
                </div>

                <div className="mt-3 pt-2 border-t border-line">
                  <div className="text-[10px] uppercase tracking-wide text-mut mb-1">Últimos 7 dias</div>
                  <div className="text-[11px]">
                    <div className="grid grid-cols-5 gap-1 text-mut">
                      <span>Dia</span><span className="text-right">Gasto</span><span className="text-right">Receita</span><span className="text-right">Lucro</span><span className="text-right">ROI</span>
                    </div>
                    {days.map((d) => (
                      <div key={d.date} className={`grid grid-cols-5 gap-1 py-0.5 border-t border-line/30 ${d.has ? "" : "text-mut/50"}`}>
                        <span>{d.date.split("-").reverse().slice(0, 2).join("/")}</span>
                        <span className="text-right">{d.has ? brl(d.spend!).replace("R$", "").trim() : "—"}</span>
                        <span className="text-right">{d.has ? brl(d.revenue!).replace("R$", "").trim() : "—"}</span>
                        <span className={`text-right ${d.has ? (d.profit! >= 0 ? "text-pos" : "text-neg") : ""}`}>{d.has ? brl(d.profit!).replace("R$", "").trim() : "—"}</span>
                        <span className="text-right">{d.has ? d.roi!.toFixed(2) + "x" : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
            {!offers.length && <p className="text-mut text-sm">Nenhuma oferta ainda. Crie a primeira no botão acima.</p>}
          </div>
        </section>

        <form action={saveGoal} className="card flex items-end gap-3 max-w-md">
          <input type="hidden" name="month" value={month} />
          <div className="flex-1">
            <label className="label">Meta de lucro do mês</label>
            <div className="relative">
              <input type="number" step="0.01" name="profit_target" defaultValue={target} className="input" />
            </div>
          </div>
          <button className="btn">Salvar meta</button>
        </form>
      </div>
    </Shell>
  );
}
