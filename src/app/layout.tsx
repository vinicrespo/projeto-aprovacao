import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Face Unds — Digital Asset Standardization Engine",
  description: "Privacy-first, client-side visual & audio standardization for marketing teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-surface-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
