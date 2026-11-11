import { login } from "@/lib/actions";

export default function LoginPage({ searchParams }: { searchParams: { e?: string } }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form action={login} className="card w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Controle de Gastos</h1>
          <p className="text-mut text-sm">Direct Response — acesso restrito</p>
        </div>
        {searchParams?.e && (
          <p className="text-neg text-sm">Usuário ou senha inválidos.</p>
        )}
        <div>
          <label className="label">Usuário</label>
          <input name="user" className="input" autoComplete="username" autoFocus />
        </div>
        <div>
          <label className="label">Senha</label>
          <input name="pass" type="password" className="input" autoComplete="current-password" />
        </div>
        <button className="btn w-full" type="submit">Entrar</button>
      </form>
    </main>
  );
}
