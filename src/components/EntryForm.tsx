"use client";
import { useState } from "react";
import { saveEntry } from "@/lib/actions";
import { todayISO } from "@/lib/format";

export function EntryForm({ offerId }: { offerId: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + Lançar dia
      </button>
    );
  return (
    <form action={saveEntry} className="card flex flex-wrap items-end gap-3">
      <input type="hidden" name="offer_id" value={offerId} />
      <div>
        <label className="label">Data</label>
        <input type="date" name="entry_date" defaultValue={todayISO()} className="input" required />
      </div>
      <div>
        <label className="label">Gasto (R$)</label>
        <input type="number" step="0.01" name="spend" defaultValue="0" className="input w-32" />
      </div>
      <div>
        <label className="label">Receita (R$)</label>
        <input type="number" step="0.01" name="revenue" defaultValue="0" className="input w-32" />
      </div>
      <button className="btn" type="submit">Salvar</button>
      <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      <p className="text-mut text-xs w-full">Se já existir lançamento nesse dia para a oferta, ele é atualizado.</p>
    </form>
  );
}
