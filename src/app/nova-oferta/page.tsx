import { Shell } from "@/components/Shell";
import { createOfferAndOpen } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default function NovaOferta({ searchParams }: { searchParams: { e?: string } }) {
  return (
    <Shell>
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="card space-y-5">
          <div className="text-center">
            <div className="text-4xl mb-2">🚀</div>
            <h1 className="text-xl font-semibold">Criar nova oferta</h1>
            <p className="text-mut text-sm mt-1">
              Dê um nome. Ela aparece na barra lateral e entra no consolidado automaticamente.
            </p>
          </div>
          {searchParams?.e && <p className="text-neg text-sm text-center">Digite um nome para a oferta.</p>}
          <form action={createOfferAndOpen} className="space-y-3">
            <div>
              <label className="label">Nome da oferta</label>
              <input name="name" placeholder="Ex: NeuroMax" className="input text-center text-lg" autoFocus required />
            </div>
            <button className="btn w-full">Criar oferta</button>
          </form>
        </div>
      </div>
    </Shell>
  );
}
