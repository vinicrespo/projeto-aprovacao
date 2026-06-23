"use client";
import { useCallback, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
}

export function AssetUploader({ onFile }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/")) {
        alert("Please upload a video file.");
        return;
      }
      onFile(file);
    },
    [onFile]
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
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      <div className="w-16 h-16 rounded-2xl bg-brand-500/15 flex items-center justify-center">
        <svg className="w-8 h-8 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
        </svg>
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-white/80">
          {dragging ? "Release to upload" : "Drop your video here"}
        </p>
        <p className="text-xs text-white/40 mt-1">
          or click to browse · MP4, MOV, WebM · processed entirely in-browser
        </p>
      </div>

      <div className="flex gap-2">
        {["Privacy-First", "GDPR", "Client-Side Only"].map((tag) => (
          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/40 font-mono">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
