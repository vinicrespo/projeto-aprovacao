import { Shell } from "@/components/Shell";
import { Stat } from "@/components/ui";
import { DespesaRow } from "@/components/DespesaRow";
import { getFixedExpensesForMonth, effectiveTotal, getSelectedMonth } from "@/lib/data";
import { brl, monthKey, monthLabel } from "@/lib/format";
import { saveFixedExpense } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function DespesasPage() {
  const month = (await getSelectedMonth()) || monthKey();
  const exp = await getFixedExpensesForMonth(month);
  const total = effectiveTotal(exp);

  return (
    <Shell active="despesas">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Despesas fixas (mensais)</h1>
          <p className="text-mut text-sm mt-1">
            Mês: <span className="text-txt font-medium">{monthLabel(month)}</span> — ative/desative por mês.
            Para trocar o mês, use o seletor no Consolidado Geral.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total ativo no mês" value={brl(total)} tone="neg" />
          <Stat label="Ferramentas ativas" value={String(exp.filter((e) => e.active).length)} />
        </div>

        <form action={saveFixedExpense} className="card flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Nova ferramenta / despesa</label>
            <input name="name" placeholder="Ex: Vturb" className="input" required />
          </div>
          <div>
            <label className="label">Valor / mês</label>
            <input type="number" step="0.01" name="amount" defaultValue="0" className="input w-32" />
          </div>
          <button className="btn">+ Adicionar</button>
        </form>

        <section className="card">
          <div className="text-mut text-xs uppercase tracking-wide mb-1">Ferramentas — {monthLabel(month)}</div>
          {exp.map((e) => (
            <DespesaRow key={e.id} e={e} month={month} />
          ))}
          {!exp.length && <p className="text-mut text-sm py-3">Nenhuma despesa ainda.</p>}
        </section>
      </div>
    </Shell>
  );
}
