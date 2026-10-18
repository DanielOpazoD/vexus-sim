import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { buildProvenance, provenanceFile } from '../../tools/build/provenance';
import { feedbackGitEnvironment } from '../../tools/workspace/feedbackPlan';
import { verifyLocalBuild, verifyPreviewBuild } from '../../tools/workspace/previewBuild';
import { listenLoopback } from '../../tools/workspace/loopback';

it('vincula un build real a su fuente y rechaza ediciones, recursos alterados y otra preview antes de usar GPU', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vexus-build-'));
  const output = join(root, '.cache/run');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: feedbackGitEnvironment(), stdio: 'ignore' });
  let changedResource = '',
    otherReceipt = false,
    redirect = false;
  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url!.slice(1));
    if (redirect) {
      response.writeHead(302, { Location: '/elsewhere' });
      response.end();
      return;
    }
    if (otherReceipt && path === provenanceFile) {
      response.end('{}');
      return;
    }
    if (path === changedResource) {
      response.end('altered');
      return;
    }
    try {
      response.end(readFileSync(join(root, 'dist', path)));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  try {
    writeFileSync(join(root, '.gitignore'), 'dist/\n.cache/\n');
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
    writeFileSync(join(root, 'main.js'), 'document.body.textContent = "fixture";');
    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture');
    await build({ root, configFile: false, logLevel: 'silent', plugins: [buildProvenance()], build: { sourcemap: true } });
    const receipt = verifyLocalBuild(root, output).receipt;
    expect(receipt.files.some((file) => file.path.endsWith('.js.map'))).toBe(true);
    await listenLoopback(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server');
    const origin = `http://127.0.0.1:${address.port}`;
    const verified = await verifyPreviewBuild(root, origin, output);
    expect(verified.source).toEqual(receipt.source);
    expect(verified.files).toBe(receipt.files.length);
    expect(verified.bytes).toBe(receipt.files.reduce((sum, file) => sum + file.bytes, 0));

    otherReceipt = true;
    await expect(verifyPreviewBuild(root, origin, output)).rejects.toThrow('otro build');
    otherReceipt = false;
    changedResource = receipt.files.find((file) => file.path.endsWith('.js.map'))!.path;
    await expect(verifyPreviewBuild(root, origin, output)).rejects.toThrow('recurso distinto');
    changedResource = '';
    redirect = true;
    await expect(verifyPreviewBuild(root, origin, output)).rejects.toThrow();
    redirect = false;

    writeFileSync(join(root, 'main.js'), 'document.body.textContent = "edited";');
    expect(() => verifyLocalBuild(root, output)).toThrow('anterior a la última edición');
    writeFileSync(join(root, 'main.js'), 'document.body.textContent = "fixture";');
    const resource = join(root, 'dist', 'index.html');
    const html = readFileSync(resource);
    writeFileSync(resource, 'old HTML');
    expect(() => verifyLocalBuild(root, output)).toThrow('recursos de dist cambiaron');
    writeFileSync(resource, html);
    rmSync(join(root, 'dist', provenanceFile));
    expect(() => verifyLocalBuild(root, output)).toThrow('ENOENT');
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          buildProvenance(),
          {
            name: 'edit-during-build',
            generateBundle() {
              writeFileSync(join(root, 'main.js'), 'changed during build');
            },
          },
        ],
      }),
    ).rejects.toThrow('La fuente cambió durante el build');
    expect(() => readFileSync(join(root, 'dist', provenanceFile))).toThrow('ENOENT');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error && server.listening ? reject(error) : resolve())));
    rmSync(root, { recursive: true, force: true });
  }
});
