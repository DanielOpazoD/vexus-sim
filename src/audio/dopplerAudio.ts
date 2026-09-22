import { DirectionalAudio } from './directional';

/**
 * Salida de audio Doppler (guía §12): el mismo bloque IQ filtrado que alimenta
 * el espectrograma pasa por la separación direccional y se envía al
 * AudioWorklet, que lo remuestrea a la tasa del dispositivo. El audio se
 * activa solo por acción del usuario (política de reproducción automática).
 */
export class DopplerAudio {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private readonly separator = new DirectionalAudio(63);
  private fwd = new Float32Array(4096);
  private rev = new Float32Array(4096);
  private _enabled = false;
  private _volume = 0.6;
  private gainNode: GainNode | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  get volume(): number {
    return this._volume;
  }

  async enable(): Promise<void> {
    if (this._enabled) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}doppler-worklet.js`);
      this.node = new AudioWorkletNode(this.ctx, 'doppler-processor', { outputChannelCount: [2] });
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1;
      this.node.connect(this.gainNode).connect(this.ctx.destination);
      this.node.port.postMessage({ type: 'volume', value: this._volume });
    }
    await this.ctx.resume();
    this._enabled = true;
  }

  async disable(): Promise<void> {
    if (!this._enabled) return;
    this._enabled = false;
    await this.ctx?.suspend();
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this.node?.port.postMessage({ type: 'volume', value: this._volume });
  }

  /** Recibe un bloque IQ (ya filtrado) a la PRF indicada. */
  pushIQ(re: Float32Array, im: Float32Array, n: number, prfHz: number): void {
    if (n > this.fwd.length) {
      this.fwd = new Float32Array(n);
      this.rev = new Float32Array(n);
    }
    this.separator.process(re, im, n, this.fwd, this.rev);
    if (!this._enabled || !this.node) return;
    // Normalización de nivel: la IQ tiene amplitud arbitraria; se comprime suavemente.
    const f = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      f[i] = Math.tanh(this.fwd[i] * 6);
      r[i] = Math.tanh(this.rev[i] * 6);
    }
    this.node.port.postMessage({ type: 'block', prf: prfHz, fwd: f, rev: r }, [f.buffer, r.buffer]);
  }

  reset(): void {
    this.separator.reset();
    this.node?.port.postMessage({ type: 'reset' });
  }
}
