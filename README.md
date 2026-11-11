# Controle de Gastos — Direct Response

SaaS pessoal para controlar gasto, receita, lucro e ROI das ofertas de direct response,
por oferta e consolidado, com despesas fixas e meta de lucro mensal.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (Postgres) — acesso somente server-side atrás de login
- Deploy: Vercel

## Login
Tela de acesso restrito. Credenciais em variáveis de ambiente:
`APP_USER` / `APP_PASSWORD` (padrão `teste` / `teste`).

## Variáveis de ambiente (Vercel + `.env.local`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `APP_USER`
- `APP_PASSWORD`
- `AUTH_SECRET` (string aleatória longa)

## Rodar local
```bash
npm install
cp .env.local.example .env.local   # preencher
npm run dev
```

## Banco (Supabase)
Tabelas: `offers`, `daily_entries` (1 linha por oferta/dia, gasto+receita),
`fixed_expenses` (mensalidades), `goals` (meta de lucro/mês).
Lucro e ROI são calculados no app.
