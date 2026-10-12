import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { startupEvidenceSink } from '../../tools/ci/e2eStartupEvidence';

const identity = { sourceSha: 'a'.repeat(40), testId: 'selection/chromium', retry: 0, query: '?e2e=app&reference=1' };

describe('Evidencia de arranque conservada en el host', () => {
  it('conserva la última etapa tras terminar el proceso escritor sin informe final', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vexus-startup-'));
    try {
      const output = join(directory, 'evidence.jsonl');
      const script = `import {startupEvidenceSink} from ${JSON.stringify(pathToFileURL(resolve('tools/ci/e2eStartupEvidence.ts')).href)};
        const emit = startupEvidenceSink(${JSON.stringify(output)}, ${JSON.stringify(identity)});
        emit({type:'boot:begin'});
        emit({type:'boot:stage',entry:{stage:'navigator:construct',timeMs:120}});
        process.kill(process.pid, 'SIGTERM');`;
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
      expect(child.signal, child.stderr.toString()).toBe('SIGTERM');
      const lines = readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({ ...identity, type: 'boot:stage', entry: { stage: 'navigator:construct', timeMs: 120 } });
      expect(lines.some((line) => line.type === 'boot:end')).toBe(false);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it('distingue intentos y conserva finalizaciones fallidas sin convertirlas en éxito', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vexus-startup-'));
    try {
      const output = join(directory, 'evidence.jsonl');
      let hostMs = 10;
      const failed = startupEvidenceSink(output, identity, () => hostMs);
      failed({ type: 'boot:begin' });
      hostMs = 25;
      failed({ type: 'boot:end', completed: false });
      startupEvidenceSink(output, { ...identity, retry: 1 }, () => 100)({ type: 'boot:end', completed: true });
      const lines = readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines[1]).toMatchObject({ retry: 0, completed: false, hostElapsedMs: 15 });
      expect(lines[2]).toMatchObject({ retry: 1, completed: true, hostElapsedMs: 0 });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it('sin destino no toca disco ni reloj; con destino exige procedencia explícita', () => {
    const now = vi.fn();
    startupEvidenceSink(undefined, identity, now)({ type: 'boot:begin' });
    expect(now).not.toHaveBeenCalled();
    for (const invalid of [
      { ...identity, sourceSha: 'unknown' },
      { ...identity, testId: '' },
      { ...identity, retry: -1 },
    ])
      expect(() => startupEvidenceSink('/unused/evidence.jsonl', invalid)).toThrow('Invalid startup evidence identity');
  });
});
