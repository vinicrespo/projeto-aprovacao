import Link from "next/link";
import { logout } from "@/lib/actions";
import { brl } from "@/lib/format";

export function Nav() {
  return (
    <header className="border-b border-line bg-panel/60 sticky top-0 z-10 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold">📊 Controle DR</Link>
        <nav className="flex gap-4 text-sm text-mut">
          <Link href="/" className="hover:text-txt">Consolidado</Link>
          <Link href="/despesas" className="hover:text-txt">Despesas fixas</Link>
        </nav>
        <form action={logout} className="ml-auto">
          <button className="btn-ghost text-sm">Sair</button>
        </form>
      </div>
    </header>
  );
}

export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "neutral";
  sub?: string;
}) {
  const color = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-txt";
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-mut text-xs mt-1">{sub}</div>}
    </div>
  );
}

export function money(n: number) {
  return brl(n);
}
