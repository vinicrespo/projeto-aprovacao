"use client";
import { useState, useCallback } from "react";
import type { Preset, ShaderUniforms } from "@/types";

const STORAGE_KEY = "face_unds_presets";

function load(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Preset[]) : [];
  } catch {
    return [];
  }
}

function save(presets: Preset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {}
}

export function useLocalStoragePresets() {
  const [presets, setPresets] = useState<Preset[]>(() =>
    typeof window !== "undefined" ? load() : []
  );

  const addPreset = useCallback((name: string, uniforms: ShaderUniforms) => {
    const preset: Preset = {
      id: crypto.randomUUID(),
      name,
      uniforms,
      createdAt: Date.now(),
    };
    setPresets((prev) => {
      const next = [...prev, preset];
      save(next);
      return next;
    });
    return preset;
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      save(next);
      return next;
    });
  }, []);

  return { presets, addPreset, deletePreset };
}
