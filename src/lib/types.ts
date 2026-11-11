export type Offer = {
  id: string;
  name: string;
  status: "rodando" | "pausada" | "encerrada";
  started_at: string | null;
  created_at: string;
};

export type DailyEntry = {
  id: string;
  offer_id: string;
  entry_date: string; // YYYY-MM-DD
  spend: number;      // gasto
  revenue: number;    // receita
};

export type FixedExpense = {
  id: string;
  name: string;
  amount: number;
  active: boolean;
};

export type Goal = {
  id: string;
  month: string; // YYYY-MM-01
  profit_target: number;
};
