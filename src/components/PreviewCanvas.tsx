"use client";
import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type { ShaderUniforms, DiagnosticInfo } from "@/types";
import { createProgram, setupFullscreenQuad, uploadVideoTexture, createTexture } from "@/lib/shaderLoader";

export interface PreviewCanvasHandle {
  pauseLoop: () => void;
  resumeLoop: () => void;
  renderNow: () => void;  // render one frame on demand (used by exporter)
  syncGPU: () => void;    // blocks until GPU finishes — call before VideoFrame capture
}

interface Props {
  videoFile: File | null;
  uniforms: ShaderUniforms;
  onDiagnostic?: (info: DiagnosticInfo) => void;
  onVideoReady?: (el: HTMLVideoElement) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

const FRAG_GLSL_PATH = "/standardization_frag.glsl";

export const PreviewCanvas = forwardRef<PreviewCanvasHandle, Props>(function PreviewCanvas(
  { videoFile, uniforms, onDiagnostic, onVideoReady, canvasRef: extCanvasRef },
  ref
) {
  const internalRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = extCanvasRef ?? internalRef;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const texCurrentRef = useRef<WebGLTexture | null>(null);
  const texPrevRef = useRef<WebGLTexture | null>(null);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const uniformsRef = useRef(uniforms);
  const fpsRef = useRef({ frames: 0, last: performance.now() });
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  uniformsRef.current = uniforms;

  const initGL = useCallback(async (canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 not supported");
    glRef.current = gl;

    const fragSrc = await fetch(FRAG_GLSL_PATH).then((r) => r.text()).catch(() =>
      `#version 300 es\nprecision highp float;\nuniform sampler2D u_texture;\nin vec2 v_texcoord;\nout vec4 fragColor;\nvoid main(){fragColor=texture(u_texture,v_texcoord);}`
    );

    const program = createProgram(gl, fragSrc);
    programRef.current = program;
    vaoRef.current = setupFullscreenQuad(gl, program);
    texCurrentRef.current = createTexture(gl);
    texPrevRef.current = createTexture(gl);
  }, []);

  // Pure WebGL draw — no RAF scheduling, no canvas resize side-effects
  const renderCore = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const vao = vaoRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !vao || !video || !canvas || video.readyState < 2) return;

    // Only resize canvas when video dimensions actually change (resize clears canvas!)
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    if (canvasSizeRef.current.w !== vw || canvasSizeRef.current.h !== vh) {
      canvas.width = vw;
      canvas.height = vh;
      canvasSizeRef.current = { w: vw, h: vh };
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    uploadVideoTexture(gl, texCurrentRef.current!, video);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const u = uniformsRef.current;
    const loc = (n: string) => gl.getUniformLocation(program, n);
    gl.uniform1f(loc("u_time"), performance.now() / 1000);
    gl.uniform1f(loc("u_contrast_curve"), u.u_contrast_curve);
    gl.uniform1f(loc("u_chromatic_offset"), u.u_chromatic_offset);
    gl.uniform1f(loc("u_motion_blur_weight"), u.u_motion_blur_weight);
    gl.uniform1f(loc("u_noise_density"), u.u_noise_density);
    gl.uniform1f(loc("u_noise_enabled"), u.u_noise_enabled);
    gl.uniform1f(loc("u_flip_v"), u.u_flip_v);
    gl.uniform1f(loc("u_flip_h"), u.u_flip_h);
    gl.uniform1f(loc("u_hash_seed"), u.u_hash_seed);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texCurrentRef.current);
    gl.uniform1i(loc("u_texture"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texPrevRef.current);
    gl.uniform1i(loc("u_prev_texture"), 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    fpsRef.current.frames++;
    const now = performance.now();
    if (now - fpsRef.current.last >= 1000) {
      const fps = fpsRef.current.frames;
      fpsRef.current = { frames: 0, last: now };
      onDiagnostic?.({ fps, gpuMemoryMB: 0, shaderErrors: [], frameTimeMs: fps > 0 ? 1000 / fps : 0 });
    }
  }, [canvasRef, onDiagnostic]);

  // RAF loop — calls renderCore each tick unless paused
  const render = useCallback(() => {
    if (!pausedRef.current) renderCore();
    rafRef.current = requestAnimationFrame(render);
  }, [renderCore]);

  useImperativeHandle(ref, () => ({
    pauseLoop: () => { pausedRef.current = true; },
    resumeLoop: () => { pausedRef.current = false; },
    renderNow: renderCore,
    syncGPU: () => { glRef.current?.finish(); }, // force GPU-CPU sync before frame capture
  }), [renderCore]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoFile) return;

    pausedRef.current = false;
    canvasSizeRef.current = { w: 0, h: 0 };

    const video = document.createElement("video");
    video.muted = false;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = URL.createObjectURL(videoFile);
    videoRef.current = video;

    initGL(canvas).then(() => {
      video.play().catch(() => {});
      onVideoReady?.(video);
      rafRef.current = requestAnimationFrame(render);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      URL.revokeObjectURL(video.src);
      video.src = "";
      const gl = glRef.current;
      if (gl && programRef.current) gl.deleteProgram(programRef.current);
    };
  }, [videoFile, initGL, render, onVideoReady, canvasRef]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <canvas
        ref={canvasRef as React.RefObject<HTMLCanvasElement>}
        className="w-full h-full object-contain"
      />
      {!videoFile && (
        <div className="absolute inset-0 flex items-center justify-center text-white/20 text-sm">
          Nenhum vídeo carregado
        </div>
      )}
    </div>
  );
});
