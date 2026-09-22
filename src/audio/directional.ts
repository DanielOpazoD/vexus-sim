/**
 * Separación direccional del audio Doppler a partir de la MISMA IQ filtrada
 * (base D.9): z⁺ = (z + j·H{z})/2 contiene solo frecuencias positivas (flujo
 * que se acerca), z⁻ = (z − j·H{z})/2 las negativas. Re(z⁺) y Re(z⁻) son
 * señales reales audibles cuya frecuencia coincide con el desplazamiento
 * Doppler físico. H es un transformador de Hilbert FIR (odd-length, ventana
 * Hamming) aplicado en streaming; su retardo de grupo (M−1)/2 muestras se
 * compensa retrasando z.
 */
export class DirectionalAudio {
  private readonly taps: Float32Array;
  private readonly M: number;
  private readonly delay: number;
  private histRe: Float32Array;
  private histIm: Float32Array;
  private pos = 0;

  constructor(taps = 63) {
    if (taps % 2 === 0) taps += 1;
    this.M = taps;
    this.delay = (taps - 1) >> 1;
    this.taps = new Float32Array(taps);
    for (let n = 0; n < taps; n++) {
      const k = n - this.delay;
      if (k % 2 !== 0) {
        const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (taps - 1));
        this.taps[n] = (2 / (Math.PI * k)) * w;
      }
    }
    this.histRe = new Float32Array(taps);
    this.histIm = new Float32Array(taps);
  }

  /**
   * Procesa n muestras IQ y escribe las señales de avance (`fwd`) y retroceso
   * (`rev`) a la misma tasa de muestreo (PRF).
   */
  process(re: Float32Array, im: Float32Array, n: number, fwd: Float32Array, rev: Float32Array): void {
    const M = this.M;
    for (let i = 0; i < n; i++) {
      this.histRe[this.pos] = re[i];
      this.histIm[this.pos] = im[i];
      // Convolución circular sobre el historial. Solo hace falta H{Im z}:
      // j·H{z} = j·(H{Re z} + j·H{Im z}) = −H{Im z} + j·H{Re z}, y las partes
      // reales de z± solo involucran −/+ H{Im z}.
      let hi = 0;
      for (let k = 0; k < M; k++) {
        const c = this.taps[k];
        if (c !== 0) hi += c * this.histIm[(this.pos - k + M) % M];
      }
      // z retrasado por el retardo de grupo
      const zr = this.histRe[(this.pos - this.delay + M) % M];
      // z⁺ = (z + jH)/2 → Re = (zr − hi)/2 ; z⁻ = (z − jH)/2 → Re = (zr + hi)/2
      fwd[i] = 0.5 * (zr - hi);
      rev[i] = 0.5 * (zr + hi);
      this.pos = (this.pos + 1) % M;
    }
  }

  reset(): void {
    this.histRe.fill(0);
    this.histIm.fill(0);
    this.pos = 0;
  }
}
