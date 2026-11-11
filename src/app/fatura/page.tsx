import { Shell } from "@/components/Shell";
import { Stat } from "@/components/ui";
import { getTotalSpendAllTime, getInvoicePayments, getSetting } from "@/lib/data";
import { brl, todayISO } from "@/lib/format";
import { savePayment, deletePayment, saveCardLimit } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function FaturaPage() {
  const [totalSpend, payments, limit] = await Promise.all([
    getTotalSpendAllTime(), getInvoicePayments(), getSetting("card_limit"),
  ]);
  const totalPago = payments.reduce((s, p) => s + Number(p.amount), 0);
  const emAberto = totalSpend - totalPago;
  const restaLimite = limit - emAberto;
  const usoPct = limit > 0 ? Math.min(100, Math.max(0, (emAberto / limit) * 100)) : 0;
  const porOrigem = (src: string) =>
    payments.filter((p) => p.source === src).reduce((s, p) => s + Number(p.amount), 0);

  return (
    <Shell active="fatura">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div>
          <div className="text-mut text-sm">Cartão de crédito</div>
          <h1 className="text-2xl font-semibold">Fatura</h1>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Gasto acumulado" value={brl(totalSpend)} tone="neg" sub="tudo que foi lançado" />
          <Stat label="Já abatido" value={brl(totalPago)} tone="pos" sub="pagamentos registrados" />
          <Stat label="Fatura em aberto" value={brl(emAberto)} tone={emAberto > 0 ? "neg" : "pos"} sub="falta pagar" />
          <Stat label="Resta no limite" value={limit > 0 ? brl(restaLimite) : "—"} tone={restaLimite < 0 ? "neg" : "neutral"} sub={limit > 0 ? `limite ${brl(limit)}` : "defina o limite"} />
        </div>

        {limit > 0 && (
          <div className="card">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-mut">Uso do limite</span>
              <span className={usoPct >= 90 ? "text-neg" : "text-txt"}>{usoPct.toFixed(0)}%</span>
            </div>
            <div className="h-3 bg-panel2 rounded-full overflow-hidden">
              <div className={`h-full ${usoPct >= 90 ? "bg-neg" : usoPct >= 70 ? "bg-brand" : "bg-pos"}`} style={{ width: `${usoPct}%` }} />
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <form action={savePayment} className="card space-y-3">
            <h2 className="font-semibold">Registrar abatimento (pagamento)</h2>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">Data</label>
                <input type="date" name="paid_date" defaultValue={todayISO()} className="input" required />
              </div>
              <div className="flex-1">
                <label className="label">Valor</label>
                <div className="relative">
                  <input type="number" step="0.01" name="amount" defaultValue="0" className="input" required />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">Conta que pagou</label>
                <select name="source" className="input">
                  <option value="PJ">PJ (empresa)</option>
                  <option value="PF">PF (pessoal)</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
              <div className="flex-[2]">
                <label className="label">Observação</label>
                <input name="note" placeholder="opcional" className="input" />
              </div>
            </div>
            <button className="btn w-full">Registrar abatimento</button>
          </form>

          <div className="space-y-3">
            <form action={saveCardLimit} className="card flex items-end gap-3">
              <div className="flex-1">
                <label className="label">Limite do cartão</label>
                <div className="relative">
                  <input type="number" step="0.01" name="num" defaultValue={limit} className="input" />
                </div>
              </div>
              <button className="btn-ghost">Salvar</button>
            </form>
            <div className="card">
              <div className="label">Abatido por conta</div>
              <div className="flex justify-between py-1 text-sm"><span>PJ (empresa)</span><span className="text-pos">{brl(porOrigem("PJ"))}</span></div>
              <div className="flex justify-between py-1 text-sm"><span>PF (pessoal)</span><span className="text-pos">{brl(porOrigem("PF"))}</span></div>
              <div className="flex justify-between py-1 text-sm border-t border-line mt-1 pt-1"><span className="text-mut">Outro</span><span>{brl(porOrigem("Outro"))}</span></div>
            </div>
          </div>
        </div>

        <section className="card overflow-x-auto">
          <h2 className="font-semibold mb-3">Abatimentos registrados</h2>
          <table>
            <thead><tr><th>Data</th><th>Valor</th><th>Conta</th><th>Obs.</th><th></th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.paid_date.split("-").reverse().join("/")}</td>
                  <td className="text-pos">{brl(Number(p.amount))}</td>
                  <td>{p.source}</td>
                  <td className="text-mut">{p.note || "—"}</td>
                  <td className="text-right">
                    <form action={deletePayment}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-mut hover:text-neg text-xs">excluir</button>
                    </form>
                  </td>
                </tr>
              ))}
              {!payments.length && <tr><td colSpan={5} className="text-mut">Nenhum abatimento ainda.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </Shell>
  );
}
