"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoginScreen } from "@/components/LoginScreen";
import { ExportModal } from "@/components/ExportModal";
import { downloadBlob } from "@/lib/exporter";
import { processCreative, previewCreativeVideo } from "@/lib/creativeProcessor";
import { previewProtectedAudio } from "@/lib/audioProtect";

export default function DashboardPage() {
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
interface ResultItem { id: string; name: string; url: string; size: number; }

function protectedName(original: string, used: Set<string>): string {
  const base = original.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_") || "video";
  let name = `${base}_protected.mp4`;
  let i = 2;
  while (used.has(name)) name = `${base}_protected_${i++}.mp4`;
  used.add(name);
  return name;
}

function App() {
  // Assets
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [endCoverFile, setEndCoverFile] = useState<File | null>(null);
  const [endCoverUrl, setEndCoverUrl] = useState<string | null>(null);
  const [tailMinutes, setTailMinutes] = useState(5);
  const [videos, setVideos] = useState<VideoItem[]>([]);

  // Visual protection
  const [protectionLevel, setProtectionLevel] = useState(100);
  const [tvLines, setTvLines] = useState(0);
  const [vPreviewUrl, setVPreviewUrl] = useState<string | null>(null);
  const [vPreviewing, setVPreviewing] = useState(false);

  // Audio protection
  const [audioOn, setAudioOn] = useState(false);
  const [aIntensity, setAIntensity] = useState(60);
  const [decoyFile, setDecoyFile] = useState<File | null>(null);
  const [decoyGain, setDecoyGain] = useState(75);
  const [stereoCancel, setStereoCancel] = useState(0);
  const [noise, setNoise] = useState(0);
  const [aPreviewUrl, setAPreviewUrl] = useState<string | null>(null);
  const [aPreviewing, setAPreviewing] = useState(false);

  // Run state
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // ── Uploads ──
  const pickCover = useCallback((files: File[]) => {
    const file = files[0]; if (!file) return;
    if (!file.type.startsWith("image/")) { alert("A capa deve ser uma imagem (JPG, PNG…)."); return; }
    setCoverFile(file);
    setCoverUrl((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(file); });
  }, []);
  const pickEndCover = useCallback((files: File[]) => {
    const file = files[0]; if (!file) return;
    if (!file.type.startsWith("image/")) { alert("A imagem final deve ser uma imagem."); return; }
    setEndCoverFile(file);
    setEndCoverUrl((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(file); });
  }, []);
  const clearEndCover = useCallback(() => {
    setEndCoverFile(null);
    setEndCoverUrl((p) => { if (p) URL.revokeObjectURL(p); return null; });
  }, []);
  const pickDecoy = useCallback((files: File[]) => {
    const file = files[0]; if (!file) return;
    if (!file.type.startsWith("audio/")) { alert("O áudio isca deve ser um arquivo de áudio (MP3, WAV…)."); return; }
    setDecoyFile(file);
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
    setVideos((prev) => { const v = prev.find((x) => x.id === id); if (v) URL.revokeObjectURL(v.url); return prev.filter((x) => x.id !== id); });
  }, []);

  // ── Previews ──
  const runVideoPreview = useCallback(async () => {
    if (videos.length === 0 || vPreviewing || progress !== null) return;
    setVPreviewing(true);
    try {
      const blob = await previewCreativeVideo(videos[0].file, protectionLevel, 5, tvLines);
      if (!blob) { alert("Não foi possível gerar o preview (use o Chrome no desktop)."); return; }
      setVPreviewUrl((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(blob); });
    } catch (e) { console.error(e); alert("Falha ao gerar o preview."); }
    finally { setVPreviewing(false); }
  }, [videos, protectionLevel, tvLines, vPreviewing, progress]);

  const runAudioPreview = useCallback(async () => {
    if (videos.length === 0 || aPreviewing || progress !== null) return;
    setAPreviewing(true);
    try {
      const blob = await previewProtectedAudio(videos[0].file, aIntensity, 12, decoyFile, decoyGain, stereoCancel, noise);
      if (!blob) { alert("Este vídeo não tem áudio para pré-visualizar."); return; }
      setAPreviewUrl((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(blob); });
    } catch (e) { console.error(e); alert("Falha ao gerar o preview de áudio."); }
    finally { setAPreviewing(false); }
  }, [videos, aIntensity, decoyFile, decoyGain, stereoCancel, noise, aPreviewing, progress]);

  const canProcess = coverFile && videos.length > 0 && progress === null;

  // ── Batch process → save directly to a chosen folder ──
  const handleProcess = useCallback(async () => {
    if (!coverFile || videos.length === 0 || progress !== null) return;

    // Clear any previous batch's results (release their object URLs)
    setResults((prev) => { prev.forEach((r) => URL.revokeObjectURL(r.url)); return []; });

    cancelRef.current = { cancelled: false };
    const total = videos.length;
    const used = new Set<string>();
    let failures = 0;

    for (let i = 0; i < total; i++) {
      if (cancelRef.current.cancelled) break;
      const item = videos[i];
      const prefix = `Vídeo ${i + 1}/${total} · `;
      setProgress(0);
      setPhase(`${prefix}Iniciando…`);
      try {
        const blob = await processCreative({
          coverFile,
          endCoverFile: endCoverFile ?? undefined,
          outroSeconds: Math.round(tailMinutes * 60),
          protectionLevel,
          tvLines,
          audioProtection: audioOn ? { enabled: true, intensity: aIntensity, decoyFile, decoyGain, stereoCancel, noise } : undefined,
          videoFile: item.file,
          onProgress: (r, p) => { setProgress(r); setPhase(`${prefix}${p}`); },
          cancelRef: cancelRef.current,
        });
        if (blob && !cancelRef.current.cancelled) {
          const name = protectedName(item.file.name, used);
          // Keep the finished file in the "Processados" list to download later
          const url = URL.createObjectURL(blob);
          setResults((prev) => [...prev, { id: item.id, name, url, size: blob.size }]);
        }
      } catch (e) { console.error(`Falha no vídeo ${i + 1}:`, e); failures++; }
    }

    setProgress(null);
    setPhase("");
    if (!cancelRef.current.cancelled && failures > 0) {
      alert(`${failures} de ${total} vídeo(s) falharam. Os demais estão em "Processados".`);
    }
  }, [coverFile, endCoverFile, tailMinutes, protectionLevel, tvLines, audioOn, aIntensity, decoyFile, decoyGain, stereoCancel, noise, videos, progress]);

  const cancel = useCallback(() => { cancelRef.current.cancelled = true; setProgress(null); }, []);

  const downloadAll = useCallback(async () => {
    for (const r of results) {
      downloadBlob(await fetch(r.url).then((x) => x.blob()), r.name);
      await new Promise((res) => setTimeout(res, 500));
    }
  }, [results]);

  const levelLabel = (v: number) => v === 0 ? "Desligada" : v < 35 ? "Leve" : v < 70 ? "Média" : "Forte";

  return (
    <div className="min-h-screen flex flex-col">
      {progress !== null && <ExportModal progress={progress} done={false} onCancel={cancel} phaseLabel={phase} />}

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
              Suba a capa e os vídeos. Escolha proteção visual, de áudio, ou as duas. Cada arquivo é
              salvo como <span className="text-white/60">nome_protected.mp4</span> na pasta que você escolher.
            </p>
          </div>

          <StepCard step={1} title="Capa inicial (abertura)" done={!!coverFile}>
            <UploadSlot accept="image/*" onFiles={pickCover}
              label={coverFile ? coverFile.name : "Clique ou arraste a imagem de abertura"}
              preview={coverUrl ? <img src={coverUrl} alt="capa" className="h-full w-full object-cover" /> : null} tall />
          </StepCard>

          <StepCard step={2} title="Imagem final (opcional)" done={!!endCoverFile}>
            <p className="text-[11px] text-white/35 mb-3">Fica nos 5 minutos após o vídeo. Sem ela, usa a capa inicial.</p>
            <UploadSlot accept="image/*" onFiles={pickEndCover}
              label={endCoverFile ? endCoverFile.name : "Clique ou arraste a imagem final (opcional)"}
              preview={endCoverUrl ? <img src={endCoverUrl} alt="final" className="h-full w-full object-cover" /> : null} tall />
            {endCoverFile && (
              <button onClick={clearEndCover} disabled={progress !== null} className="mt-2 text-[11px] text-white/40 hover:text-red-400 disabled:opacity-30">
                Remover imagem final
              </button>
            )}

            <div className="mt-5 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white/70">Duração da capa no final</span>
                <span className="text-sm font-mono text-brand-400">
                  {tailMinutes === 0 ? "sem capa" : `${tailMinutes} min`}
                </span>
              </div>
              <input type="range" min={0} max={15} step={1} value={tailMinutes}
                onChange={(e) => setTailMinutes(parseInt(e.target.value))}
                disabled={progress !== null}
                className="w-full accent-brand-500 cursor-pointer disabled:opacity-40" />
              <div className="flex justify-between text-[10px] text-white/25 mt-1"><span>0</span><span>5</span><span>15 min</span></div>
              <p className="text-[10px] text-white/25 mt-1">Quanto tempo a imagem fica parada depois que o vídeo acaba.</p>
            </div>
          </StepCard>

          <StepCard step={3} title={`Vídeos${videos.length ? ` (${videos.length})` : ""}`} done={videos.length > 0}>
            <VideoList videos={videos} onAdd={addVideos} onRemove={removeVideo} disabled={progress !== null} />
          </StepCard>

          {/* Visual protection */}
          <StepCard step={4} title="Proteção visual" done={false}>
            <Slider label="Intensidade geral" hint={levelLabel(protectionLevel)} value={protectionLevel} onChange={setProtectionLevel} disabled={progress !== null} lo="0 (limpo)" hi="100 (máximo)" />
            <p className="text-[10px] text-white/25 mt-1 mb-4">Cor/contraste, cromático, pisca, grão e pixelado. Em 0 o vídeo fica igual (só troca o hash).</p>
            <Slider label="Linhas de TV" hint={tvLines === 0 ? "Off" : levelLabel(tvLines)} value={tvLines} onChange={setTvLines} disabled={progress !== null} lo="0" hi="100" />
            <p className="text-[10px] text-white/25 mt-1">Efeito de linhas horizontais tipo TV/CRT, com banda rolando lentamente.</p>

            <div className="mt-4 flex flex-col gap-2">
              <button onClick={runVideoPreview} disabled={videos.length === 0 || vPreviewing || progress !== null}
                className="w-full py-2.5 rounded-lg bg-white/10 text-white/80 text-sm font-medium hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                {vPreviewing ? "Gerando preview…" : "Ver preview (5s do 1º vídeo)"}
              </button>
              {vPreviewUrl && <video src={vPreviewUrl} controls autoPlay loop muted className="w-full rounded-lg mt-1 bg-black" />}
            </div>
          </StepCard>

          {/* Audio protection */}
          <StepCard step={5} title="Proteção de áudio" done={audioOn}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-white/80">Ativar proteção anti-transcrição</span>
                <p className="text-[11px] text-white/35 mt-0.5">Blinda o áudio contra transcrição automática (robôs).</p>
              </div>
              <button onClick={() => setAudioOn((v) => !v)} disabled={progress !== null}
                className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${audioOn ? "bg-brand-500" : "bg-white/10"}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${audioOn ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>

            {audioOn && (
              <div className="mt-4 flex flex-col gap-4 border-t border-white/5 pt-4">
                <Slider label="Intensidade da blindagem" hint={levelLabel(aIntensity)} value={aIntensity} onChange={setAIntensity} disabled={progress !== null} lo="0" hi="100" />

                <div>
                  <p className="text-sm text-white/80 mb-2">Áudio isca / white (opcional)</p>
                  <p className="text-[11px] text-white/35 mb-2">Fala limpa por baixo (ex.: receita.mp3) — a IA tende a transcrever a isca.</p>
                  <UploadSlot accept="audio/*" onFiles={pickDecoy}
                    label={decoyFile ? decoyFile.name : "Clique ou arraste o áudio isca"} preview={null} />
                  {decoyFile && (
                    <>
                      <button onClick={() => setDecoyFile(null)} disabled={progress !== null} className="mt-2 text-[11px] text-white/40 hover:text-red-400 disabled:opacity-30">Remover isca</button>
                      <div className="mt-3"><Slider label="Volume da isca" value={decoyGain} onChange={setDecoyGain} disabled={progress !== null} lo="0" hi="100" /></div>
                      <div className="mt-3">
                        <Slider label="Cancelamento estéreo" value={stereoCancel} onChange={setStereoCancel} disabled={progress !== null} lo="0 (normal)" hi="100 (some no mono)" />
                        <p className="text-[10px] text-white/25 mt-1">Voz real em fase oposta → some quando a IA rebaixa pra mono. É o que mais engana o Whisper.</p>
                      </div>
                    </>
                  )}
                </div>

                <Slider label="Ruído de fundo" value={noise} onChange={setNoise} disabled={progress !== null} lo="0" hi="100" />

                <div className="flex flex-col gap-2">
                  <button onClick={runAudioPreview} disabled={videos.length === 0 || aPreviewing || progress !== null}
                    className="w-full py-2.5 rounded-lg bg-white/10 text-white/80 text-sm font-medium hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6.253v11.494m0 0L9 15m3 2.747L15 15M6.5 8.5a5 5 0 000 7" /></svg>
                    {aPreviewing ? "Gerando preview…" : "Ouvir preview do áudio (12s)"}
                  </button>
                  {aPreviewUrl && <audio src={aPreviewUrl} controls autoPlay className="w-full mt-1" />}
                  <p className="text-[10px] text-white/25 text-center">Teste no TurboScribe e ajuste. Fone/estéreo mantém a voz real audível.</p>
                </div>
              </div>
            )}
          </StepCard>

          <button onClick={handleProcess} disabled={!canProcess}
            className="w-full py-4 rounded-xl bg-brand-500 text-white font-semibold text-base hover:bg-brand-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            {videos.length > 1 ? `Processar ${videos.length} vídeos` : "Processar"}
          </button>
          <p className="text-center text-[11px] text-white/25">
            Pode deixar rodando e sair. Quando terminar, os vídeos aparecem em “Processados” abaixo pra baixar.
          </p>

          {/* Processed results — download when you come back */}
          {results.length > 0 && (
            <div className="rounded-2xl bg-white/3 border border-emerald-500/20 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">✓</span>
                  Processados ({results.length}{progress !== null ? ` de ${videos.length}…` : ""})
                </h3>
                {results.length > 1 && (
                  <button onClick={downloadAll} className="text-xs px-3 py-1.5 rounded-lg bg-brand-500 text-white font-medium hover:bg-brand-600 transition-colors">
                    Baixar todos
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {results.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/8 p-2">
                    <video src={r.url} muted className="w-12 h-12 rounded object-cover bg-black" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/80 truncate">{r.name}</p>
                      <p className="text-[10px] text-white/35">{(r.size / 1e6).toFixed(1)} MB</p>
                    </div>
                    <a href={r.url} download={r.name}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white/80 hover:bg-white/15 transition-colors">
                      Baixar
                    </a>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-white/25 mt-3">
                Os arquivos ficam disponíveis enquanto esta aba estiver aberta. Baixe antes de fechar.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Slider({ label, hint, value, onChange, disabled, lo, hi }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void; disabled: boolean; lo: string; hi: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white/70">{label}{hint ? <span className="text-white/40"> · {hint}</span> : null}</span>
        <span className="text-sm font-mono text-brand-400">{value}</span>
      </div>
      <input type="range" min={0} max={100} step={1} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))} disabled={disabled}
        className="w-full accent-brand-500 cursor-pointer disabled:opacity-40" />
      <div className="flex justify-between text-[10px] text-white/25 mt-1"><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}

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
              <button onClick={() => onRemove(v.id)} disabled={disabled} className="text-white/30 hover:text-red-400 disabled:opacity-30 text-lg px-2 leading-none" title="Remover">✕</button>
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
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${done ? "bg-emerald-500 text-white" : "bg-white/10 text-white/50"}`}>
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
      className={`relative rounded-xl border-2 border-dashed cursor-pointer overflow-hidden transition-all ${tall ? "h-44" : "h-28"}
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
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          <span className="text-xs">{label}</span>
        </div>
      )}
    </div>
  );
}
