"use client";
import { saveExpenseRow, toggleExpenseMonth, deleteFixedExpense } from "@/lib/actions";
import type { EffectiveExpense } from "@/lib/data";

export function DespesaRow({ e, month }: { e: EffectiveExpense; month: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 border-b border-line/50">
      {/* editar nome + valor (valor é do mês selecionado) */}
      <form action={saveExpenseRow} className="flex items-center gap-2 flex-1 min-w-[260px]">
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="month" value={month} />
        <input name="name" defaultValue={e.name} className="input !w-auto flex-1" />
        <input type="number" step="0.01" name="amount" defaultValue={Number(e.amount)} className="input !w-28 shrink-0" />
        <button className="btn-ghost text-xs">Salvar</button>
      </form>

      {/* toggle ativo deste mês (salva na hora) */}
      <form action={toggleExpenseMonth}>
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="next" value={e.active ? "false" : "true"} />
        <button
          type="submit"
          className={`relative w-12 h-6 rounded-full transition ${e.active ? "bg-pos" : "bg-line"}`}
          title={e.active ? "Ativo neste mês — clique para desativar" : "Inativo neste mês — clique para ativar"}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${e.active ? "left-6" : "left-0.5"}`} />
        </button>
      </form>
      <span className={`text-xs w-16 ${e.active ? "text-pos" : "text-mut"}`}>{e.active ? "ativo" : "inativo"}</span>

      <form action={deleteFixedExpense}>
        <input type="hidden" name="id" value={e.id} />
        <button className="text-mut hover:text-neg text-xs" title="Remove a ferramenta de todos os meses">excluir</button>
      </form>
    </div>
  );
}
