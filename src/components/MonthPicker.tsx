"use client";
export function MonthPicker({ month }: { month: string }) {
  return (
    <form method="get" className="flex items-center gap-2">
      <input
        type="month"
        name="m"
        defaultValue={month}
        className="input w-44"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      <noscript><button className="btn-ghost">Ver</button></noscript>
    </form>
  );
}
