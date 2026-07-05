"use client";
import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type { ShaderUniforms } from "@/types";
import { createProgram, setupFullscreenQuad, createTexture } from "@/lib/shaderLoader";

export interface ImageCanvasHandle {
  exportPng: () => Promise<Blob | null>;
}

interface Props {
  imageFile: File | null;
  uniforms: ShaderUniforms;
}

interface UniformLocs {
  u_time: WebGLUniformLocation | null;
  u_contrast_curve: WebGLUniformLocation | null;
  u_chromatic_offset: WebGLUniformLocation | null;
  u_motion_blur_weight: WebGLUniformLocation | null;
  u_noise_density: WebGLUniformLocation | null;
  u_noise_enabled: WebGLUniformLocation | null;
  u_flip_v: WebGLUniformLocation | null;
  u_flip_h: WebGLUniformLocation | null;
  u_hash_seed: WebGLUniformLocation | null;
  u_crackle_intensity: WebGLUniformLocation | null;
  u_texture: WebGLUniformLocation | null;
  u_prev_texture: WebGLUniformLocation | null;
}

const FRAG_GLSL_PATH = "/standardization_frag.glsl";

export const ImageCanvas = forwardRef<ImageCanvasHandle, Props>(function ImageCanvas(
  { imageFile, uniforms },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const texCurrentRef = useRef<WebGLTexture | null>(null);
  const texPrevRef = useRef<WebGLTexture | null>(null);
  const locsRef = useRef<UniformLocs | null>(null);
  const uniformsRef = useRef(uniforms);
  uniformsRef.current = uniforms;

  const renderFrame = useCallback(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const vao = vaoRef.current;
    const canvas = canvasRef.current;
    const locs = locsRef.current;
    if (!gl || !program || !vao || !canvas || !locs) return;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const u = uniformsRef.current;
    gl.uniform1f(locs.u_time,               0);
    gl.uniform1f(locs.u_contrast_curve,     u.u_contrast_curve);
    gl.uniform1f(locs.u_chromatic_offset,   u.u_chromatic_offset);
    gl.uniform1f(locs.u_motion_blur_weight, 0); // no temporal blend for images
    gl.uniform1f(locs.u_noise_density,      u.u_noise_density);
    gl.uniform1f(locs.u_noise_enabled,      u.u_noise_enabled);
    gl.uniform1f(locs.u_flip_v,             u.u_flip_v);
    gl.uniform1f(locs.u_flip_h,             u.u_flip_h);
    gl.uniform1f(locs.u_hash_seed,          u.u_hash_seed);
    gl.uniform1f(locs.u_crackle_intensity,  u.u_crackle_intensity);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texCurrentRef.current);
    gl.uniform1i(locs.u_texture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texPrevRef.current);
    gl.uniform1i(locs.u_prev_texture, 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }, []);

  // Re-render whenever uniforms change
  useEffect(() => {
    renderFrame();
  }, [uniforms, renderFrame]);

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      // Re-render with export hash seed
      renderFrame();
      glRef.current?.finish();
      return new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    },
  }), [renderFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageFile) return;

    const img = new Image();
    img.src = URL.createObjectURL(imageFile);
    img.onload = async () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const gl = canvas.getContext("webgl2");
      if (!gl) return;
      glRef.current = gl;

      const fragSrc = await fetch(FRAG_GLSL_PATH).then((r) => r.text());
      const program = createProgram(gl, fragSrc);
      programRef.current = program;
      vaoRef.current = setupFullscreenQuad(gl, program);

      // Upload image as texture
      const tex = createTexture(gl);
      texCurrentRef.current = tex;
      texPrevRef.current = createTexture(gl); // prev = same image (no temporal blend)

      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);

      // Copy to prev texture so temporal blend is a no-op
      gl.bindTexture(gl.TEXTURE_2D, texPrevRef.current);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);

      locsRef.current = {
        u_time:               gl.getUniformLocation(program, "u_time"),
        u_contrast_curve:     gl.getUniformLocation(program, "u_contrast_curve"),
        u_chromatic_offset:   gl.getUniformLocation(program, "u_chromatic_offset"),
        u_motion_blur_weight: gl.getUniformLocation(program, "u_motion_blur_weight"),
        u_noise_density:      gl.getUniformLocation(program, "u_noise_density"),
        u_noise_enabled:      gl.getUniformLocation(program, "u_noise_enabled"),
        u_flip_v:             gl.getUniformLocation(program, "u_flip_v"),
        u_flip_h:             gl.getUniformLocation(program, "u_flip_h"),
        u_hash_seed:          gl.getUniformLocation(program, "u_hash_seed"),
        u_crackle_intensity:  gl.getUniformLocation(program, "u_crackle_intensity"),
        u_texture:            gl.getUniformLocation(program, "u_texture"),
        u_prev_texture:       gl.getUniformLocation(program, "u_prev_texture"),
      };

      renderFrame();
      URL.revokeObjectURL(img.src);
    };

    return () => {
      URL.revokeObjectURL(img.src);
      const gl = glRef.current;
      if (gl && programRef.current) gl.deleteProgram(programRef.current);
      glRef.current = null;
      locsRef.current = null;
    };
  }, [imageFile, renderFrame]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full object-contain"
        style={{ display: imageFile ? "block" : "none" }}
      />
      {!imageFile && (
        <div className="text-white/20 text-sm">Nenhuma imagem carregada</div>
      )}
    </div>
  );
});
