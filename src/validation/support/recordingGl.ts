/**
 * WebGL2 falso que registra lo que el renderizador real pide a la GPU: qué FBO está puesto, con qué
 * programa (y su nombre de shader) y qué textura hay en cada unidad en cada dibujo, los uniforms de
 * cada programa en ese momento, los adjuntos (formato y tamaño) de cada FBO y los FBO y programas
 * liberados. Un uniform subido con la ubicación de un programa que no es el puesto (WebGL lo rechaza con
 * INVALID_OPERATION y no lo sube) queda en `misuse`. Todo lo demás (parámetros de textura, lecturas) no
 * hace nada; los shaders «compilan», salvo el de `fail` (compilación o enlace fallidos, con su registro).
 * `calls` guarda en orden las extensiones pedidas, las compilaciones, los enlaces y las consultas de estado
 * (lo que bloquea en un navegador) y `programs`, los programas creados. Como WebGL, un dibujo con un
 * adjunto activo (`drawBuffers`) sin salida en el shader de fragmentos se rechaza: queda en `misuse` y no se
 * registra en `draws` (el destino conserva lo anterior). Lo usan `frameCost.test.ts`
 * (repeticiones de medida) y `compoundRenderer.test.ts` (anillo de miradas, programas por mirada y su
 * enlace en lote al arrancar, decisión 58).
 */
import { fragmentOutputCount } from '../../ultrasound/gl';

