"use client";
import { deleteOffer } from "@/lib/actions";

export function DeleteOfferButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteOffer}
      onSubmit={(e) => {
        if (!confirm(`Excluir a oferta "${name}" e todos os lançamentos dela? Isso não pode ser desfeito.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="btn-ghost text-neg border-neg/40 hover:border-neg">Excluir oferta</button>
    </form>
  );
}
