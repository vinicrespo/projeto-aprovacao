import { Shell } from "@/components/Shell";
import { Stat } from "@/components/ui";
import { BarChart } from "@/components/Chart";
import { EntryForm } from "@/components/EntryForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffer, getEntries, sumEntries, byDay } from "@/lib/data";
import { brl, monthKey, monthLabel } from "@/lib/format";
import { updateOfferStatus, deleteEntry } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function OfferPage({
  params, searchParams,
}: { params: { id: string }; searchParams: { m?: string } }) {
  const month = searchParams?.m || monthKey();
  const offer = await getOffer(params.id);
  if (!offer) notFound();
  const entries = await getEntries(month, offer.id);
  const t = sumEntries(entries);
  const rows = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date));

  return (
    <Shell active={offer.id}>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-mut text-sm flex items-center gap-2">
              <span>Oferta</span>·<span>{monthLabel(month)}</span>
            </div>
            <h1 className="text-2xl font-semibold flex items-center gap-3">{offer.name}
              <span className={`text-xs px-2 py-0.5 rounded-full border border-line ${offer.status === "rodando" ? "text-pos" : "text-mut"}`}>{offer.status}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <form className="flex items-center gap-2">
              <input type="month" name="m" defaultValue={month} className="input w-40" />
              <button className="btn-ghost">Ver</button>
            </form>
            <form action={updateOfferStatus} className="flex items-center gap-2">
              <input type="hidden" name="id" value={offer.id} />
              <select name="status" defaultValue={offer.status} className="input w-36">
                <option value="rodando">rodando</option>
                <option value="pausada">pausada</option>
                <option value="encerrada">encerrada</option>
              </select>
              <button className="btn-ghost">Status</button>
            </form>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Gasto" value={brl(t.spend)} tone="neg" />
          <Stat label="Receita" value={brl(t.revenue)} tone="pos" />
          <Stat label="Lucro" value={brl(t.profit)} tone={t.profit >= 0 ? "pos" : "neg"} />
          <Stat label="ROI" value={t.roi.toFixed(2) + "x"} />
        </div>

        <EntryForm offerId={offer.id} />

        <section className="card">
          <h2 className="font-semibold mb-3">Gasto × Receita por dia</h2>
          <BarChart data={byDay(entries)} />
        </section>

        <section className="card overflow-x-auto">
          <h2 className="font-semibold mb-3">Lançamentos — {monthLabel(month)}</h2>
          <table>
            <thead>
              <tr><th>Data</th><th>Gasto</th><th>Receita</th><th>Lucro</th><th>ROI</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const lucro = Number(e.revenue) - Number(e.spend);
                const roi = Number(e.spend) > 0 ? Number(e.revenue) / Number(e.spend) : 0;
                return (
                  <tr key={e.id}>
                    <td>{e.entry_date.split("-").reverse().join("/")}</td>
                    <td>{brl(Number(e.spend))}</td>
                    <td>{brl(Number(e.revenue))}</td>
                    <td className={lucro >= 0 ? "text-pos" : "text-neg"}>{brl(lucro)}</td>
                    <td>{roi.toFixed(2)}x</td>
                    <td className="text-right">
                      <form action={deleteEntry}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="offer_id" value={offer.id} />
                        <button className="text-mut hover:text-neg text-xs">excluir</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="text-mut">Sem lançamentos neste mês.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}
