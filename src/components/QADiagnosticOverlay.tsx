"use client";
import { useCallback, useEffect } from "react";
import type { DiagnosticInfo } from "@/types";
import { useGlobalKeyMonitor } from "@/hooks/useGlobalKeyMonitor";

interface Props {
  visible: boolean;
  onToggle: () => void;
  info: DiagnosticInfo;
}

export function QADiagnosticOverlay({ visible, onToggle, info }: Props) {
  const combo = { ctrl: true, shift: true, key: "f" };
  useGlobalKeyMonitor(combo, onToggle);

  const exportLogs = useCallback(() => {
    const entry = {
      timestamp: new Date().toISOString(),
      ...info,
    };
    try {
      const existing = JSON.parse(sessionStorage.getItem("face_unds_debug_logs") ?? "[]");
      existing.push(entry);
      sessionStorage.setItem("face_unds_debug_logs", JSON.stringify(existing));
    } catch {}
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `face-unds-debug-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [info]);

  if (!visible) return null;

  const fpsColor =
    info.fps >= 55 ? "text-emerald-400" :
    info.fps >= 30 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl bg-black/80 backdrop-blur-sm
                    border border-white/10 p-4 font-mono text-xs text-white/70 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-widest text-white/40">
          QA Diagnostic · Ctrl+Shift+F
        </span>
        <button onClick={onToggle} className="text-white/30 hover:text-white/70 transition-colors">
          ✕
        </button>
      </div>

      <div className="space-y-1.5">
        <Row label="FPS">
          <span className={fpsColor}>{info.fps}</span>
        </Row>
        <Row label="Frame Time">
          <span>{info.frameTimeMs.toFixed(1)} ms</span>
        </Row>
        <Row label="GPU Mem">
          <span>{info.gpuMemoryMB > 0 ? `${info.gpuMemoryMB} MB` : "N/A"}</span>
        </Row>
        <Row label="Shader Errors">
          <span className={info.shaderErrors.length ? "text-red-400" : "text-emerald-400"}>
            {info.shaderErrors.length ? info.shaderErrors.join(", ") : "None"}
          </span>
        </Row>
      </div>

      <button
        onClick={exportLogs}
        className="mt-3 w-full text-[10px] py-1.5 rounded-lg bg-white/5
                   hover:bg-white/10 transition-colors text-white/50"
      >
        Export Debug Log
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/40">{label}</span>
      {children}
    </div>
  );
}
