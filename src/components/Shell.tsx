import Link from "next/link";
import { logout } from "@/lib/actions";
import { getOffers } from "@/lib/data";

export async function Shell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string; // "consolidado" | "despesas" | offerId
}) {
  const offers = await getOffers();
  const isActive = (k: string) =>
    active === k
      ? "bg-panel2 text-txt border-brand"
      : "text-mut hover:text-txt hover:bg-panel2/50 border-transparent";

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-line bg-panel/40 flex flex-col">
        <div className="px-4 py-4 font-semibold border-b border-line">📊 Controle DR</div>
        <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
          <Link href="/" className={`block px-3 py-2 rounded-lg border ${isActive("consolidado")}`}>
            🧮 Consolidado Geral
          </Link>

          <div className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-mut">Ofertas</div>
          {offers.map((o) => (
            <Link
              key={o.id}
              href={`/ofertas/${o.id}`}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border ${isActive(o.id)}`}
            >
              <span className="truncate">{o.name}</span>
              <span className={`text-[10px] ${o.status === "rodando" ? "text-pos" : "text-mut"}`}>
                {o.status === "rodando" ? "●" : "○"}
              </span>
            </Link>
          ))}
          <Link
            href="/nova-oferta"
            className="block px-3 py-2 rounded-lg border border-dashed border-line text-mut hover:text-txt hover:border-brand"
          >
            + Nova oferta
          </Link>

          <div className="pt-4">
            <Link href="/despesas" className={`block px-3 py-2 rounded-lg border ${isActive("despesas")}`}>
              💳 Despesas fixas
            </Link>
          </div>
        </nav>
        <form action={logout} className="p-2 border-t border-line">
          <button className="btn-ghost w-full text-sm">Sair</button>
        </form>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
