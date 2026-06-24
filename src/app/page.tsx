"use client";
import { useCallback, useRef, useState } from "react";
import type { ShaderUniforms, AnalysisResult, DiagnosticInfo, ProcessingState } from "@/types";
import { AssetUploader } from "@/components/AssetUploader";
import { PreviewCanvas, type PreviewCanvasHandle } from "@/components/PreviewCanvas";
import { StandardizationSliders } from "@/components/StandardizationSliders";
import { QADiagnosticOverlay } from "@/components/QADiagnosticOverlay";
import { LoginScreen } from "@/components/LoginScreen";
import { useLocalStoragePresets } from "@/hooks/useLocalStoragePresets";
import { analyzeVideo } from "@/lib/analyzer";
import { AudioProcessor } from "@/lib/audioProcessor";
import { downloadBlob } from "@/lib/exporter";
import { newHashSeed, randomizedFilename } from "@/lib/hashBuster";
import { ExportModal } from "@/components/ExportModal";
import { exportMp4 } from "@/lib/mp4Exporter";

const DEFAULT_UNIFORMS: ShaderUniforms = {
  u_time: 0,
  u_contrast_curve: 0.3,
  u_chromatic_offset: 0.25,
  u_motion_blur_weight: 0.2,
  u_noise_density: 0.2,
  u_noise_enabled: 1,
  u_flip_v: 0,
  u_flip_h: 0,
  u_hash_seed: 0, // set fresh on each export
};

