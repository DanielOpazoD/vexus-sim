import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { bootWithoutErrors, budget } from './support';
import { abdominalAtlasValue, setAbdominalAtlas } from '../src/anatomy/abdominalAtlas';
import { ABDOMINAL_FIELDS } from '../src/anatomy/abdominalAtlasData';
import { abdomenQuery, GASTRIC_WALL } from '../src/anatomy/organs/abdomen';
import { Interface } from '../src/anatomy/interfaces';
import { Tissue } from '../src/anatomy/tissues';

/** La pared entera, también fuera del plano: puntos materiales del estómago hasta un poco más allá de sus pliegues, fuera de la rejilla del atlas. */
function stomachWallPoints(): number[][] {
  const raw = gunzipSync(readFileSync('src/anatomy/abdominal-atlas.gzip.bin'));
  setAbdominalAtlas(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2));
  const f = ABDOMINAL_FIELDS[1];
  const out: number[][] = [];
  for (let z = 0; z < f.dimensions[2]; z += 4)
    for (let y = 0; y < f.dimensions[1]; y += 4)
      for (let x = 0; x < f.dimensions[0]; x += 4) {
        const p = [x, y, z].map((v, i) => f.originMm[i] + (v + 0.37) * f.pitchMm) as [number, number, number];
        const q = abdominalAtlasValue(p, 1);
        if (q.d >= 0 || q.label !== 1 || -q.d > GASTRIC_WALL.baseMm + GASTRIC_WALL.foldMm + 2) continue;
        if (abdomenQuery(p)?.interface === Interface.BowelSerosa) out.push(p);
      }
  setAbdominalAtlas();
  return out;
}

for (const caseId of ['normal-adult', 'severe-congestion'])
  test(`epigastric stomach: folded wall and contents agree on CPU/GPU, without flow or a black cavity (${caseId})`, async ({
    page,
  }, info) => {
    budget(120000);
    const wallPoints = stomachWallPoints();
    const errors = await bootWithoutErrors(page, '?e2e=app&abdomen=atlas');
    await page.selectOption('#case-select', caseId);
    await page.getByRole('button', { name: 'Apnea espiratoria', exact: true }).click();
    await page.locator('[data-window="epigastric"]').click();
    await page.waitForFunction(() => Math.abs(window.__vexusTest!.sim().pose.z + 35) < 1e-8);
    const result = await page.evaluate(
      ({ contents, wall, wallPoints, margin }) => {
        const s = window.__vexusTest!.sim();
        s.advance(0);
        s.advance(0);
        s.render();
        const a = s.renderer.displayedAnatomy!,
          r = s.renderer,
          img = r.readDisplay();
        const points: number[] = [],
          tissues: number[] = [],
          lumen: number[] = [],
          folds: number[] = [];
        let flow = 0;
        for (let y = 0; y < img.height; y += 3)
          for (let x = 0; x < img.width; x += 3) {
            const b = r.pixelToBeam(x, y, s.transducer, s.bmode.depthMm);
            if (!b) continue;
            const p = a.frame.curvatureCenter.map(
              (v, i) =>
                v + (s.transducer.curvatureRadius + b.r) * (a.frame.axial[i] * Math.cos(b.theta) + a.frame.lateral[i] * Math.sin(b.theta)),
            ) as [number, number, number];
            const q = s.anatomy.classifyWorld(p, a.sample);
            const isLumen = Number(q.tissue) === contents;
            if (!isLumen && !wall.includes(Number(q.tissue))) continue;
            if (q.vessel || q.bloodVelocity || q.flowBasis) flow++;
            // La parte mostrada del estómago, lejos de las fronteras: con los pliegues incluidos
            if (q.boundaryDistance < 0.2) continue;
            points.push(...p);
            tissues.push(Number(q.tissue));
            (isLumen ? lumen : folds).push(img.gray[y * img.width + x]);
          }
        const gpu = s.gpuQuery(new Float32Array(points), a.frame, true);
        // Mismas coordenadas en los dos caminos; con margen frente al filtrado del atlas (0,006 mm): la frontera de cada capa es la que se compara
        const world = Float32Array.from(
          wallPoints.flatMap((p) => s.anatomy.deformation.toWorld(p as [number, number, number], a.sample.resp)),
        );
        const gpuWall = s.gpuQuery(world, a.frame, true);
        const wallCounts: Record<number, number> = {};
        const wallMismatches: unknown[] = [];
        for (let i = 0; i < wallPoints.length; i++) {
          const p = [world[3 * i], world[3 * i + 1], world[3 * i + 2]] as [number, number, number];
          const q = s.anatomy.classifyWorld(p, a.sample);
          if (q.boundaryDistance < margin) continue;
          wallCounts[Number(q.tissue)] = (wallCounts[Number(q.tissue)] ?? 0) + 1;
          if (Number(q.tissue) !== gpuWall.tissue[i])
            wallMismatches.push({ p, cpu: q.tissue, gpu: gpuWall.tissue[i], bd: q.boundaryDistance });
        }
        const median = (v: number[]) => [...v].sort((x, y) => x - y)[v.length >> 1];
        return {
          samples: tissues.length,
          lumen: lumen.length,
          lumenMedian: median(lumen),
          foldsMedian: median(folds),
          flow,
          mismatches: tissues.filter((t, i) => t !== gpu.tissue[i]).length,
          wallCounts,
          wallMismatches,
          glError: r.gl.getError(),
          errors: window.__vexusTest!.loggedErrors(),
        };
      },
      {
        contents: Number(Tissue.GastricContents),
        wall: [Tissue.GutSubmucosa, Tissue.GutMuscularis, Tissue.Bowel] as number[],
        wallPoints,
        margin: 0.02,
      },
    );
    await info.attach('gastric-wall.json', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.samples).toBeGreaterThan(200);
    expect(result.lumen).toBeGreaterThan(30);
    expect(result.flow).toBe(0);
    expect(result.mismatches).toBe(0);
    expect(result.wallMismatches).toEqual([]);
    for (const t of [Tissue.GutMuscularis, Tissue.GutSubmucosa, Tissue.Bowel, Tissue.GastricContents])
      expect(result.wallCounts[t] ?? 0, Tissue[t]).toBeGreaterThan(100);
    // Ni una cavidad negra ni un tejido sólido: la luz queda por debajo de los pliegues, y por encima del negro
    expect(result.lumenMedian).toBeGreaterThan(10);
    expect(result.lumenMedian).toBeLessThan(result.foldsMedian);
    expect(result.glError).toBe(0);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
  });
