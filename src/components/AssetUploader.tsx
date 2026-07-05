"use client";
import { useCallback, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  accept?: string;       // e.g. "video/*" or "image/*"
  label?: string;
}

export function AssetUploader({ onFile, accept = "video/*", label }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isImage = accept === "image/*";

  const handleFile = useCallback(
    (file: File) => {
      if (isImage && !file.type.startsWith("image/")) {
        alert("Envie uma imagem (JPG, PNG, WebP…).");
        return;
      }
      if (!isImage && !file.type.startsWith("video/")) {
        alert("Envie um vídeo (MP4, MOV, WebM…).");
        return;
      }
      onFile(file);
    },
    [onFile, isImage]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`
        relative flex flex-col items-center justify-center gap-4
        w-full min-h-[280px] rounded-2xl border-2 border-dashed
        cursor-pointer transition-all duration-200 select-none
        ${dragging
          ? "border-brand-500 bg-brand-500/10 scale-[1.01]"
          : "border-white/10 bg-white/3 hover:border-white/25 hover:bg-white/5"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />

      <div className="w-16 h-16 rounded-2xl bg-brand-500/15 flex items-center justify-center">
        {isImage ? (
          <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
        )}
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-white/80">
          {dragging ? "Solte aqui" : (label ?? (isImage ? "Arraste uma imagem aqui" : "Arraste um vídeo aqui"))}
        </p>
        <p className="text-xs text-white/40 mt-1">
          {isImage
            ? "ou clique para selecionar · JPG, PNG, WebP · processado no browser"
            : "ou clique para selecionar · MP4, MOV, WebM · processado no browser"}
        </p>
      </div>

      <div className="flex gap-2">
        {["Privacy-First", "GDPR", "Client-Side Only"].map((tag) => (
          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/40 font-mono">{tag}</span>
        ))}
      </div>
    </div>
  );
}
