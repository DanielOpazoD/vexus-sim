import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const prefix = '[e2e:begin] ';
const sourceSha = 'b'.repeat(40);
const children = new Set<ChildProcess>();
const directories = new Set<string>();
afterEach(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  children.clear();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

function fixture(body: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'vexus-e2e-start-')));
  directories.add(directory);
  const config = join(directory, 'playwright.config.cjs');
  const report = join(directory, 'report.json');
  writeFileSync(
    config,
    `module.exports = ${JSON.stringify({
      testDir: directory,
      testMatch: 'probe.spec.cjs',
      workers: 1,
      retries: 0,
      timeout: 10_000,
      reporter: [[resolve('tools/ci/e2eStartReporter.ts')], ['list'], ['json', { outputFile: report }]],
    })};`,
  );
  writeFileSync(
    join(directory, 'probe.spec.cjs'),
    `const {test, expect} = require(${JSON.stringify(resolve('node_modules/@playwright/test'))});\n${body}`,
  );
  return {
    args: [resolve('node_modules/@playwright/test/cli.js'), 'test', '--config', config],
    env: { ...process.env, E2E_SOURCE_SHA: sourceSha, FORCE_COLOR: '0' },
    report,
  };
}

function entries(output: string): unknown[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)) as unknown);
}

it('Playwright publica cada inicio antes del cuerpo y conserva el fallo y su código de salida', () => {
  const run = fixture(`
    test('completed', () => { console.log('first-body'); });
    test('failed', () => { console.log('second-body'); expect(1).toBe(2); });
  `);
  const child = spawnSync(process.execPath, run.args, { env: run.env, encoding: 'utf8', timeout: 20_000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(1);
  const events = entries(child.stdout);
  expect(events).toHaveLength(2);
  for (const event of events) {
    expect(event).toMatchObject({ sourceSha, file: 'probe.spec.cjs', retry: 0 });
    expect(event).toHaveProperty('testId', expect.any(String));
  }
  expect(events[0]).toHaveProperty('title', expect.arrayContaining(['completed']));
  expect(events[1]).toHaveProperty('title', expect.arrayContaining(['failed']));
  expect(child.stdout.indexOf(prefix)).toBeLessThan(child.stdout.indexOf('first-body'));
  expect(child.stdout.lastIndexOf(prefix)).toBeLessThan(child.stdout.indexOf('second-body'));
  expect(JSON.parse(readFileSync(run.report, 'utf8')) as unknown).toMatchObject({ stats: { expected: 1, unexpected: 1, flaky: 0 } });
});

it('conserva la identidad del intento en curso cuando se interrumpe realmente el runner', async () => {
  const run = fixture(`test('interrupted', async () => {
    console.log('interrupt-ready');
    await new Promise(() => {});
  });`);
  const child = spawn(process.execPath, run.args, {
    env: run.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20_000,
  });
  children.add(child);
  let output = '',
    stderr = '',
    interrupted = false;
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    if (!interrupted && output.includes('interrupt-ready')) {
      interrupted = true;
      child.kill('SIGINT');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exit = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolveExit(code));
  });
  expect(interrupted, stderr).toBe(true);
  expect(exit).not.toBe(0);
  const events = entries(output);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ sourceSha, file: 'probe.spec.cjs', retry: 0 });
  expect(events[0]).toHaveProperty('title', expect.arrayContaining(['interrupted']));
  expect(output.indexOf(prefix)).toBeLessThan(output.indexOf('interrupt-ready'));
});
