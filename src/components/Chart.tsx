"use client";
import { brl } from "@/lib/format";

type Row = { date: string; spend: number; revenue: number; profit: number };

export function BarChart({ data }: { data: Row[] }) {
  if (!data.length) return <p className="text-mut text-sm">Sem lançamentos ainda.</p>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.spend, d.revenue)));
  return (
    <div className="flex items-end gap-2 h-48 overflow-x-auto pb-6 pt-2">
      {data.map((d) => (
        <div key={d.date} className="flex flex-col items-center gap-1 min-w-[34px] group relative">
          <div className="flex items-end gap-0.5 h-40">
            <div
              className="w-3 bg-neg/70 rounded-t"
              style={{ height: `${(d.spend / max) * 100}%` }}
              title={`Gasto ${brl(d.spend)}`}
            />
            <div
              className="w-3 bg-pos/70 rounded-t"
              style={{ height: `${(d.revenue / max) * 100}%` }}
              title={`Receita ${brl(d.revenue)}`}
            />
          </div>
          <span className="text-[10px] text-mut">{d.date.slice(8, 10)}</span>
          <div className="absolute -top-14 hidden group-hover:block bg-panel2 border border-line rounded-lg p-2 text-[11px] whitespace-nowrap z-10">
            <div>Gasto: {brl(d.spend)}</div>
            <div>Receita: {brl(d.revenue)}</div>
            <div className={d.profit >= 0 ? "text-pos" : "text-neg"}>Lucro: {brl(d.profit)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
