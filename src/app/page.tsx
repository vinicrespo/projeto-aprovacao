"use client";
import { useCallback, useRef, useState } from "react";
import type { ShaderUniforms, AnalysisResult, DiagnosticInfo, ProcessingState } from "@/types";
import { AssetUploader } from "@/components/AssetUploader";
import { PreviewCanvas } from "@/components/PreviewCanvas";
import { StandardizationSliders } from "@/components/StandardizationSliders";
import { QADiagnosticOverlay } from "@/components/QADiagnosticOverlay";
import { LoginScreen } from "@/components/LoginScreen";
import { useLocalStoragePresets } from "@/hooks/useLocalStoragePresets";
import { analyzeVideo } from "@/lib/analyzer";
import { AudioProcessor } from "@/lib/audioProcessor";
import { downloadBlob } from "@/lib/exporter";
import { newHashSeed, injectHashNoise, randomizedFilename } from "@/lib/hashBuster";

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
  const [isExporting, setIsExporting] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [phaseInverted, setPhaseInverted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const audioProcessorRef = useRef<AudioProcessor | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const { presets, addPreset, deletePreset } = useLocalStoragePresets();

  const handleFileSelect = useCallback(async (file: File) => {
    setVideoFile(file);
    setAnalysis(null);
    setProcessingState({ status: "analyzing", progress: 0, message: "Analisando vídeo…" });

    const tempVideo = document.createElement("video");
    tempVideo.src = URL.createObjectURL(file);
    tempVideo.muted = true;
    await new Promise<void>((res) => {
      tempVideo.onloadedmetadata = () => res();
    });

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
    const canvas = canvasRef.current;
    const audioStream = audioStreamRef.current;
    if (!canvas || !audioStream || !videoElRef.current) return;

    setIsExporting(true);
    chunksRef.current = [];

    // Assign a fresh random hash seed so every exported file has a unique binary fingerprint
    const seed = newHashSeed();
    setUniforms((u) => ({ ...u, u_hash_seed: seed }));

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    const canvasStream = canvas.captureStream(30);
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 8_000_000 });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      let blob = new Blob(chunksRef.current, { type: mimeType });
      // Inject additional binary noise to guarantee a unique file hash
      blob = await injectHashNoise(blob);
      const fname = randomizedFilename(videoFile?.name ?? "criativo.webm");
      downloadBlob(blob, fname);
      // Reset hash seed back to 0 for live preview (no visible change)
      setUniforms((u) => ({ ...u, u_hash_seed: 0 }));
      setIsExporting(false);
    };

    const video = videoElRef.current;
    video.currentTime = 0;
    video.play();
    recorder.start(200);

    video.onended = () => recorder.stop();

    const dur = video.duration * 1000 + 2000;
    setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, dur);
  }, [videoFile]);

  const stopExport = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

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
          {/* Analysis Metrics */}
          {analysis && (
            <div className="rounded-xl bg-white/3 border border-white/8 p-4">
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">
                Análise Heurística
              </h3>
              <div className="space-y-2">
                <Metric label="Intensidade de Movimento" value={analysis.motionIntensity} />
                <Metric label="Score de Artefatos" value={analysis.artifactScore} />
                <div className="text-[11px] text-white/30">
                  Histograma de luminância calculado · {analysis.luminanceHistogram.length} bins
                </div>
              </div>
            </div>
          )}

          {/* Status */}
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

          {/* Sliders */}
          <div className="rounded-xl bg-white/3 border border-white/8 p-4">
            <StandardizationSliders
              uniforms={uniforms}
              onChange={setUniforms}
              analysis={analysis}
              onSavePreset={(name) => addPreset(name, uniforms)}
            />
          </div>

          {/* Presets */}
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
        <main className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto">
          {!videoFile ? (
            <AssetUploader onFile={handleFileSelect} />
          ) : (
            <>
              <PreviewCanvas
                videoFile={videoFile}
                uniforms={uniforms}
                onDiagnostic={setDiagnostic}
                onVideoReady={handleVideoReady}
                canvasRef={canvasRef}
              />

              {/* Controls bar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => { setVideoFile(null); setAnalysis(null); }}
                  className="text-sm px-4 py-2 rounded-lg bg-white/5 text-white/60
                             hover:bg-white/10 transition-colors"
                >
                  ← Trocar
                </button>

                {/* Divider */}
                <div className="w-px h-6 bg-white/10" />

                {/* Audio monitor toggle */}
                <ToggleChip
                  active={!audioMuted}
                  onClick={toggleAudioMute}
                  icon={audioMuted ? "🔇" : "🔊"}
                  label={audioMuted ? "Áudio Mudo" : "Áudio Ativo"}
                />

                {/* Phase invert toggle */}
                <ToggleChip
                  active={phaseInverted}
                  onClick={togglePhaseInvert}
                  icon="↕"
                  label="Inverter Fase"
                  activeColor="amber"
                />

                {/* Noise toggle */}
                <ToggleChip
                  active={uniforms.u_noise_enabled > 0.5}
                  onClick={toggleNoise}
                  icon="⬛"
                  label="Ruído/Dither"
                />

                {/* Divider */}
                <div className="w-px h-6 bg-white/10" />

                {/* Flip controls */}
                <ToggleChip
                  active={uniforms.u_flip_v > 0.5}
                  onClick={toggleFlipV}
                  icon="↕"
                  label="Flip Vertical"
                  activeColor="violet"
                />
                <ToggleChip
                  active={uniforms.u_flip_h > 0.5}
                  onClick={toggleFlipH}
                  icon="↔"
                  label="Flip Horizontal"
                  activeColor="violet"
                />

                {/* Divider */}
                <div className="w-px h-6 bg-white/10" />

                {!isExporting ? (
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
                ) : (
                  <button
                    onClick={stopExport}
                    className="text-sm px-5 py-2 rounded-lg bg-red-500/80 text-white font-medium
                               hover:bg-red-600 transition-colors flex items-center gap-2 animate-pulse"
                  >
                    <div className="w-3 h-3 rounded-sm bg-white" />
                    Gravando… Parar
                  </button>
                )}

                <span className="text-xs text-white/30 font-mono ml-auto">
                  {diagnostic.fps} fps
                </span>
              </div>

              {/* Feature pills */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { icon: "🎨", title: "Consistência Cromática", desc: "sRGB ↔ P3 compensation" },
                  { icon: "🎬", title: "Motion Safety", desc: "Temporal anti-judder" },
                  { icon: "🔲", title: "Artefact Masking", desc: "Procedural dithering" },
                  { icon: "🔊", title: "Normalização Acústica", desc: "Mono-safe compression" },
                ].map((f) => (
                  <div key={f.title} className="rounded-xl bg-white/3 border border-white/8 p-3">
                    <div className="text-lg mb-1">{f.icon}</div>
                    <div className="text-xs font-medium text-white/80">{f.title}</div>
                    <div className="text-[10px] text-white/30 font-mono mt-0.5">{f.desc}</div>
                  </div>
                ))}
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
