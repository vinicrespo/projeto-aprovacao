export interface ExportOptions {
  canvas: HTMLCanvasElement;
  audioStream: MediaStream;
  videoBitrateBps?: number;
  audioBitrateBps?: number;
  mimeType?: string;
}

export async function exportStandardizedAsset(
  options: ExportOptions,
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const {
    canvas,
    audioStream,
    videoBitrateBps = 8_000_000,
    audioBitrateBps = 192_000,
    mimeType = "video/webm;codecs=vp9,opus",
  } = options;

  const canvasStream = canvas.captureStream(30);

  // Merge video track from canvas + audio tracks from processor
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);

  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: videoBitrateBps,
    audioBitsPerSecond: audioBitrateBps,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise<Blob>((resolve, reject) => {
    recorder.onerror = (e) => reject(new Error(`MediaRecorder error: ${e}`));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
    recorder.start(200);
    onProgress?.(0.1);
  });
}

export function stopRecorder(recorder: MediaRecorder): Promise<void> {
  return new Promise((res) => {
    recorder.addEventListener("stop", () => res(), { once: true });
    recorder.stop();
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
