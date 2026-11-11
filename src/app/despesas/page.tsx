import { Shell } from "@/components/Shell";
import { Stat } from "@/components/ui";
import { DespesaRow } from "@/components/DespesaRow";
import {
  getFixedExpensesForMonth, effectiveTotal, getSelectedMonth,
  getVariableExpenses, variableTotal,
} from "@/lib/data";
import { brl, monthKey, monthLabel, todayISO } from "@/lib/format";
import { saveFixedExpense, saveVariableExpense, deleteVariableExpense } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function DespesasPage() {
  const month = (await getSelectedMonth()) || monthKey();
  const [exp, variaveis] = await Promise.all([
    getFixedExpensesForMonth(month),
    getVariableExpenses(month),
  ]);
  const totalFixo = effectiveTotal(exp);
  const totalVar = variableTotal(variaveis);

  return (
    <Shell active="despesas">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Despesas</h1>
          <p className="text-mut text-sm mt-1">
            Mês: <span className="text-txt font-medium">{monthLabel(month)}</span>. Para trocar o mês, use o seletor no Consolidado Geral.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Fixas (mês)" value={brl(totalFixo)} tone="neg" />
          <Stat label="Variáveis (mês)" value={brl(totalVar)} tone="neg" />
          <Stat label="Total despesas" value={brl(totalFixo + totalVar)} tone="neg" />
        </div>

        {/* ---- DESPESAS FIXAS ---- */}
        <section className="space-y-3">
          <h2 className="font-semibold">Despesas fixas (mensais)</h2>
          <form action={saveFixedExpense} className="card flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Nova ferramenta / despesa fixa</label>
              <input name="name" placeholder="Ex: Vturb" className="input" required />
            </div>
            <div>
              <label className="label">Valor / mês</label>
              <input type="number" step="0.01" name="amount" defaultValue="0" className="input w-32" />
            </div>
            <button className="btn">+ Adicionar</button>
          </form>
          <div className="card">
            <div className="text-mut text-xs uppercase tracking-wide mb-1">Ferramentas — {monthLabel(month)}</div>
            {exp.map((e) => (
              <DespesaRow key={e.id} e={e} month={month} />
            ))}
            {!exp.length && <p className="text-mut text-sm py-3">Nenhuma despesa fixa ainda.</p>}
          </div>
        </section>

        {/* ---- DESPESAS VARIÁVEIS ---- */}
        <section className="space-y-3">
          <h2 className="font-semibold">Despesas variáveis</h2>
          <p className="text-mut text-xs">Gastos pontuais do mês (BM, perfil, conta de anúncio, chip, etc).</p>
          <form action={saveVariableExpense} className="card flex flex-wrap items-end gap-3">
            <input type="hidden" name="month" value={month} />
            <div className="flex-1 min-w-[180px]">
              <label className="label">Descrição</label>
              <input name="description" placeholder="Ex: BM Facebook, perfil, conta..." className="input" required />
            </div>
            <div>
              <label className="label">Valor</label>
              <input type="number" step="0.01" name="amount" defaultValue="0" className="input w-28" />
            </div>
            <div>
              <label className="label">Data</label>
              <input type="date" name="spent_date" defaultValue={todayISO()} className="input" />
            </div>
            <button className="btn">+ Adicionar</button>
          </form>
          <div className="card overflow-x-auto">
            <table>
              <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th></th></tr></thead>
              <tbody>
                {variaveis.map((v) => (
                  <tr key={v.id}>
                    <td>{v.spent_date ? v.spent_date.split("-").reverse().join("/") : "—"}</td>
                    <td>{v.description}</td>
                    <td className="text-neg">{brl(Number(v.amount))}</td>
                    <td className="text-right">
                      <form action={deleteVariableExpense}>
                        <input type="hidden" name="id" value={v.id} />
                        <button className="text-mut hover:text-neg text-xs">excluir</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!variaveis.length && <tr><td colSpan={4} className="text-mut">Nenhuma despesa variável neste mês.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Shell>
  );
}
