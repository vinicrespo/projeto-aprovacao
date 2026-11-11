import { Nav, Stat } from "@/components/ui";
import { getFixedExpenses, fixedTotal } from "@/lib/data";
import { brl } from "@/lib/format";
import { saveFixedExpense, deleteFixedExpense } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function DespesasPage() {
  const exp = await getFixedExpenses();
  const total = fixedTotal(exp);

  return (
    <>
      <Nav />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-2xl font-semibold">Despesas fixas (mensais)</h1>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total ativo / mês" value={brl(total)} tone="neg" />
          <Stat label="Itens" value={String(exp.filter((e) => e.active).length)} />
        </div>

        <section className="card overflow-x-auto">
          <table>
            <thead><tr><th>Ferramenta</th><th>Valor/mês</th><th>Ativo</th><th></th></tr></thead>
            <tbody>
              {exp.map((e) => (
                <tr key={e.id}>
                  <td>
                    <form action={saveFixedExpense} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <input name="name" defaultValue={e.name} className="input" />
                      <input type="number" step="0.01" name="amount" defaultValue={Number(e.amount)} className="input w-28" />
                      <label className="flex items-center gap-1 text-xs text-mut">
                        <input type="checkbox" name="active" defaultChecked={e.active} /> ativo
                      </label>
                      <button className="btn-ghost text-xs">Salvar</button>
                    </form>
                  </td>
                  <td>{brl(Number(e.amount))}</td>
                  <td>{e.active ? "sim" : "não"}</td>
                  <td className="text-right">
                    <form action={deleteFixedExpense}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="text-mut hover:text-neg text-xs">excluir</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <form action={saveFixedExpense} className="card flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Nova despesa</label>
            <input name="name" placeholder="Ex: Vturb" className="input" required />
          </div>
          <div>
            <label className="label">Valor/mês</label>
            <input type="number" step="0.01" name="amount" defaultValue="0" className="input w-32" />
          </div>
          <button className="btn">Adicionar</button>
        </form>
      </main>
    </>
  );
}