export function recordingGl(
  canvasSize: { width: number; height: number },
  opts: { fail?: { frag: string; stage: 'compile' | 'link' } } = {},
) {
  const K: Record<string, number> = {
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
    NONE: 0,
    NO_ERROR: 0,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    TEXTURE_3D: 0x806f,
  };
  let nextConst = 0x10000;
  let nextId = 1;
  type Obj = { kind: string; id: number };
  const make = (kind: string): Obj => ({ kind, id: nextId++ });
  const state = {
    fbo: null as Obj | null,
    program: null as Obj | null,
    unit: 0,
    units: new Map<number, Obj | null>(),
    viewport: [0, 0, 0, 0] as number[],
  };
  const texInfo = new Map<Obj, { internal: number; w: number; h: number; d?: number }>();
  const attachments = new Map<Obj, { internal: number; w: number; h: number }[]>();
  const draws: {
    fbo: Obj | null;
    program: Obj | null;
    units: string;
    viewport: number[];
    /** Fuente del shader de fragmentos del programa del dibujo. */
    frag: string;
    /** Uniforms del programa en el momento del dibujo (valores como números). */
    uniforms: Record<string, number[]>;
  }[] = [];
  const sources = new Map<Obj, string>();
  const fragOf = new Map<Obj, string>();
  const uniformsOf = new Map<Obj, Map<string, number[]>>();
  type Loc = Obj & { name: string; program: Obj };
  const misuse: string[] = [];
  const setUniform = (loc: Loc | null, values: number[]): void => {
    if (!loc) return;
    if (loc.program !== state.program) {
      misuse.push(`${loc.name}: ubicación del programa ${loc.program.id} con el ${state.program?.id ?? '—'} puesto`);
      return;
    }
    const m = uniformsOf.get(loc.program) ?? new Map<string, number[]>();
    m.set(loc.name, values);
    uniformsOf.set(loc.program, m);
  };
  const binds: (Obj | null)[] = [];
  /** Adjuntos activos de cada FBO (`drawBuffers`); sin llamada, todos los que tenga (como `createTarget`). */
  const drawBuffersOf = new Map<Obj, number[]>();
  const fboTextures = new Map<Obj, Obj[]>();
  const deleted = new Set<Obj>();
  const calls: string[] = [];
  const programs: Obj[] = [];
  const fail = opts.fail;
  const failsCompile = (src: string | undefined) => fail?.stage === 'compile' && src === fail.frag;
  const methods: Record<string, (...a: never[]) => unknown> = {
    getError: () => K.NO_ERROR,
    getParameter: (p: number) => (p === K.MAX_3D_TEXTURE_SIZE ? 2048 : 0),
    texImage3D: (_t: number, _l: number, internal: number, w: number, h: number, d: number) => {
      const tex = state.units.get(state.unit);
      if (tex) texInfo.set(tex, { internal, w, h, d });
    },
    deleteTexture: (tex: Obj) => void deleted.add(tex),
    getExtension: (name: string) => {
      calls.push(`getExtension:${name}`);
      return name === 'EXT_color_buffer_float' || name === 'OES_texture_float_linear' ? {} : null;
    },
    compileShader: () => void calls.push('compileShader'),
    linkProgram: () => void calls.push('linkProgram'),
    getShaderParameter: (sh: Obj) => {
      calls.push('getShaderParameter');
      return !failsCompile(sources.get(sh));
    },
    getProgramParameter: (p: Obj) => {
      calls.push('getProgramParameter');
      return !(fail && fragOf.get(p) === fail.frag);
    },
    getShaderInfoLog: (sh: Obj) => (failsCompile(sources.get(sh)) ? 'ERROR: 0:2: falso' : ''),
    getProgramInfoLog: (p: Obj) => (fail && fragOf.get(p) === fail.frag ? 'enlace falso' : ''),
    checkFramebufferStatus: () => K.FRAMEBUFFER_COMPLETE,
    getUniformLocation: (p: Obj, name: string): Loc => ({ ...make('loc'), name, program: p }),
    createShader: () => make('shader'),
    shaderSource: (sh: Obj, src: string) => void sources.set(sh, src),
    // el segundo shader que se une es el de fragmentos (GLProgram: vértices y fragmentos, en ese orden)
    attachShader: (p: Obj, sh: Obj) => void fragOf.set(p, sources.get(sh) ?? ''),
    uniform1f: (l: Loc, a: number) => setUniform(l, [a]),
    uniform1i: (l: Loc, a: number) => setUniform(l, [a]),
    uniform2f: (l: Loc, a: number, b: number) => setUniform(l, [a, b]),
    uniform3f: (l: Loc, a: number, b: number, c: number) => setUniform(l, [a, b, c]),
    uniform4f: (l: Loc, a: number, b: number, c: number, d: number) => setUniform(l, [a, b, c, d]),
    uniform1fv: (l: Loc, v: ArrayLike<number>) => setUniform(l, Array.from(v)),
    uniform3fv: (l: Loc, v: ArrayLike<number>) => setUniform(l, Array.from(v)),
    uniform4fv: (l: Loc, v: ArrayLike<number>) => setUniform(l, Array.from(v)),
    createProgram: () => {
      const p = make('program');
      programs.push(p);
      return p;
    },
    createTexture: () => make('texture'),
    createFramebuffer: () => make('fbo'),
    createBuffer: () => make('buffer'),
    createQuery: () => make('query'),
    fenceSync: () => make('sync'),
    useProgram: (p: Obj) => void (state.program = p),
    activeTexture: (u: number) => void (state.unit = u - K.TEXTURE0),
    bindTexture: (_t: number, tex: Obj | null) => void state.units.set(state.unit, tex),
    texImage2D: (_t: number, _l: number, internal: number, w: number, h: number) => {
      const tex = state.units.get(state.unit);
      if (tex) texInfo.set(tex, { internal, w, h });
    },
    bindFramebuffer: (_t: number, fbo: Obj | null) => {
      state.fbo = fbo;
      binds.push(fbo);
    },
    framebufferTexture2D: (_t: number, att: number, _tt: number, tex: Obj) => {
      const list = attachments.get(state.fbo!) ?? [];
      list[att - K.COLOR_ATTACHMENT0] = texInfo.get(tex)!;
      attachments.set(state.fbo!, list);
      const texs = fboTextures.get(state.fbo!) ?? [];
      texs[att - K.COLOR_ATTACHMENT0] = tex;
      fboTextures.set(state.fbo!, texs);
    },
    deleteFramebuffer: (fbo: Obj) => void deleted.add(fbo),
    deleteProgram: (p: Obj) => void deleted.add(p),
    viewport: (...v: number[]) => void (state.viewport = v),
    drawBuffers: (bufs: number[]) => void (state.fbo && drawBuffersOf.set(state.fbo, [...bufs])),
    drawArrays: () => {
      const p0 = state.program;
      if (state.fbo && p0) {
        const outputs = fragmentOutputCount(fragOf.get(p0) ?? '');
        const active = (drawBuffersOf.get(state.fbo) ?? []).map((b, i) => (b === K.NONE ? -1 : i)).filter((i) => i >= 0);
        const missing = active.filter((i) => i >= outputs);
        if (missing.length) {
          misuse.push(`dibujo rechazado: adjuntos activos ${missing.join(',')} sin salida en el programa ${p0.id} (${outputs} salidas)`);
          return;
        }
      }
      const units = [...state.units.entries()]
        .filter(([, t]) => t)
        .sort(([a], [b]) => a - b)
        .map(([u, t]) => `${u}:${t!.id}`)
        .join(' ');
      const p = state.program;
      draws.push({
        fbo: state.fbo,
        program: p,
        units,
        viewport: state.viewport,
        frag: p ? (fragOf.get(p) ?? '') : '',
        uniforms: Object.fromEntries(p ? (uniformsOf.get(p) ?? []) : []),
      });
    },
  };
  const gl = new Proxy(
    { drawingBufferWidth: canvasSize.width, drawingBufferHeight: canvasSize.height },
    {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) return target[prop];
        if (prop in methods) return methods[prop];
        if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return (K[prop] ??= nextConst++);
        return () => undefined;
      },
    },
  );
  const canvas = { ...canvasSize, getContext: () => gl } as unknown as HTMLCanvasElement;
  /** Textura de cada FBO por adjunto (para saber qué destino lee cada unidad). */
  return { canvas, draws, binds, attachments, deleted, fboTextures, misuse, calls, programs };
}
