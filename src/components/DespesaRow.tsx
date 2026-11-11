"use client";
import { useRef } from "react";
import { saveFixedExpense, toggleFixedExpense, deleteFixedExpense } from "@/lib/actions";
import type { FixedExpense } from "@/lib/types";
import { brl } from "@/lib/format";

export function DespesaRow({ e }: { e: FixedExpense }) {
  const toggleRef = useRef<HTMLFormElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 border-b border-line/50">
      {/* editar nome + valor */}
      <form action={saveFixedExpense} className="flex items-center gap-2 flex-1 min-w-[260px]">
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="active" value={e.active ? "true" : "false"} />
        <input name="name" defaultValue={e.name} className="input flex-1" />
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-mut text-xs">R$</span>
          <input type="number" step="0.01" name="amount" defaultValue={Number(e.amount)} className="input w-28 pl-8" />
        </div>
        <button className="btn-ghost text-xs">Salvar</button>
      </form>

      {/* toggle ativo (salva na hora) */}
      <form action={toggleFixedExpense} ref={toggleRef}>
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="next" value={e.active ? "false" : "true"} />
        <button
          type="submit"
          className={`relative w-12 h-6 rounded-full transition ${e.active ? "bg-pos" : "bg-line"}`}
          title={e.active ? "Ativo — clique para desativar" : "Inativo — clique para ativar"}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${e.active ? "left-6" : "left-0.5"}`}
          />
        </button>
      </form>
      <span className={`text-xs w-16 ${e.active ? "text-pos" : "text-mut"}`}>{e.active ? "ativo" : "inativo"}</span>

      <form action={deleteFixedExpense}>
        <input type="hidden" name="id" value={e.id} />
        <button className="text-mut hover:text-neg text-xs">excluir</button>
      </form>
    </div>
  );
}
