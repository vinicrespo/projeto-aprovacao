"use client";
import { useState, useRef } from "react";

interface Props {
  onAuth: () => void;
}

const VALID_USER = "teste";
const VALID_PASS = "teste";

export function LoginScreen({ onAuth }: Props) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  const attempt = () => {
    if (user === VALID_USER && pass === VALID_PASS) {
      try { sessionStorage.setItem("fu_auth", "1"); } catch {}
      onAuth();
    } else {
      setError(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") attempt();
    setError(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(#4f6ef7 1px, transparent 1px), linear-gradient(90deg, #4f6ef7 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div
        className={`relative w-full max-w-sm transition-all ${shaking ? "animate-[shake_0.4s_ease]" : ""}`}
        style={shaking ? { animation: "shake 0.4s ease" } : {}}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30 mb-4">
            <span className="text-white font-bold text-2xl">F</span>
          </div>
          <h1 className="text-xl font-semibold text-white">Face Unds</h1>
          <p className="text-xs text-white/30 mt-1 font-mono">Digital Asset Standardization Engine</p>
        </div>

        {/* Card */}
        <div className="bg-white/3 border border-white/8 rounded-2xl p-6 backdrop-blur-sm">
          <h2 className="text-sm font-medium text-white/70 mb-5">Acesso restrito</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/40 block mb-1.5">Usuário</label>
              <input
                type="text"
                autoComplete="username"
                value={user}
                onChange={(e) => { setUser(e.target.value); setError(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") passRef.current?.focus(); }}
                className={`w-full px-3 py-2.5 rounded-lg text-sm bg-white/5 border text-white
                            placeholder:text-white/20 outline-none transition-colors
                            ${error ? "border-red-500/60" : "border-white/10 focus:border-brand-500"}`}
                placeholder="usuário"
              />
            </div>

            <div>
              <label className="text-xs text-white/40 block mb-1.5">Senha</label>
              <input
                ref={passRef}
                type="password"
                autoComplete="current-password"
                value={pass}
                onChange={(e) => { setPass(e.target.value); setError(false); }}
                onKeyDown={onKey}
                className={`w-full px-3 py-2.5 rounded-lg text-sm bg-white/5 border text-white
                            placeholder:text-white/20 outline-none transition-colors
                            ${error ? "border-red-500/60" : "border-white/10 focus:border-brand-500"}`}
                placeholder="••••••"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400">Credenciais inválidas.</p>
            )}

            <button
              onClick={attempt}
              className="w-full mt-1 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium
                         hover:bg-brand-600 active:scale-[0.98] transition-all"
            >
              Entrar
            </button>
          </div>
        </div>

        <p className="text-center text-[10px] text-white/15 mt-6 font-mono">
          100% client-side · GDPR compliant
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-5px); }
          80%       { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
