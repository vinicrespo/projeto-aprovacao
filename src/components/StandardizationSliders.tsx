"use client";
import { useState } from "react";
import type { ShaderUniforms, AnalysisResult } from "@/types";

interface SliderDef {
  key: keyof Omit<ShaderUniforms, "u_time">;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

const SLIDERS: SliderDef[] = [
  {
    key: "u_contrast_curve",
    label: "Calibração de Contraste",
    description: "Ajuste não-linear de contraste para legibilidade WCAG",
    min: 0, max: 1, step: 0.01,
  },
  {
    key: "u_chromatic_offset",
    label: "Correção Cromática",
    description: "Compensação de desalinhamento de canais de cor entre gamuts",
    min: 0, max: 1, step: 0.01,
  },
  {
    key: "u_motion_blur_weight",
    label: "Suavização de Movimento",
    description: "Integração temporal para redução de judder e fadiga visual",
    min: 0, max: 0.65, step: 0.01,
  },
  {
    key: "u_noise_density",
    label: "Refinamento de Textura",
    description: "Dithering procedural para mascaramento de artefatos de compressão",
    min: 0, max: 1, step: 0.01,
  },
  {
    key: "u_crackle_intensity",
    label: "Craquelado",
    description: "Linhas finas de rachadura sobrepostas — imagem permanece legível",
    min: 0, max: 1, step: 0.01,
  },
];

interface Props {
  uniforms: ShaderUniforms;
  onChange: (next: ShaderUniforms) => void;
  analysis: AnalysisResult | null;
  onSavePreset: (name: string) => void;
}

export function StandardizationSliders({ uniforms, onChange, analysis, onSavePreset }: Props) {
  const [presetName, setPresetName] = useState("");

  const set = (key: keyof ShaderUniforms, value: number) => {
    onChange({ ...uniforms, [key]: value });
  };

  const applyRecommendation = () => {
    if (!analysis) return;
    onChange(analysis.recommendedProfile);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80 tracking-wide uppercase">
          Parâmetros de Padronização
        </h3>
        <button
          onClick={applyRecommendation}
          disabled={!analysis}
          className="text-xs px-3 py-1.5 rounded-lg bg-brand-500 text-white font-medium
                     disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brand-600
                     transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm1 11H9v-2h2v2zm0-4H9V7h2v2z" />
          </svg>
          Aplicar Recomendação da IA
        </button>
      </div>

      {SLIDERS.map(({ key, label, description, min, max, step }) => {
        const value = uniforms[key] as number;
        const pct = ((value - min) / (max - min)) * 100;
        return (
          <div key={key} className="group">
            <div className="flex justify-between mb-1.5">
              <div>
                <span className="text-sm text-white/80">{label}</span>
                <p className="text-[11px] text-white/35 mt-0.5">{description}</p>
              </div>
              <span className="text-sm font-mono text-brand-500 self-start">
                {value.toFixed(2)}
              </span>
            </div>
            <div className="relative h-1.5 bg-white/10 rounded-full">
              <div
                className="absolute left-0 top-0 h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => set(key, parseFloat(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              />
            </div>
          </div>
        );
      })}

      <div className="pt-2 border-t border-white/5 flex gap-2">
        <input
          type="text"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder="Nome do preset…"
          className="flex-1 text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10
                     text-white placeholder:text-white/30 outline-none focus:border-brand-500
                     transition-colors"
        />
        <button
          onClick={() => {
            if (presetName.trim()) {
              onSavePreset(presetName.trim());
              setPresetName("");
            }
          }}
          className="text-xs px-3 py-2 rounded-lg bg-white/10 text-white/70
                     hover:bg-white/15 transition-colors"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
