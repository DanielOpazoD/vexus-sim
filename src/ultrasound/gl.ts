/** Utilidades WebGL2 mínimas: programas, texturas flotantes y FBO. */
export class GLProgram {
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  /** Un programa ya enlazado y comprobado: se crean con `link` o `linkAll`. */
  private constructor(
    readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram,
    readonly name: string,
    /** Salidas de color que escribe su shader de fragmentos (`fragmentOutputCount`). */
    readonly outputs: number,
  ) {}

  /** Un programa solo (el de consulta, que se crea al usarse): un lote de uno. */
  static link(gl: WebGL2RenderingContext, vert: string, frag: string, name: string): GLProgram {
    return GLProgram.linkAll(gl, vert, { [name]: frag })[name];
  }

  /**
   * Compila y enlaza un lote de programas con el mismo shader de vértices (el nombre de cada uno es su clave)
   * sin esperar a ninguno, y solo después comprueba cada enlace. Consultar un estado bloquea hasta que ese
   * trabajo termina: hacerlo tras cada shader encadenaba las compilaciones de una en una; así el navegador
   * las tiene todas encargadas y, con KHR_parallel_shader_compile activada (la pide el renderizador antes),
   * puede repartirlas entre sus hilos de fondo (dos por contexto en Chrome). El estado de compilación solo
   * se lee si un enlace falla, para el mensaje (MDN, «WebGL best practices»). Si uno falla, se liberan todos
   * los del lote y se lanza con su nombre y el registro del compilador o del enlazador (decisión 58).
   */
  static linkAll<K extends string>(gl: WebGL2RenderingContext, vert: string, frags: Record<K, string>): Record<K, GLProgram> {
    const staged = (Object.keys(frags) as K[]).map((name) => {
      const vs = shader(gl, gl.VERTEX_SHADER, vert);
      const fs = shader(gl, gl.FRAGMENT_SHADER, frags[name]);
      const p = gl.createProgram();
      if (!p) throw new Error('createProgram');
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      return { name, vs, fs, p };
    });
    let error: Error | null = null;
    for (const s of staged) {
      if (!error && !gl.getProgramParameter(s.p, gl.LINK_STATUS)) error = linkError(gl, s, vert, frags[s.name]);
      gl.deleteShader(s.vs);
      gl.deleteShader(s.fs);
    }
    if (error) {
      for (const s of staged) gl.deleteProgram(s.p);
      throw error;
    }
    const out = {} as Record<K, GLProgram>;
    for (const s of staged) out[s.name] = new GLProgram(gl, s.p, s.name, fragmentOutputCount(frags[s.name]));
    return out;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.uniforms.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, l);
    }
    return l;
  }

  f(name: string, v: number): void {
    this.gl.uniform1f(this.loc(name), v);
  }
  i(name: string, v: number): void {
    this.gl.uniform1i(this.loc(name), v);
  }
  v2(name: string, a: number, b: number): void {
    this.gl.uniform2f(this.loc(name), a, b);
  }
  v3(name: string, v: ArrayLike<number>): void {
    this.gl.uniform3f(this.loc(name), v[0], v[1], v[2]);
  }
  v4(name: string, a: number, b: number, c: number, d: number): void {
    this.gl.uniform4f(this.loc(name), a, b, c, d);
  }
  fv(name: string, v: Float32Array | readonly number[]): void {
    // WebGL no muta el array; el tipo DOM no acepta `readonly`
    this.gl.uniform1fv(this.loc(name), v as Float32List);
  }
  v4v(name: string, v: Float32Array): void {
    this.gl.uniform4fv(this.loc(name), v);
  }
  v3v(name: string, v: Float32Array): void {
    this.gl.uniform3fv(this.loc(name), v);
  }
  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
  tex(name: string, unit: number, texture: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.loc(name), unit);
  }
}

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

