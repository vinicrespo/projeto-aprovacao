"use client";
import { useCallback, useRef, useState } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { ExportModal } from "@/components/ExportModal";
import { downloadBlob } from "@/lib/exporter";
import { camouflagedFilename } from "@/lib/hashBuster";
import { processCreative } from "@/lib/creativeProcessor";

export default function DashboardPage() {
  const [authed, setAuthed] = useState(() => {
    try { return sessionStorage.getItem("fu_auth") === "1"; } catch { return false; }
  });
  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;
  return <App />;
}

function App() {
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("");
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const pickCover = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) { alert("A capa deve ser uma imagem (JPG, PNG…)."); return; }
    setCoverFile(file);
    setCoverUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  }, []);

  const pickVideo = useCallback((file: File) => {
    if (!file.type.startsWith("video/")) { alert("Envie um vídeo (MP4, MOV…)."); return; }
    setVideoFile(file);
    setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  }, []);

  const canProcess = coverFile && videoFile && progress === null;

  const handleProcess = useCallback(async () => {
    if (!coverFile || !videoFile || progress !== null) return;
    cancelRef.current = { cancelled: false };
    setProgress(0);
    setPhase("Iniciando…");
    try {
      const blob = await processCreative({
        coverFile,
        videoFile,
        onProgress: (r, p) => { setProgress(r); setPhase(p); },
        cancelRef: cancelRef.current,
      });
      if (blob && !cancelRef.current.cancelled) {
        setProgress(null);
        downloadBlob(blob, camouflagedFilename());
      } else {
        setProgress(null);
        if (!blob) alert("Use o Chrome no desktop para processar (WebCodecs necessário).");
      }
    } catch (e) {
      console.error("Process failed:", e);
      setProgress(null);
      alert("Falha ao processar o criativo. Verifique os arquivos e tente novamente.");
    }
  }, [coverFile, videoFile, progress]);

  const cancel = useCallback(() => { cancelRef.current.cancelled = true; setProgress(null); }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {progress !== null && (
        <ExportModal progress={progress} done={false} onCancel={cancel} phaseLabel={phase} />
      )}

      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">F</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Face Unds</h1>
            <p className="text-[10px] text-white/30 font-mono">Digital Asset Standardization Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-mono">● 100% Client-Side</span>
          <span className="text-[10px] px-2 py-1 rounded-full bg-white/5 text-white/30 font-mono">GDPR Compliant</span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-2xl flex flex-col gap-6 mt-4">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white">Processar Criativo</h2>
            <p className="text-sm text-white/40 mt-1">
              Suba a capa (CTA) e o vídeo. A capa entra na abertura e fica 5 minutos no final.
            </p>
          </div>

          {/* Step 1 — Cover */}
          <StepCard step={1} title="Capa (CTA)" done={!!coverFile}>
            <UploadSlot
              accept="image/*"
              onFile={pickCover}
              label={coverFile ? coverFile.name : "Clique ou arraste a imagem de capa"}
              preview={coverUrl ? <img src={coverUrl} alt="capa" className="h-full w-full object-cover" /> : null}
              tall
            />
          </StepCard>

          {/* Step 2 — Video */}
          <StepCard step={2} title="Vídeo" done={!!videoFile}>
            <UploadSlot
              accept="video/*"
              onFile={pickVideo}
              label={videoFile ? videoFile.name : "Clique ou arraste o vídeo"}
              preview={videoUrl ? <video src={videoUrl} muted loop autoPlay playsInline className="h-full w-full object-cover" /> : null}
              tall
            />
          </StepCard>

          {/* Step 3 — Process */}
          <button
            onClick={handleProcess}
            disabled={!canProcess}
            className="w-full py-4 rounded-xl bg-brand-500 text-white font-semibold text-base
                       hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Processar
          </button>

          <p className="text-center text-[11px] text-white/25">
            Abertura ~2s · vídeo com efeitos · capa segurada por 5 min no final · exporta MP4
          </p>
        </div>
      </main>
    </div>
  );
}

function StepCard({ step, title, done, children }: {
  step: number; title: string; done: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/3 border border-white/8 p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
          ${done ? "bg-emerald-500 text-white" : "bg-white/10 text-white/50"}`}>
          {done ? "✓" : step}
        </div>
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function UploadSlot({ accept, onFile, label, preview, tall }: {
  accept: string; onFile: (f: File) => void; label: string; preview: React.ReactNode; tall?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={`relative rounded-xl border-2 border-dashed cursor-pointer overflow-hidden
        transition-all ${tall ? "h-44" : "h-28"}
        ${drag ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-white/3 hover:border-white/25"}`}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {preview ? (
        <>
          <div className="absolute inset-0">{preview}</div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-2 left-3 right-3 text-xs text-white/80 truncate">{label}</div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span className="text-xs">{label}</span>
        </div>
      )}
    </div>
  );
}
