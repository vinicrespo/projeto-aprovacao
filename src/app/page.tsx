import { Nav, Stat } from "@/components/ui";
import { BarChart } from "@/components/Chart";
import Link from "next/link";
import {
  getOffers, getEntries, getFixedExpenses, getGoal,
  sumEntries, byDay, fixedTotal,
} from "@/lib/data";
import { brl, monthKey } from "@/lib/format";
import { createOffer, saveGoal } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: { m?: string } }) {
  const month = searchParams?.m || monthKey();
  const [offers, entries, fixed, goal] = await Promise.all([
    getOffers(), getEntries(month), getFixedExpenses(), getGoal(month),
  ]);

  const totals = sumEntries(entries);
  const fixedCost = fixedTotal(fixed);
  const netProfit = totals.profit - fixedCost; // lucro após despesas fixas
  const target = goal?.profit_target || 0;
  const distance = target - netProfit;

  const perOffer = offers.map((o) => {
    const t = sumEntries(entries.filter((e) => e.offer_id === o.id));
    return { offer: o, ...t };
  });

  return (
    <>
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold">Consolidado — {month}</h1>
          <form className="flex items-center gap-2">
            <input type="month" name="m" defaultValue={month} className="input w-44" />
            <button className="btn-ghost">Ver</button>
          </form>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Gasto (tráfego)" value={brl(totals.spend)} tone="neg" />
          <Stat label="Receita" value={brl(totals.revenue)} tone="pos" />
          <Stat label="Lucro bruto" value={brl(totals.profit)} tone={totals.profit >= 0 ? "pos" : "neg"} sub="receita − gasto" />
          <Stat label="ROI" value={totals.roi.toFixed(2) + "x"} sub="receita / gasto" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Despesas fixas" value={brl(fixedCost)} tone="neg" sub="mensalidades/ferramentas" />
          <Stat label="Lucro líquido" value={brl(netProfit)} tone={netProfit >= 0 ? "pos" : "neg"} sub="lucro − despesas fixas" />
          <Stat label="Meta de lucro" value={brl(target)} />
          <Stat label="Distância da meta" value={brl(distance)} tone={distance <= 0 ? "pos" : "neutral"} sub={distance <= 0 ? "meta batida 🎉" : "falta pra meta"} />
        </div>

        <section className="card">
          <h2 className="font-semibold mb-3">Gasto × Receita por dia (todas as ofertas)</h2>
          <BarChart data={byDay(entries)} />
          <div className="flex gap-4 text-xs text-mut mt-1">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-neg/70 inline-block rounded-sm" /> Gasto</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-pos/70 inline-block rounded-sm" /> Receita</span>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Ofertas</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {perOffer.map(({ offer, spend, revenue, profit, roi }) => (
              <Link key={offer.id} href={`/ofertas/${offer.id}`} className="card hover:border-brand transition block">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{offer.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border border-line ${offer.status === "rodando" ? "text-pos" : "text-mut"}`}>{offer.status}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-sm">
                  <div><div className="label">Gasto</div>{brl(spend)}</div>
                  <div><div className="label">Receita</div>{brl(revenue)}</div>
                  <div className={profit >= 0 ? "text-pos" : "text-neg"}><div className="label">Lucro</div>{brl(profit)}</div>
                  <div><div className="label">ROI</div>{roi.toFixed(2)}x</div>
                </div>
              </Link>
            ))}
            {!offers.length && <p className="text-mut text-sm">Nenhuma oferta ainda. Crie a primeira abaixo.</p>}
          </div>
        </section>

        <section className="grid md:grid-cols-2 gap-3">
          <form action={createOffer} className="card flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Nova oferta</label>
              <input name="name" placeholder="Nome da oferta" className="input" required />
            </div>
            <select name="status" className="input w-36">
              <option value="rodando">rodando</option>
              <option value="pausada">pausada</option>
            </select>
            <button className="btn">Criar</button>
          </form>
          <form action={saveGoal} className="card flex items-end gap-3">
            <input type="hidden" name="month" value={month} />
            <div className="flex-1">
              <label className="label">Meta de lucro do mês</label>
              <input type="number" step="0.01" name="profit_target" defaultValue={target} className="input" />
            </div>
            <button className="btn">Salvar meta</button>
          </form>
        </section>
      </main>
    </>
  );
}
