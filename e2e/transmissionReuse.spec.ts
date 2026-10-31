import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { comparisonState } from '../tools/fidelity/comparisonState';
import { BOOT_MS, budget } from './support';

test('A0/A1 reutilizados conservan todos sus bytes tras movimiento, profundidad, consulta y evolución', async ({ page }, info) => {
  // Un arranque y quince renders ordinarios; el registro completo se prueba aparte (registeredComparison).
  // 180 s de trabajo más el presupuesto de arranque existente; sin retries.
  budget(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?e2e=app&abdomen=atlas');
  await page.waitForFunction(() => (window.__vexusTest?.framesRendered() ?? 0) >= 2, undefined, { timeout: BOOT_MS });
  await page.evaluate(comparisonState, { phase: 'prepare' as const, targetSeconds: 5 });
  const evidence: Array<{ state: string; hashes: string[]; serial: number; time: number; depthMm: number }> = [];
  for (const state of ['base', 'motion', 'depth', 'query', 'time'] as const) {
    if (state === 'depth')
      await page.getByLabel('Profundidad', { exact: true }).evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '160';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const result = await page.evaluate((state) => {
      const hooks = window.__vexusTest!,
        sim = hooks.sim(),
        r = sim.renderer,
        gl = r.gl;
      const button = document.querySelector<HTMLButtonElement>('#freeze')!;
      if (!sim.frozen || sim.color.enabled || !sim.bmode.compound || sim.patient.respiratoryPattern !== 'apnea-expiratory')
        throw new Error('La comparación exige B compuesto congelado en apnea');
      type Pass = 'transmissionHits' | 'transmissionSegments';
      type Target = { fbo: WebGLFramebuffer; width: number; height: number; textures: WebGLTexture[] };
      const reuse = Reflect.get(r, 'transmissionReuse') as { clear(): void };
      const passes = Reflect.get(r, 'passes') as Record<Pass, (inputs: unknown) => void>;
      const hits = Reflect.get(r, 'tHits') as Target,
        segments = Reflect.get(r, 'tSeg') as Target;
      if (typeof reuse?.clear !== 'function' || hits?.textures.length !== 3 || segments?.textures.length !== 1)
        throw new Error('Contrato de los cuatro adjuntos A0/A1 no disponible');
      const originals = { transmissionHits: passes.transmissionHits, transmissionSegments: passes.transmissionSegments };
      const calls: Record<Pass, number> = { transmissionHits: 0, transmissionSegments: 0 };
      const resetCalls = () => {
        calls.transmissionHits = calls.transmissionSegments = 0;
      };
      const capture = () => {
        const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
          draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const buffers: Array<{ name: string; width: number; height: number; base64: string }> = [];
        try {
          for (const [name, target] of [
            ['hits', hits],
            ['segments', segments],
          ] as const) {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
            const oldBuffer = gl.getParameter(gl.READ_BUFFER) as number;
            try {
              for (let attachment = 0; attachment < target.textures.length; attachment++) {
                gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
                const values = new Float32Array(target.width * target.height * 4);
                gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, values);
                if (!values.every(Number.isFinite)) throw new Error('Adjunto A0/A1 no finito');
                const bytes = new Uint8Array(values.buffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
                buffers.push({ name: `${name}${attachment}`, width: target.width, height: target.height, base64: btoa(binary) });
              }
            } finally {
              gl.readBuffer(oldBuffer);
            }
          }
        } finally {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
        }
        if (gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) !== draw || gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) !== read)
          throw new Error('La captura alteró los destinos WebGL');
        const error = gl.getError();
        if (error) throw new Error(`Error WebGL ${error}`);
        return {
          buffers,
          serial: r.displayedFrame!.n,
          sample: structuredClone(sim.sample),
          pose: { ...sim.pose },
          depthMm: sim.bmode.depthMm,
          calls: { ...calls },
        };
      };
      let queryCount = 0;
      button.click();
      try {
        if (state === 'base') {
          hooks.goToStartPoint('portal');
          sim.advance(sim.physiology.clock.dt);
          const target = Math.round(30 / sim.physiology.clock.dt);
          while (sim.physiology.clock.step < target) sim.physiology.step();
          if (sim.sample.t !== 30) throw new Error('No se alcanzó el tiempo base');
        } else if (state === 'motion') {
          sim.setPose({ ...sim.pose, z: sim.pose.z + 6, rock: sim.pose.rock + 0.05 });
          sim.advance(sim.physiology.clock.dt);
          sim.advance(sim.physiology.clock.dt);
        } else if (state === 'depth') {
          if (sim.bmode.depthMm !== 160) throw new Error('No se aplicó el mando de profundidad');
        } else if (state === 'query') {
          const nodes = sim.contact.nodes.map((node): [number, number, number] => [...node]);
          // Una tabla distinta pero válida (s0 <= sD), sin mutar el contacto de la adquisición.
          nodes[Math.floor(nodes.length / 2)][0] -= 0.25;
          queryCount = sim.gpuQuery(new Float32Array(sim.frame.face), sim.frame, true, {
            compression: { ...sim.contact, nodes },
          }).tissue.length;
          if (queryCount !== 1) throw new Error('Consulta intercalada incompleta');
        } else {
          for (let i = 0; i < 125; i++) sim.physiology.step();
        }
        for (const id of Object.keys(originals) as Pass[])
          passes[id] = (inputs) => {
            calls[id]++;
            originals[id](inputs);
          };
        // Primer cuadro actualiza las dependencias; el siguiente debe reutilizar A0/A1.
        sim.render();
        const warmSerial = r.displayedFrame!.n;
        const warmCalls = { ...calls };
        resetCalls();
        sim.render();
        const cached = capture();
        // Sin setScene, tocar contador ni cambiar el estado físico: recomputación real.
        reuse.clear();
        resetCalls();
        sim.render();
        const forced = capture();
        const saved = Reflect.get(reuse, 'saved') as Float32Array[] | null;
        const grid = Reflect.get(r, 'tubeGrid') as { data: Float32Array } | null;
        return {
          warmSerial,
          warmCalls,
          cached,
          forced,
          queryCount,
          pipeline: r.transmissionHitsPipeline,
          snapshotBytes: saved?.reduce((bytes, block) => bytes + block.byteLength, 0) ?? 0,
          tubeGridBytes: grid?.data.byteLength ?? 0,
        };
      } finally {
        Object.assign(passes, originals);
        if (!sim.frozen) button.click();
      }
    }, state);
    expect(result.snapshotBytes).toBeGreaterThan(0);
    expect(result.cached.serial).toBe(result.warmSerial + 1);
    expect(result.forced.serial).toBe(result.cached.serial + 1);
    expect(result.cached.calls).toEqual({ transmissionHits: 0, transmissionSegments: 0 });
    expect(result.forced.calls).toEqual({ transmissionHits: 1, transmissionSegments: 1 });
    expect(result.forced.sample).toEqual(result.cached.sample);
    expect(result.forced.pose).toEqual(result.cached.pose);
    expect(result.forced.depthMm).toBe(result.cached.depthMm);
    expect(result.cached.buffers.map((b) => b.name)).toEqual(['hits0', 'hits1', 'hits2', 'segments0']);
    const hashes: string[] = [];
    for (let i = 0; i < 4; i++) {
      const a = result.cached.buffers[i],
        b = result.forced.buffers[i];
      expect([a.name, a.width, a.height]).toEqual([b.name, b.width, b.height]);
      const cached = Buffer.from(a.base64, 'base64'),
        forced = Buffer.from(b.base64, 'base64');
      expect(cached.byteLength).toBe(a.width * a.height * 16);
      expect(cached.equals(forced), `${state}: ${a.name} idéntico byte a byte`).toBe(true);
      hashes.push(createHash('sha256').update(cached).digest('hex'));
    }
    evidence.push({ state, hashes, serial: result.cached.serial, time: result.cached.sample.t, depthMm: result.cached.depthMm });
    await info.attach(`transmission-reuse-${state}.json`, {
      body: JSON.stringify({
        ...evidence.at(-1),
        warmSerial: result.warmSerial,
        forcedSerial: result.forced.serial,
        cachedCalls: result.cached.calls,
        forcedCalls: result.forced.calls,
        queryCount: result.queryCount,
        pipeline: result.pipeline,
        snapshotBytes: result.snapshotBytes,
        tubeGridBytes: result.tubeGridBytes,
        warmCalls: result.warmCalls,
        pose: result.cached.pose,
      }),
      contentType: 'application/json',
    });
  }
  expect(evidence[1].hashes, 'el movimiento modifica el campo de transmisión').not.toEqual(evidence[0].hashes);
  expect(evidence[2].hashes, 'la profundidad modifica el campo de transmisión').not.toEqual(evidence[1].hashes);
  expect(evidence[4].time).toBeGreaterThan(evidence[3].time);
  expect(errors).toEqual([]);
});
