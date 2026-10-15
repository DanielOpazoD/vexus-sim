import { errorLog } from './errorLog';

type Release = () => void;

/** Preparación exclusiva por origen; las adquisiciones ya preparadas comparten la GPU. */
export class GpuPageTurns {
  #current: Release | null = null;
  #next: Release | null = null;
  #submittedFrame = false;
  #preparingFrames = 2;
  #disabled = false;
  readonly #abort = new AbortController();
  readonly #held = new Set<Release>();

  readonly #locks: Pick<LockManager, 'request'> | undefined;
  readonly #report: (error: unknown) => void;

  constructor(locks: Pick<LockManager, 'request'> | undefined, report: (error: unknown) => void) {
    this.#locks = locks;
    this.#report = report;
  }

  async prepare(): Promise<void> {
    this.#current = await this.#lease('exclusive');
  }

  get ready(): boolean {
    return !this.#locks || this.#disabled || this.#current !== null;
  }

  /** Una reserva anticipada evita añadir una RAF a la cadencia nativa. */
  submitted(): void {
    if (!this.#locks || this.#disabled) return;
    this.#submittedFrame = true;
    // The first two ordinary acquisitions exercise the central and steered
    // programs. Keep their lazy software-pipeline compilation exclusive too.
    if (this.#preparingFrames > 1) return;
    void this.#lease('shared').then((release) => {
      if (!release) return;
      if (!this.#current && !this.#submittedFrame) this.#current = release;
      else this.#next = release;
    });
  }

  /** Solo después de que la valla real haya terminado, también si cedemos una RAF. */
  completed(): void {
    if (!this.#submittedFrame) return;
    this.#submittedFrame = false;
    if (!this.#disabled && this.#preparingFrames > 0 && --this.#preparingFrames > 0) return;
    this.#current?.();
    this.#current = this.#disabled ? null : this.#next;
    this.#next = null;
  }

  dispose(drainCurrent = false): void {
    this.#disabled = true;
    this.#abort.abort();
    for (const release of this.#held) if (!drainCurrent || release !== this.#current) release();
    if (!drainCurrent) this.#current = null;
    this.#next = null;
  }

  #lease(mode: LockMode): Promise<Release | null> {
    if (!this.#locks || this.#disabled) return Promise.resolve(null);
    return new Promise((resolve) => {
      void Promise.resolve()
        .then(() =>
          this.#locks!.request('vexus-gpu-preparation', { mode, signal: this.#abort.signal }, () => {
            if (this.#disabled) {
              resolve(null);
              return;
            }
            return new Promise<void>((done) => {
              const release = () => {
                if (this.#held.delete(release)) done();
              };
              this.#held.add(release);
              resolve(release);
            });
          }),
        )
        .catch((error: unknown) => {
          resolve(null);
          if (!this.#abort.signal.aborted) {
            this.dispose(this.#submittedFrame);
            this.#report(error);
          }
        });
    });
  }
}

export const gpuPageTurns = new GpuPageTurns(typeof navigator === 'undefined' ? undefined : navigator.locks, (error) =>
  errorLog.report('gpu', error),
);
