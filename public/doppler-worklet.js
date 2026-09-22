/**
 * AudioWorklet del audio Doppler. Recibe bloques de señal real de avance y
 * retroceso muestreados a la PRF (≈ 1–5 kHz) y los remuestrea a la tasa del
 * dispositivo por interpolación cúbica (Catmull–Rom) con un pequeño búfer de
 * latencia. El tono es la frecuencia Doppler física: no hay osciladores ni
 * archivos de sonido. Estéreo docente: avance → izquierda, retroceso → derecha.
 */
class DopplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.prf = 2500;
    this.fwd = new Float32Array(0);
    this.rev = new Float32Array(0);
    this.readPos = 0; // posición fraccionaria en muestras PRF
    this.targetLatency = 0.08; // s
    this.volume = 0.6;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'block') {
        this.prf = d.prf;
        this.append(d.fwd, d.rev);
      } else if (d.type === 'volume') {
        this.volume = d.value;
      } else if (d.type === 'reset') {
        this.fwd = new Float32Array(0);
        this.rev = new Float32Array(0);
        this.readPos = 0;
      }
    };
  }

  append(fwd, rev) {
    // Descarta lo ya consumido (mantiene 4 muestras de historial para la interpolación)
    const keepFrom = Math.max(0, Math.floor(this.readPos) - 4);
    const nf = new Float32Array(this.fwd.length - keepFrom + fwd.length);
    nf.set(this.fwd.subarray(keepFrom));
    nf.set(fwd, this.fwd.length - keepFrom);
    const nr = new Float32Array(this.rev.length - keepFrom + rev.length);
    nr.set(this.rev.subarray(keepFrom));
    nr.set(rev, this.rev.length - keepFrom);
    this.fwd = nf;
    this.rev = nr;
    this.readPos -= keepFrom;
    // Si el retraso acumulado supera el objetivo, adelantamos la lectura.
    const backlog = (this.fwd.length - this.readPos) / this.prf;
    if (backlog > this.targetLatency * 2.5) this.readPos = this.fwd.length - this.targetLatency * this.prf;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : null;
    const step = this.prf / sampleRate;
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const p = this.readPos;
      const i1 = Math.floor(p);
      if (i1 + 2 >= this.fwd.length || i1 < 1) {
        L[i] = 0;
        if (R) R[i] = 0;
        continue;
      }
      const t = p - i1;
      L[i] = this.volume * catmull(this.fwd, i1, t);
      if (R) R[i] = this.volume * catmull(this.rev, i1, t);
      this.readPos = p + step;
    }
    return true;
  }
}

function catmull(a, i1, t) {
  const p0 = a[i1 - 1];
  const p1 = a[i1];
  const p2 = a[i1 + 1];
  const p3 = a[i1 + 2];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

registerProcessor('doppler-processor', DopplerProcessor);
