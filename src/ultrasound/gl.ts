/** Utilidades WebGL2 mínimas: programas, texturas flotantes y FBO. */
export class GLProgram {
  readonly program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(
    readonly gl: WebGL2RenderingContext,
    vert: string,
    frag: string,
    readonly name: string,
  ) {
    const vs = compile(gl, gl.VERTEX_SHADER, vert, name + '.vert');
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag, name + '.frag');
    const p = gl.createProgram();
    if (!p) throw new Error('createProgram');
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Enlace de ${name}: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = p;
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

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log);
    const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
    throw new Error(`Compilación de ${name}:\n${log}\n${ctx}`);
  }
  return s;
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
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

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  formats: Array<{ internal: number; format: number; type: number; filter: number }>,
): RenderTarget {
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
  return { fbo, textures, width, height };
}

export function bindTarget(gl: WebGL2RenderingContext, t: RenderTarget | null, w?: number, h?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
  gl.viewport(0, 0, t ? t.width : (w ?? gl.drawingBufferWidth), t ? t.height : (h ?? gl.drawingBufferHeight));
}

export function drawFullscreen(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
