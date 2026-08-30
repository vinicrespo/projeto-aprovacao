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

interface VideoItem { id: string; file: File; url: string; }

function App() {
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [endCoverFile, setEndCoverFile] = useState<File | null>(null);
  const [endCoverUrl, setEndCoverUrl] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);

  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("");
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const pickCover = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("A capa deve ser uma imagem (JPG, PNG…)."); return; }
    setCoverFile(file);
    setCoverUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  }, []);

  const pickEndCover = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("A imagem final deve ser uma imagem (JPG, PNG…)."); return; }
    setEndCoverFile(file);
    setEndCoverUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  }, []);

  const clearEndCover = useCallback(() => {
    setEndCoverFile(null);
    setEndCoverUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, []);

  const addVideos = useCallback((files: File[]) => {
    const vids = files.filter((f) => f.type.startsWith("video/"));
    if (vids.length === 0) { alert("Envie vídeos (MP4, MOV…)."); return; }
    setVideos((prev) => [
      ...prev,
      ...vids.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`, file, url: URL.createObjectURL(file) })),
    ]);
  }, []);

  const removeVideo = useCallback((id: string) => {
    setVideos((prev) => {
      const v = prev.find((x) => x.id === id);
      if (v) URL.revokeObjectURL(v.url);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const canProcess = coverFile && videos.length > 0 && progress === null;

  const handleProcess = useCallback(async () => {
    if (!coverFile || videos.length === 0 || progress !== null) return;
    cancelRef.current = { cancelled: false };
    const total = videos.length;
    let failures = 0;

    for (let i = 0; i < total; i++) {
      if (cancelRef.current.cancelled) break;
      const item = videos[i];
      const prefix = total > 1 ? `Vídeo ${i + 1}/${total} · ` : "";
      setProgress(0);
      setPhase(`${prefix}Iniciando…`);
      try {
        const blob = await processCreative({
          coverFile,
          endCoverFile: endCoverFile ?? undefined,
          videoFile: item.file,
          onProgress: (r, p) => { setProgress(r); setPhase(`${prefix}${p}`); },
          cancelRef: cancelRef.current,
        });
        if (blob && !cancelRef.current.cancelled) {
          downloadBlob(blob, camouflagedFilename());
          // brief spacing so the browser accepts back-to-back downloads
          await new Promise((res) => setTimeout(res, 800));
        }
      } catch (e) {
        console.error(`Falha no vídeo ${i + 1}:`, e);
        failures++;
      }
    }

    setProgress(null);
    setPhase("");
    if (failures > 0 && !cancelRef.current.cancelled) {
      alert(`${failures} de ${total} vídeo(s) falharam. Os demais foram baixados.`);
    }
  }, [coverFile, endCoverFile, videos, progress]);

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
            <h2 className="text-lg font-semibold text-white">Processar Criativos</h2>
            <p className="text-sm text-white/40 mt-1">
              Suba a capa (CTA) e um ou mais vídeos. Cada vídeo é processado e baixado individualmente.
            </p>
          </div>

          {/* Step 1 — Cover (intro) */}
          <StepCard step={1} title="Capa inicial (abertura)" done={!!coverFile}>
            <UploadSlot
              accept="image/*"
              onFiles={pickCover}
              label={coverFile ? coverFile.name : "Clique ou arraste a imagem de abertura"}
              preview={coverUrl ? <img src={coverUrl} alt="capa" className="h-full w-full object-cover" /> : null}
              tall
            />
          </StepCard>

          {/* Step 2 — End image (optional) */}
          <StepCard step={2} title="Imagem final (opcional)" done={!!endCoverFile}>
            <p className="text-[11px] text-white/35 mb-3">
              Imagem que fica nos 5 minutos após o vídeo. Se não enviar, usa a capa inicial.
            </p>
            <UploadSlot
              accept="image/*"
              onFiles={pickEndCover}
              label={endCoverFile ? endCoverFile.name : "Clique ou arraste a imagem final (opcional)"}
              preview={endCoverUrl ? <img src={endCoverUrl} alt="imagem final" className="h-full w-full object-cover" /> : null}
              tall
            />
            {endCoverFile && (
              <button onClick={clearEndCover} disabled={progress !== null}
                className="mt-2 text-[11px] text-white/40 hover:text-red-400 disabled:opacity-30">
                Remover imagem final (usar a capa inicial)
              </button>
            )}
          </StepCard>

          {/* Step 3 — Videos (multiple) */}
          <StepCard step={3} title={`Vídeos${videos.length ? ` (${videos.length})` : ""}`} done={videos.length > 0}>
            <div className="flex flex-col gap-3">
              <UploadSlot
                accept="video/*"
                multiple
                onFiles={addVideos}
                label={videos.length ? "Adicionar mais vídeos" : "Clique ou arraste um ou mais vídeos"}
                preview={null}
              />
              {videos.length > 0 && (
                <div className="flex flex-col gap-2">
                  {videos.map((v, i) => (
                    <div key={v.id} className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/8 p-2">
                      <video src={v.url} muted className="w-14 h-14 rounded object-cover bg-black" />
                      <span className="flex-1 text-xs text-white/70 truncate">{i + 1}. {v.file.name}</span>
                      <button
                        onClick={() => removeVideo(v.id)}
                        disabled={progress !== null}
                        className="text-white/30 hover:text-red-400 disabled:opacity-30 text-lg px-2 leading-none"
                        title="Remover"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
            {videos.length > 1 ? `Processar ${videos.length} vídeos` : "Processar"}
          </button>

          <p className="text-center text-[11px] text-white/25">
            Abertura 1s · vídeo com efeitos · capa segurada por 5 min no final · exporta MP4
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

function UploadSlot({ accept, onFiles, label, preview, tall, multiple }: {
  accept: string; onFiles: (f: File[]) => void; label: string; preview: React.ReactNode; tall?: boolean; multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const fs = Array.from(e.dataTransfer.files); if (fs.length) onFiles(fs); }}
      className={`relative rounded-xl border-2 border-dashed cursor-pointer overflow-hidden
        transition-all ${tall ? "h-44" : "h-28"}
        ${drag ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-white/3 hover:border-white/25"}`}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = ""; }} />
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