export default function DashboardPage() {
  const [authed, setAuthed] = useState(() => {
    try { return sessionStorage.getItem("fu_auth") === "1"; } catch { return false; }
  });

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;

  return <App />;
}

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uniforms, setUniforms] = useState<ShaderUniforms>(DEFAULT_UNIFORMS);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>({
    status: "idle", progress: 0, message: "",
  });
  const [diagnostic, setDiagnostic] = useState<DiagnosticInfo>({
    fps: 0, gpuMemoryMB: 0, shaderErrors: [], frameTimeMs: 0,
  });
  const [qaVisible, setQaVisible] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [audioMuted, setAudioMuted] = useState(false);
  const [phaseInverted, setPhaseInverted] = useState(false);
  const [compressorThreshold, setCompressorThreshold] = useState(-18);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<PreviewCanvasHandle>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const cancelExportRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const { presets, addPreset, deletePreset } = useLocalStoragePresets();

  const handleFileSelect = useCallback(async (file: File) => {
    setVideoFile(file);
    setAnalysis(null);
    setIsPlaying(true);
    setProcessingState({ status: "analyzing", progress: 0, message: "Analisando vídeo…" });

    const tempVideo = document.createElement("video");
    tempVideo.src = URL.createObjectURL(file);
    tempVideo.muted = true;
    await new Promise<void>((res) => { tempVideo.onloadedmetadata = () => res(); });

    try {
      const result = await analyzeVideo(tempVideo, (p) => {
        setProcessingState({ status: "analyzing", progress: p, message: `Analisando frames… ${Math.round(p * 100)}%` });
      });
      setAnalysis(result);
      setProcessingState({ status: "idle", progress: 1, message: "Análise concluída" });
    } catch {
      setProcessingState({ status: "error", progress: 0, message: "Falha na análise" });
    } finally {
      URL.revokeObjectURL(tempVideo.src);
    }
  }, []);

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    videoElRef.current = video;
    if (!audioProcessorRef.current) {
      audioProcessorRef.current = new AudioProcessor({ invertPhase: false, monitorVolume: 1 });
    }
    audioStreamRef.current = audioProcessorRef.current.connect(video);
    video.onplay  = () => setIsPlaying(true);
    video.onpause = () => setIsPlaying(false);
  }, []);

  const togglePlayPause = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }, []);

  const toggleAudioMute = useCallback(() => {
    setAudioMuted((prev) => {
      const next = !prev;
      audioProcessorRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const togglePhaseInvert = useCallback(() => {
    setPhaseInverted((prev) => {
      const next = !prev;
      audioProcessorRef.current?.setPhaseInvert(next);
      return next;
    });
  }, []);

  const handleCompressorThreshold = useCallback((db: number) => {
    setCompressorThreshold(db);
    audioProcessorRef.current?.setCompressorThreshold(db);
  }, []);

  const toggleNoise = useCallback(() => {
    setUniforms((u) => ({ ...u, u_noise_enabled: u.u_noise_enabled > 0.5 ? 0 : 1 }));
  }, []);

  const toggleFlipV = useCallback(() => {
    setUniforms((u) => ({ ...u, u_flip_v: u.u_flip_v > 0.5 ? 0 : 1 }));
  }, []);

  const toggleFlipH = useCallback(() => {
    setUniforms((u) => ({ ...u, u_flip_h: u.u_flip_h > 0.5 ? 0 : 1 }));
  }, []);

  const handleExport = useCallback(async () => {
    if (exportProgress !== null) return; // prevent double-trigger
    const canvas = canvasRef.current;
    const video = videoElRef.current;
    const preview = previewRef.current;
    if (!canvas || !video || !videoFile || !preview) return;

    audioProcessorRef.current?.setMuted(true);

    const seed = newHashSeed();
    setUniforms((u) => ({ ...u, u_hash_seed: seed }));
    cancelExportRef.current = { cancelled: false };
    setExportProgress(0);
    setExportDone(false);

    const cleanup = () => {
      setExportProgress(null);
      setUniforms((u) => ({ ...u, u_hash_seed: 0 }));
      audioProcessorRef.current?.setMuted(audioMuted);
    };

    try {
      const blob = await exportMp4({
        canvas,
        video,
        videoFile,
        compressorThreshold,
        invertPhase: phaseInverted,
        renderNow: preview.renderNow,
        syncGPU: preview.syncGPU,
        pauseLoop: preview.pauseLoop,
        resumeLoop: preview.resumeLoop,
        onProgress: setExportProgress,
        cancelRef: cancelExportRef.current,
      });

      if (blob && !cancelExportRef.current.cancelled) {
        const fname = randomizedFilename(videoFile.name);
        // Close modal BEFORE triggering download so browser's save dialog
        // doesn't appear while the progress modal is still visible
        cleanup();
        downloadBlob(blob, fname);
      } else {
        cleanup();
        if (!blob) alert("Use o Chrome para exportar MP4 (WebCodecs necessário).");
      }
    } catch (e) {
      console.error("Export failed:", e);
      cleanup();
    }
  }, [videoFile, audioMuted, compressorThreshold, phaseInverted, exportProgress]);

  const cancelExport = useCallback(() => {
    cancelExportRef.current.cancelled = true;
    setExportProgress(null);
    setUniforms((u) => ({ ...u, u_hash_seed: 0 }));
    audioProcessorRef.current?.setMuted(audioMuted);
  }, [audioMuted]);

  return (
    <div className="min-h-screen flex flex-col">
      {exportProgress !== null && (
        <ExportModal progress={exportProgress} done={false} onCancel={cancelExport} />
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
          <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-mono">
            ● 100% Client-Side
          </span>
          <span className="text-[10px] px-2 py-1 rounded-full bg-white/5 text-white/30 font-mono">
            GDPR Compliant
          </span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 border-r border-white/5 p-5 overflow-y-auto flex flex-col gap-6">
          {analysis && (
            <div className="rounded-xl bg-white/3 border border-white/8 p-4">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">
                Análise Heurística
              </h3>
              <div className="space-y-2">
                <Metric label="Intensidade de Movimento" value={analysis.motionIntensity} />
                <Metric label="Score de Artefatos" value={analysis.artifactScore} />
                <div className="text-[11px] text-white/30">
                  Histograma calculado · {analysis.luminanceHistogram.length} bins
                </div>
              </div>
            </div>
          )}

          {processingState.status !== "idle" && (
            <div className="rounded-xl bg-white/3 border border-white/8 p-4">
              <div className="flex items-center gap-2 mb-2">
                {processingState.status === "analyzing" && (
                  <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                )}
                <span className="text-xs text-white/60">{processingState.message}</span>
              </div>
              {processingState.status === "analyzing" && (
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-all duration-300"
                    style={{ width: `${processingState.progress * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Visual sliders */}
          <div className="rounded-xl bg-white/3 border border-white/8 p-4">
            <StandardizationSliders
              uniforms={uniforms}
              onChange={setUniforms}
              analysis={analysis}
              onSavePreset={(name) => addPreset(name, uniforms)}
            />
          </div>

          {/* Audio controls */}
          {videoFile && (
            <div className="rounded-xl bg-white/3 border border-white/8 p-4">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-4">
                Controles de Áudio
              </h3>
              <div className="space-y-4">
                {/* Compressor threshold */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <div>
                      <span className="text-sm text-white/80">Intensidade do Ruído</span>
                      <p className="text-[11px] text-white/35 mt-0.5">Threshold do compressor dinâmico</p>
                    </div>
                    <span className="text-sm font-mono text-brand-500 self-start">{compressorThreshold} dB</span>
                  </div>
                  <div className="relative h-1.5 bg-white/10 rounded-full">
                    <div
                      className="absolute left-0 top-0 h-full bg-brand-500 rounded-full"
                      style={{ width: `${((compressorThreshold + 60) / 60) * 100}%` }}
                    />
                    <input
                      type="range" min={-60} max={0} step={1}
                      value={compressorThreshold}
                      onChange={(e) => handleCompressorThreshold(parseInt(e.target.value))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-white/20 mt-1">
                    <span>Máximo</span><span>Nenhum</span>
                  </div>
                </div>

                {/* Phase invert */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white/80">Inverter Fase</span>
                    <p className="text-[11px] text-white/35 mt-0.5">Compatibilidade mono</p>
                  </div>
                  <button
                    onClick={togglePhaseInvert}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      phaseInverted ? "bg-amber-500" : "bg-white/10"
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                      phaseInverted ? "left-5" : "left-0.5"
                    }`} />
                  </button>
                </div>

                {/* Mute monitor */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white/80">Monitor de Áudio</span>
                    <p className="text-[11px] text-white/35 mt-0.5">Ouvir no preview</p>
                  </div>
                  <button
                    onClick={toggleAudioMute}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      !audioMuted ? "bg-brand-500" : "bg-white/10"
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                      !audioMuted ? "left-5" : "left-0.5"
                    }`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {presets.length > 0 && (
            <div className="rounded-xl bg-white/3 border border-white/8 p-4">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">
                Presets Salvos
              </h3>
              <div className="space-y-1.5">
                {presets.map((p) => (
                  <div key={p.id} className="flex items-center justify-between group">
                    <button
                      onClick={() => setUniforms(p.uniforms)}
                      className="text-xs text-white/60 hover:text-white transition-colors"
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => deletePreset(p.id)}
                      className="text-[10px] text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 flex flex-col gap-4 overflow-y-auto">
          {!videoFile ? (
            <AssetUploader onFile={handleFileSelect} />
          ) : (
            <>
              <PreviewCanvas
                ref={previewRef}
                videoFile={videoFile}
                uniforms={uniforms}
                onDiagnostic={setDiagnostic}
                onVideoReady={handleVideoReady}
                canvasRef={canvasRef}
              />

              {/* Controls bar */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Back */}
                <button
                  onClick={() => { setVideoFile(null); setAnalysis(null); }}
                  className="text-sm px-3 py-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
                >
                  ← Trocar
                </button>

                <div className="w-px h-6 bg-white/10" />

                {/* Play / Pause */}
                <button
                  onClick={togglePlayPause}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white/5
                             text-white/70 hover:bg-white/10 transition-colors"
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                  )}
                  {isPlaying ? "Pausar" : "Retomar"}
                </button>

                <div className="w-px h-6 bg-white/10" />

                {/* Visual toggles */}
                <ToggleChip active={uniforms.u_noise_enabled > 0.5} onClick={toggleNoise} icon="⬛" label="Ruído/Dither" />
                <ToggleChip active={uniforms.u_flip_v > 0.5} onClick={toggleFlipV} icon="↕" label="Flip V" activeColor="violet" />
                <ToggleChip active={uniforms.u_flip_h > 0.5} onClick={toggleFlipH} icon="↔" label="Flip H" activeColor="violet" />

                <div className="w-px h-6 bg-white/10" />

                {/* Download */}
                <button
                  onClick={handleExport}
                  className="text-sm px-5 py-2 rounded-lg bg-brand-500 text-white font-medium
                             hover:bg-brand-600 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Baixar Vídeo
                </button>

                <span className="text-xs text-white/30 font-mono ml-auto">{diagnostic.fps} fps</span>
              </div>
            </>
          )}
        </main>
      </div>

      <QADiagnosticOverlay
        visible={qaVisible}
        onToggle={() => setQaVisible((v) => !v)}
        info={diagnostic}
      />
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  icon,
  label,
  activeColor = "brand",
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  activeColor?: "brand" | "amber" | "violet";
}) {
  const colors = {
    brand:  active ? "bg-brand-500/20 border-brand-500/50 text-brand-400" : "bg-white/5 border-white/10 text-white/40",
    amber:  active ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "bg-white/5 border-white/10 text-white/40",
    violet: active ? "bg-violet-500/20 border-violet-500/50 text-violet-400" : "bg-white/5 border-white/10 text-white/40",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${colors[activeColor]}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-white/50">{label}</span>
        <span className="text-white/70 font-mono">{pct}%</span>
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            pct > 70 ? "bg-red-500" : pct > 40 ? "bg-yellow-500" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
