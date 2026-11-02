import type { BModeSettings, CineFrame, ColorSettings, FrameInputs } from '../src/ultrasound/renderer';
import type { RenderTarget } from '../src/ultrasound/gl';
import type { Transducer } from '../src/probe/probe';

/** Acceso diagnóstico a las pasadas reales; no sustituye el renderizador ni su shader. */
export interface SpeckleInternals {
  speckleReduction(b: BModeSettings, c: ColorSettings, tr: Transducer): void;
  scanConvert(b: BModeSettings, c: ColorSettings, cf: CineFrame['colorFrame'], tr: Transducer): void;
  passPersistence(inputs: Pick<FrameInputs, 'bmode' | 'color'>): void;
  present(target: RenderTarget): void;
  tEnv: RenderTarget;
  tColor: RenderTarget;
  tScan: RenderTarget;
  tPersist: [RenderTarget, RenderTarget];
  persistIndex: number;
  persistSpeckle: number;
}

/** Banco pos-PSF de la revisión: rejilla nativa, tres fases sublínea, medido tras G. */
export function detailWitnesses() {
  const s = window.__vexusTest!.sim();
  const r = s.renderer;
  const p = r as unknown as SpeckleInternals;
  const gl = r.gl;
  const W = p.tEnv.width,
    H = p.tEnv.height;
  const b = { ...s.bmode, persistence: 0, gainDb: -10 };
  const c = { ...s.color, enabled: false };
  const row = Math.floor((80 / b.depthMm) * H);
  const rr = ((row + 0.5) * b.depthMm) / H;
  const dx = (2 * s.transducer.halfSector * (s.transducer.curvatureRadius + rr)) / W;
  const erf = (x: number) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    return (
      Math.sign(x) *
      (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x))
    );
  };
  const cdf = (x: number) => 0.5 * (1 + erf(x / Math.sqrt(2)));
  const sigma = 1.5 / 2.355;
  const rows = [];
  for (const kind of ['edge', 'vessel', 'line03', 'line06'])
    for (const shift of [0, 0.25, 0.5]) {
      const env = new Float32Array(W * H);
      for (let x = 0; x < W; x++) {
        const xx = (x - W / 2 + shift) * dx;
        const width = kind === 'vessel' ? 3 : kind === 'line03' ? 0.3 : 0.6;
        const amp =
          kind === 'edge'
            ? 10 ** (-12 / 20) + (1 - 10 ** (-12 / 20)) * cdf(xx / sigma)
            : 1 +
              ((kind === 'vessel' ? 10 ** (-18 / 20) : 10 ** (15 / 20)) - 1) *
                (cdf((xx + width / 2) / sigma) - cdf((xx - width / 2) / sigma));
        // Como en la reproducción por G: repetir el perfil pos-PSF de esta profundidad.
        for (let y = 0; y < H; y++) env[y * W + x] = amp;
      }
      gl.bindTexture(gl.TEXTURE_2D, p.tEnv.textures[0]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.FLOAT, env);
      const levels = [];
      for (const level of [0, 1, 2] as const) {
        const bb = { ...b, speckleReduction: level };
        p.speckleReduction(bb, c, s.transducer);
        p.scanConvert(bb, c, null, s.transducer);
        p.present(p.tScan);
        const img = r.readDisplay();
        const profile = [];
        for (let i = 0; i <= 480; i++) {
          const mm = -6 + i * 0.025;
          const pt = r.beamToPixel(mm / (s.transducer.curvatureRadius + rr), rr, s.transducer);
          const x = Math.floor(pt.x - 0.5),
            y = Math.floor(pt.y - 0.5);
          const a = pt.x - 0.5 - x,
            d = pt.y - 0.5 - y;
          const gray =
            (1 - d) * ((1 - a) * img.gray[y * img.width + x] + a * img.gray[y * img.width + x + 1]) +
            d * ((1 - a) * img.gray[(y + 1) * img.width + x] + a * img.gray[(y + 1) * img.width + x + 1]);
          profile.push({ mm, gray });
        }
        levels.push({ level, profile });
      }
      rows.push({ kind, shift, levels });
    }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    rows,
    size: [W, H],
    row,
    rr,
    dx,
    greyCurve: 3.5,
    renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '',
    glError: gl.getError(),
  };
}

export function detailMetrics(result: ReturnType<typeof detailWitnesses>) {
  const width = (x: number[], v: number[]) => {
    const cross = [0.1, 0.9].map((t) => {
      const q = v[0] + t * (v[v.length - 1] - v[0]);
      const indices = x
        .slice(0, -1)
        .map((_, i) => i)
        .filter((i) => (v[i] - q) * (v[i + 1] - q) <= 0);
      const i = indices.sort((a, b) => Math.abs(x[a]) - Math.abs(x[b]))[0];
      return x[i] + ((q - v[i]) / (v[i + 1] - v[i])) * (x[i + 1] - x[i]);
    });
    return Math.abs(cross[1] - cross[0]);
  };
  return [1, 2].map((level) => {
    const edges: number[] = [],
      contrasts: number[] = [],
      peaks: number[] = [];
    for (const f of result.rows) {
      const x = f.levels[0].profile.map((q) => q.mm);
      // Inversa de la curva del producto. Los términos aditivos se cancelan al medir diferencias en dB.
      const db = f.levels.map((l) => l.profile.map((q) => (70 * Math.log1p((3.5 * q.gray) / 255)) / Math.log(4.5)));
      const p = db[0],
        q = db[level];
      if (f.kind === 'edge') edges.push(width(x, q) - width(x, p));
      else if (f.kind === 'vessel')
        contrasts.push((Math.max(q[0], q[q.length - 1]) - Math.min(...q)) / (Math.max(p[0], p[p.length - 1]) - Math.min(...p)));
      else peaks.push((Math.max(...q) - Math.min(q[0], q[q.length - 1])) / (Math.max(...p) - Math.min(p[0], p[p.length - 1])));
    }
    return { level, edgeDeltaMaxMm: Math.max(...edges), contrastMin: Math.min(...contrasts), peakMin: Math.min(...peaks) };
  });
}
