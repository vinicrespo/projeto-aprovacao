import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Controle de Gastos — Direct Response",
  description: "Controle de gastos, receita e ROI por oferta",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
