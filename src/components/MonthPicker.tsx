"use client";
import { setSelectedMonth } from "@/lib/actions";

export function MonthPicker({ month, path }: { month: string; path: string }) {
  return (
    <form action={setSelectedMonth} className="flex items-center gap-2">
      <input type="hidden" name="path" value={path} />
      <input
        type="month"
        name="m"
        defaultValue={month}
        className="input !w-44"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      <noscript><button className="btn-ghost">Ver</button></noscript>
    </form>
  );
}
