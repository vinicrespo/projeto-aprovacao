"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { ExportModal } from "@/components/ExportModal";
import { downloadBlob } from "@/lib/exporter";
import { camouflagedFilename } from "@/lib/hashBuster";
import { processCreative } from "@/lib/creativeProcessor";
import { protectVideoAudio, previewProtectedAudio } from "@/lib/audioProtect";

export default function DashboardPage() {
  // Auth is read after mount so server and first client render match (avoids
  // a hydration mismatch for already-logged-in users).
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setAuthed(sessionStorage.getItem("fu_auth") === "1"); } catch { /* ignore */ }
    setReady(true);
  }, []);
  if (!ready) return <div className="min-h-screen bg-surface-950" />;
  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;
  return <App />;
}

interface VideoItem { id: string; file: File; url: string; }
type Tab = "criativo" | "audio";

function App() {
  const [tab, setTab] = useState<Tab>("criativo");
  return (
    <div className="min-h-screen flex flex-col">
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

      {/* Tab bar */}
      <div className="border-b border-white/5 px-6 flex gap-1">
        <TabButton active={tab === "criativo"} onClick={() => setTab("criativo")} label="Criativo" />
        <TabButton active={tab === "audio"} onClick={() => setTab("audio")} label="Proteção de Áudio" />
      </div>

      {tab === "criativo" ? <CreativeTab /> : <AudioProtectTab />}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-brand-500 text-white" : "border-transparent text-white/40 hover:text-white/70"
      }`}
    >
      {label}
    </button>
  );
}

// ── Tab 1: Criativo (cover + video + 5-min tail) ─────────────────────────────
function CreativeTab() {
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
    <main className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
      {progress !== null && <ExportModal progress={progress} done={false} onCancel={cancel} phaseLabel={phase} />}
      <div className="w-full max-w-2xl flex flex-col gap-6 mt-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">Processar Criativos</h2>
          <p className="text-sm text-white/40 mt-1">
            Suba a capa (CTA) e um ou mais vídeos. Cada vídeo é processado e baixado individualmente.
          </p>
        </div>

        <StepCard step={1} title="Capa inicial (abertura)" done={!!coverFile}>
          <UploadSlot accept="image/*" onFiles={pickCover}
            label={coverFile ? coverFile.name : "Clique ou arraste a imagem de abertura"}
            preview={coverUrl ? <img src={coverUrl} alt="capa" className="h-full w-full object-cover" /> : null} tall />
        </StepCard>

        <StepCard step={2} title="Imagem final (opcional)" done={!!endCoverFile}>
          <p className="text-[11px] text-white/35 mb-3">
            Imagem que fica nos 5 minutos após o vídeo. Se não enviar, usa a capa inicial.
          </p>
          <UploadSlot accept="image/*" onFiles={pickEndCover}
            label={endCoverFile ? endCoverFile.name : "Clique ou arraste a imagem final (opcional)"}
            preview={endCoverUrl ? <img src={endCoverUrl} alt="imagem final" className="h-full w-full object-cover" /> : null} tall />
          {endCoverFile && (
            <button onClick={clearEndCover} disabled={progress !== null}
              className="mt-2 text-[11px] text-white/40 hover:text-red-400 disabled:opacity-30">
              Remover imagem final (usar a capa inicial)
            </button>
          )}
        </StepCard>

        <StepCard step={3} title={`Vídeos${videos.length ? ` (${videos.length})` : ""}`} done={videos.length > 0}>
          <VideoList videos={videos} onAdd={addVideos} onRemove={removeVideo} disabled={progress !== null} />
        </StepCard>

        <button onClick={handleProcess} disabled={!canProcess}
          className="w-full py-4 rounded-xl bg-brand-500 text-white font-semibold text-base
                     hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          {videos.length > 1 ? `Processar ${videos.length} vídeos` : "Processar"}
        </button>

        <p className="text-center text-[11px] text-white/25">
          Abertura 1s · vídeo com efeitos · capa segurada por 5 min no final · exporta MP4
        </p>
      </div>
    </main>
  );
}

// ── Tab 2: Proteção de Áudio (anti-transcription) ────────────────────────────
function AudioProtectTab() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("");
  const [intensity, setIntensity] = useState(60);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const runPreview = useCallback(async () => {
    if (videos.length === 0 || previewing) return;
    setPreviewing(true);
    try {
      const blob = await previewProtectedAudio(videos[0].file, intensity, 12);
      if (!blob) { alert("Este vídeo não tem áudio para pré-visualizar."); return; }
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    } catch (e) {
      console.error("Preview falhou:", e);
      alert("Não foi possível gerar o preview.");
    } finally {
      setPreviewing(false);
    }
  }, [videos, intensity, previewing]);

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

  const canProcess = videos.length > 0 && progress === null;

  const handleProtect = useCallback(async () => {
    if (videos.length === 0 || progress !== null) return;
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
        const blob = await protectVideoAudio({
          videoFile: item.file,
          intensity,
          onProgress: (r, p) => { setProgress(r); setPhase(`${prefix}${p}`); },
          cancelRef: cancelRef.current,
        });
        if (blob && !cancelRef.current.cancelled) {
          downloadBlob(blob, camouflagedFilename());
          await new Promise((res) => setTimeout(res, 800));
        }
      } catch (e) {
        console.error(`Falha no vídeo ${i + 1}:`, e);
        failures++;
        if (total === 1) {
          const msg = e instanceof Error && e.message ? e.message : "Falha ao proteger o áudio.";
          alert(msg);
        }
      }
    }
    setProgress(null);
    setPhase("");
    if (failures > 0 && total > 1 && !cancelRef.current.cancelled) {
      alert(`${failures} de ${total} vídeo(s) falharam. Os demais foram baixados.`);
    }
  }, [videos, progress, intensity]);

  const cancel = useCallback(() => { cancelRef.current.cancelled = true; setProgress(null); }, []);

  return (
    <main className="flex-1 flex items-start justify-center p-6 overflow-y-auto">
      {progress !== null && <ExportModal progress={progress} done={false} onCancel={cancel} phaseLabel={phase} />}
      <div className="w-full max-w-2xl flex flex-col gap-6 mt-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">Proteção de Áudio</h2>
          <p className="text-sm text-white/40 mt-1">
            Blindagem anti-transcrição extremamente agressiva. O vídeo é mantido; o áudio permanece
            audível para humanos, mas a transcrição automática (robôs) sai embaralhada.
          </p>
        </div>

        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-[11px] text-amber-300/80 leading-relaxed">
            ⚠️ Modo agressivo: o áudio soa "processado" (camadas concorrentes, warble e reverb).
            Degrada fortemente transcritores automáticos, mas não força um texto específico — a eficácia
            varia por sistema.
          </p>
        </div>

        <StepCard step={1} title={`Vídeos${videos.length ? ` (${videos.length})` : ""}`} done={videos.length > 0}>
          <VideoList videos={videos} onAdd={addVideos} onRemove={removeVideo} disabled={progress !== null} />
        </StepCard>

        {/* Intensity + preview */}
        <StepCard step={2} title="Intensidade da blindagem" done={false}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/70">
              {intensity === 0 ? "Sem proteção" : intensity < 35 ? "Leve" : intensity < 70 ? "Média" : "Forte"}
            </span>
            <span className="text-sm font-mono text-brand-400">{intensity}</span>
          </div>
          <input
            type="range" min={0} max={100} step={1} value={intensity}
            onChange={(e) => setIntensity(parseInt(e.target.value))}
            disabled={progress !== null}
            className="w-full accent-brand-500 cursor-pointer disabled:opacity-40"
          />
          <div className="flex justify-between text-[10px] text-white/25 mt-1">
            <span>0 (limpo)</span><span>50</span><span>100 (máximo)</span>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={runPreview}
              disabled={videos.length === 0 || progress !== null || previewing}
              className="w-full py-2.5 rounded-lg bg-white/10 text-white/80 text-sm font-medium
                         hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                         flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15.536 8.464a5 5 0 010 7.072M12 6.253v11.494m0 0L9 15m3 2.747L15 15M6.5 8.5a5 5 0 000 7" />
              </svg>
              {previewing ? "Gerando preview…" : "Ouvir preview (12s do 1º vídeo)"}
            </button>
            {previewUrl && (
              <audio src={previewUrl} controls autoPlay className="w-full mt-1" />
            )}
            <p className="text-[10px] text-white/25 text-center">
              Só o áudio muda — o vídeo é mantido. Ajuste o slider e ouça de novo.
            </p>
          </div>
        </StepCard>

        <button onClick={handleProtect} disabled={!canProcess}
          className="w-full py-4 rounded-xl bg-brand-500 text-white font-semibold text-base
                     hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          {videos.length > 1 ? `Blindar ${videos.length} vídeos` : "Blindar áudio"}
        </button>

        <p className="text-center text-[11px] text-white/25">
          Só áudio · vídeo mantido · exporta MP4 · metadados limpos
        </p>
      </div>
    </main>
  );
}

// ── Shared UI ────────────────────────────────────────────────────────────────
function VideoList({ videos, onAdd, onRemove, disabled }: {
  videos: VideoItem[]; onAdd: (f: File[]) => void; onRemove: (id: string) => void; disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <UploadSlot accept="video/*" multiple onFiles={onAdd}
        label={videos.length ? "Adicionar mais vídeos" : "Clique ou arraste um ou mais vídeos"} preview={null} />
      {videos.length > 0 && (
        <div className="flex flex-col gap-2">
          {videos.map((v, i) => (
            <div key={v.id} className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/8 p-2">
              <video src={v.url} muted className="w-14 h-14 rounded object-cover bg-black" />
              <span className="flex-1 text-xs text-white/70 truncate">{i + 1}. {v.file.name}</span>
              <button onClick={() => onRemove(v.id)} disabled={disabled}
                className="text-white/30 hover:text-red-400 disabled:opacity-30 text-lg px-2 leading-none" title="Remover">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
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
