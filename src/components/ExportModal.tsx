"use client";

interface Props {
  progress: number;
  done: boolean;
  onCancel: () => void;
}

export function ExportModal({ progress, done, onCancel }: Props) {
  const pct = Math.round(progress * 100);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-surface-900 border border-white/10 rounded-2xl p-8 w-72 flex flex-col items-center gap-4 shadow-2xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white">Download concluído</p>
            <p className="text-xs text-white/40 mt-1">Fechar automaticamente…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-surface-900 border border-white/10 rounded-2xl p-8 w-80 flex flex-col items-center gap-5 shadow-2xl">
        {/* Circular progress */}
        <div className="relative w-16 h-16">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="#4f6ef7"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - progress)}`}
              className="transition-all duration-300"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-mono text-white/80">
            {pct}%
          </span>
        </div>

        <div className="text-center">
          <p className="text-sm font-medium text-white">
            {pct < 20 ? "Processando áudio…" : pct < 90 ? "Renderizando frames…" : "Finalizando MP4…"}
          </p>
          <p className="text-xs text-white/35 mt-1">Aplicando correções e randomizando hash</p>
        </div>

        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <button
          onClick={onCancel}
          className="text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