/** Causa de un enlace fallido: el shader que no compiló (con las líneas del error) o el registro del enlace. */
function linkError(
  gl: WebGL2RenderingContext,
  s: { name: string; vs: WebGLShader; fs: WebGLShader; p: WebGLProgram },
  vert: string,
  frag: string,
): Error {
  for (const [sh, src, stage] of [
    [s.vs, vert, 'vert'],
    [s.fs, frag, 'frag'],
  ] as const) {
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) continue;
    const log = gl.getShaderInfoLog(sh) ?? '';
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
    return new Error(`Compilación de ${s.name}.${stage}:\n${log}\n${ctx}`);
  }
  return new Error(`Enlace de ${s.name}: ${gl.getProgramInfoLog(s.p)}`);
}

/** Formato de una textura de color de un destino (los argumentos de `createTexture`). */
export interface TargetFormat {
  internal: number;
  format: number;
  type: number;
  filter: number;
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
  /** Formato de cada adjunto de color, en orden (para crear otro destino igual). */
  formats: readonly TargetFormat[];
  /** Adjuntos activos en `drawBuffers` (los primeros): los que escribe el programa que dibuja (`bindTargetFor`). */
  activeOutputs: number;
}

/**
 * Salidas de color de un shader de fragmentos: la mayor `layout(location = N) out` más uno, o las `out` sin
 * posición (WebGL2 admite una sola). WebGL rechaza el dibujo (INVALID_OPERATION, «Active draw buffers with
 * missing fragment shader outputs») si un adjunto activo del FBO no tiene salida en el shader, y entonces no
 * escribe nada: el destino conserva el cuadro anterior sin avisar.
 */
export function fragmentOutputCount(frag: string): number {
  let max = -1;
  for (const m of frag.matchAll(/layout\s*\(\s*location\s*=\s*(\d+)\s*\)\s*out\b/g)) max = Math.max(max, Number(m[1]));
  if (max >= 0) return max + 1;
  return /^\s*out\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+\w+\s*;/m.test(frag) ? 1 : 0;
}

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internal: number,
  format: number,
  type: number,
  filter: number,
): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('createTexture');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Libera el FBO y las texturas de un destino de render. */
export function deleteTarget(gl: WebGL2RenderingContext, t: RenderTarget): void {
  gl.deleteFramebuffer(t.fbo);
  for (const tex of t.textures) gl.deleteTexture(tex);
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, formats: readonly TargetFormat[]): RenderTarget {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const textures: WebGLTexture[] = [];
  const drawBuffers: number[] = [];
  formats.forEach((f, i) => {
    const t = createTexture(gl, width, height, f.internal, f.format, f.type, f.filter);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    textures.push(t);
    drawBuffers.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(drawBuffers);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`FBO incompleto: 0x${status.toString(16)}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, textures, width, height, formats: [...formats], activeOutputs: formats.length };
}

export function bindTarget(gl: WebGL2RenderingContext, t: RenderTarget | null, w?: number, h?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
  gl.viewport(0, 0, t ? t.width : (w ?? gl.drawingBufferWidth), t ? t.height : (h ?? gl.drawingBufferHeight));
}

/**
 * Pone el destino con activos solo los adjuntos que escribe el programa (`outputs`; el resto, NONE). Hace
 * falta cuando dos programas con distinto número de salidas dibujan en el mismo destino (A2 y A de la mirada
 * 0 y de la dirigida, decisión 58): con un adjunto activo sin salida, WebGL no dibuja.
 */
export function bindTargetFor(gl: WebGL2RenderingContext, t: RenderTarget, program: { outputs: number }): void {
  bindTarget(gl, t);
  setActiveOutputs(gl, t, program.outputs);
}

/** Adjuntos activos del destino ya puesto: los `n` primeros (se llama solo si cambia). */
export function setActiveOutputs(gl: WebGL2RenderingContext, t: RenderTarget, n: number): void {
  const count = Math.min(n, t.formats.length);
  if (t.activeOutputs === count) return;
  gl.drawBuffers(t.formats.map((_, i) => (i < count ? gl.COLOR_ATTACHMENT0 + i : gl.NONE)));
  t.activeOutputs = count;
}

export function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
