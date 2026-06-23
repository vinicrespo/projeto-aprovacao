"use client";
import { useEffect } from "react";

export function useGlobalKeyMonitor(
  combo: { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string },
  callback: () => void
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (combo.ctrl === undefined || e.ctrlKey === combo.ctrl) &&
        (combo.shift === undefined || e.shiftKey === combo.shift) &&
        (combo.alt === undefined || e.altKey === combo.alt) &&
        e.key.toLowerCase() === combo.key.toLowerCase()
      ) {
        e.preventDefault();
        callback();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [combo, callback]);
}
