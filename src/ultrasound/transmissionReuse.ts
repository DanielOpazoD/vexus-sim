/** Una instantánea exacta de las entradas GPU preparadas de A0/A1, sin hashes ni identidades de objetos. */
export class TransmissionReuse {
  private saved: Float32Array[] | null = null;

  matches(blocks: readonly Float32Array[]): boolean {
    const saved = this.saved;
    return (
      saved !== null &&
      saved.length === blocks.length &&
      blocks.every(
        (block, i) =>
          block.length === saved[i].length && block.every((value, j) => Number.isFinite(value) && Object.is(value, saved[i][j])),
      )
    );
  }

  /** Confirmar solo después de enviar correctamente las dos pasadas de salida. */
  remember(blocks: readonly Float32Array[]): void {
    this.saved = blocks.map((block) => block.slice());
  }

  clear(): void {
    this.saved = null;
  }
}
