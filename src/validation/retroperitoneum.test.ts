import { describe, expect, it } from 'vitest';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { kidneyLocal, kidneyOuterSdf, perirenalOuterSdf } from '../anatomy/organs/kidney';
import {
  PSOAS_NODES,
  QUADRATUS,
  RETROPERITONEUM_GLSL,
  RETRO_FAT,
  psoasSdf,
  quadratusSdf,
  retroFatSdf,
  retroFrontY,
  retroperitoneum,
} from '../anatomy/organs/retroperitoneum';
import { SPINE_SHAPE, sdSpine, torsoDepth, tubeQuery } from '../anatomy/primitives';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { TISSUES, TISSUE_GLSL_NAME, Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';

/**
 * Retroperitoneo (decisión 81): psoas mayor, cuadrado lumbar y grasa retroperitoneal. Antes todo lo que rodeaba al riñón
 * y a la columna era el «resto» con la textura de asas (decisión 74).
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const cls = (m: Vec3) => scene.classify(m, BASELINE_CALIBER);
const insideWall = (m: Vec3) => -torsoDepth(m, scene.torso) - scene.wallThickness();
const dPeri = (m: Vec3) => Math.min(...[scene.kidneyRight, scene.kidneyLeft].map((k) => perirenalOuterSdf(kidneyLocal(m, k), k)));

/** Sección de un tejido en el plano z (lado derecho, rejilla de 1 mm): área (mm²) y centroide. */
function section(tissue: Tissue, z: number): { area: number; x: number; y: number; xMin: number; xMax: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let xMin = 1e3;
  let xMax = -1e3;
  for (let x = -130; x <= -1; x += 1)
    for (let y = -100; y <= 10; y += 1)
      if (cls([x, y, z]).tissue === tissue) {
        n++;
        sx += x;
        sy += y;
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
      }
  return { area: n, x: n ? sx / n : Number.NaN, y: n ? sy / n : Number.NaN, xMin, xMax };
}

describe('Retroperitoneo (decisión 81)', () => {
  it('psoas: de T12 a la pelvis junto a los cuerpos vertebrales, fino arriba y ancho abajo, detrás de la VCI', () => {
    // niveles del modelo: L1 ≈ −63, L2 ≈ −97, L3 ≈ −131, L4 ≈ −165 (z = 0 en el xifoides)
    const levels = [-63, -97, -131, -165].map((z) => ({ z, s: section(Tissue.Psoas, z) }));
    for (const { z, s } of levels) {
      const tag = `z ${z}: ${JSON.stringify(s)}`;
      expect(s.area, tag).toBeGreaterThan(0);
      // lateral al cuerpo vertebral (su semieje transverso, 20 mm desde la PR119; recuperación provisional de la decisión 103) y medial al riñón
      expect(-s.x, tag).toBeGreaterThan(scene.spine.r * SPINE_SHAPE.aspect + 3);
      expect(-s.x, tag).toBeLessThan(55);
      // por detrás de la VCI (y ≈ −12…−17) y por delante de las apófisis transversas (el arco, de −58 a −78)
      expect(s.y, tag).toBeLessThan(-30);
      expect(s.y, tag).toBeGreaterThan(scene.spine.archY1 + 5);
    }
    // área de sección por lado (mm²): ~1–3 cm² en L1 y ~6–10 en L3 (la de los dos psoas en L3 del adulto sano, ~12–15 cm²
    // en la mujer y ~20 en el varón, por encima de los cortes de sarcopenia) [LITERATURA, orden de magnitud], creciente
    // hacia abajo hasta L4
    expect(levels[0].s.area).toBeLessThan(300);
    expect(levels[2].s.area).toBeGreaterThan(600);
    expect(levels[2].s.area).toBeLessThan(1000);
    for (let i = 1; i < levels.length; i++) expect(levels[i].s.area).toBeGreaterThan(levels[i - 1].s.area);
    // se separa de la columna hacia abajo y afuera
    expect(-levels[3].s.x).toBeGreaterThan(-levels[0].s.x + 5);
    // nace en T12–L1 y llega a la pelvis
    expect(cls([-PSOAS_NODES[0][0], PSOAS_NODES[0][1], PSOAS_NODES[0][2]]).tissue).toBe(Tissue.Psoas);
    expect(section(Tissue.Psoas, -30).area).toBe(0);
    expect(section(Tissue.Psoas, -230).area).toBeGreaterThan(300);
    // simétrico: el izquierdo es su espejo en x
    for (const m of [
      [30, -46, -97],
      [38, -40, -165],
    ] as Vec3[])
      expect(cls(m).tissue).toBe(Tissue.Psoas);
  });

  it('cuadrado lumbar: lámina contra la pared posterior, lateral al psoas, de la 12.ª costilla a la cresta', () => {
    for (const z of [-120, -150, -180]) {
      const q = section(Tissue.QuadratusLumborum, z);
      const p = section(Tissue.Psoas, z);
      const tag = `z ${z}: ${JSON.stringify({ q, p })}`;
      // más lateral y más posterior que el psoas, y más ancho que grueso
      expect(-q.x, tag).toBeGreaterThan(-p.x + 10);
      expect(q.y, tag).toBeLessThan(p.y - 10);
      expect(q.xMax - q.xMin, tag).toBeGreaterThan(35);
      // grosor por delante de la pared: 12–15 mm [ESTIMADO]
      let thick = 0;
      for (let y = -100; y < 0; y += 0.25) if (cls([-65, y, z]).tissue === Tissue.QuadratusLumborum) thick += 0.25;
      expect(thick, tag).toBeGreaterThan(10);
      expect(thick, tag).toBeLessThan(QUADRATUS.thicknessMax + 1);
    }
    // pegado a la cara interna de la pared: justo por dentro de ella, músculo; por fuera, la pared
    const onWall: Vec3 = [-65, 0, -150];
    for (let y = -60; y > -100; y -= 0.05) {
      onWall[1] = y;
      if (insideWall(onWall) < 0.3) break;
    }
    expect(cls(onWall).tissue).toBe(Tissue.QuadratusLumborum);
    // sin cuadrado por encima de la 12.ª costilla ni por debajo de la cresta, ni en la pared anterior
    expect(section(Tissue.QuadratusLumborum, QUADRATUS.zTop + 5).area).toBe(0);
    expect(section(Tissue.QuadratusLumborum, QUADRATUS.zBottom - 5).area).toBe(0);
    for (let x = -120; x <= 120; x += 2)
      for (let y = 0; y <= 100; y += 2) expect(cls([x, y, -150]).tissue).not.toBe(Tissue.QuadratusLumborum);
    // donde el riñón apoya en la pared (su grasa gruesa de detrás llega a ella) el músculo le deja sitio
    expect(quadratusSdf([-65, -62, -85], insideWall([-65, -62, -85]), dPeri([-65, -62, -85]))).toBeGreaterThan(0);
  });

  it('no invaden el riñón, el hígado, la VCI, la aorta ni la columna del adulto de referencia', () => {
    const ivc = scene.vessels.find((v) => v.id === 'ivcInfra')!;
    const aorta = scene.vessels.find((v) => v.id === 'aorta')!;
    const near = { kidney: 1e3, fat: 1e3, liver: 1e3, ivc: 1e3, aorta: 1e3, spine: 1e3 };
    let inside = 0;
    for (let x = -130; x <= 130; x += 2)
      for (let y = -100; y <= 10; y += 2)
        for (let z = -280; z <= -20; z += 2.5) {
          const m: Vec3 = [x, y, z];
          const w = insideWall(m);
          if (w < 0) continue;
          if (psoasSdf(m) >= 0 && quadratusSdf(m, w, dPeri(m)) >= 0) continue;
          inside++;
          near.kidney = Math.min(near.kidney, ...[scene.kidneyRight, scene.kidneyLeft].map((k) => kidneyOuterSdf(kidneyLocal(m, k), k)));
          near.fat = Math.min(near.fat, dPeri(m));
          near.liver = Math.min(near.liver, scene.liverSdf(m));
          near.ivc = Math.min(near.ivc, tubeQuery(m, ivc.tube, 1).d - ivc.wallMm);
          near.aorta = Math.min(near.aorta, tubeQuery(m, aorta.tube, 1).d - aorta.wallMm);
          near.spine = Math.min(near.spine, sdSpine(m, scene.spine));
        }
    const tag = JSON.stringify(near);
    expect(inside).toBeGreaterThan(5000);
    // márgenes (mm): la grasa perirrenal toca al cuadrado donde el riñón apoya en la pared (el músculo le deja sitio)
    expect(near.kidney, tag).toBeGreaterThan(5);
    expect(near.fat, tag).toBeGreaterThanOrEqual(0);
    // (el mínimo del SDF del hígado sin recortar sobre el cuadrado es 1,98 mm, entre los nodos de esta rejilla)
    expect(near.liver, tag).toBeGreaterThan(1.5);
    expect(near.ivc, tag).toBeGreaterThan(5);
    expect(near.aorta, tag).toBeGreaterThan(1);
    expect(near.spine, tag).toBeGreaterThan(0.5);
    // el psoas de arriba entre el costado del cuerpo vertebral y la grasa perirrenal (PR119; recuperación provisional de la decisión 103: el cuerpo de 40 mm de ancho),
    // en una rejilla fina de 0,2 mm: la de 2 mm de arriba no ve holguras de décimas
    let bone = 1e3;
    let fat = 1e3;
    for (let z = -115; z <= -40; z += 0.25)
      for (let x = 17; x <= 46; x += 0.2)
        for (let y = -60; y <= -34; y += 0.2) {
          const m: Vec3 = [-x, y, z];
          if (psoasSdf(m) >= 0) continue;
          bone = Math.min(bone, sdSpine(m, scene.spine));
          fat = Math.min(fat, dPeri(m));
        }
    expect(bone, `hueso ${bone}`).toBeGreaterThan(0.5);
    expect(fat, `grasa ${fat}`).toBeGreaterThan(0.3);
  });

  it('en todos los casos, lo que se clasifica antes gana: nada retroperitoneal dentro de riñón, hígado, vasos o columna', () => {
    // la hepatomegalia de la congestión grave llega al origen del psoas en T12–L1 (≤ 13 mm): allí es hígado
    for (const c of CASES) {
      const sc = new AnatomyScene(c);
      const retro = new Set([Tissue.Psoas, Tissue.QuadratusLumborum, Tissue.RetroperitonealFat]);
      for (let x = -120; x <= 120; x += 4)
        for (let y = -90; y <= 0; y += 4)
          for (let z = -200; z <= -30; z += 5) {
            const m: Vec3 = [x, y, z];
            const t = sc.classify(m, BASELINE_CALIBER).tissue;
            if (!retro.has(t)) continue;
            const tag = `${c.id} ${Tissue[t]} en ${m.join(',')}`;
            expect(sc.liverSdf(m), tag).toBeGreaterThanOrEqual(0);
            expect(sdSpine(m, sc.spine), tag).toBeGreaterThanOrEqual(0);
            for (const k of [sc.kidneyRight, sc.kidneyLeft]) expect(perirenalOuterSdf(kidneyLocal(m, k), k), tag).toBeGreaterThanOrEqual(0);
          }
    }
  });

  it('el riñón queda rodeado de grasa retroperitoneal: tras su grasa perirrenal nunca hay asas (antes, casi siempre)', () => {
    const k = scene.kidneyRight;
    const own = new Set([
      Tissue.RenalCortex,
      Tissue.RenalMedulla,
      Tissue.RenalSinus,
      Tissue.RenalPelvis,
      Tissue.RenalCapsule,
      Tissue.PerirenalFat,
      Tissue.Blood,
      Tissue.VesselWallThin,
      Tissue.ArteryWall,
    ]);
    const next = new Map<Tissue, number>();
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 32; j++) {
        const th = Math.acos(1 - (2 * (i + 0.5)) / 16);
        const ph = (2 * Math.PI * j) / 32;
        const d: Vec3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        let inFat = false;
        for (let r = 5; r < 100; r += 0.25) {
          const t = cls([k.center[0] + d[0] * r, k.center[1] + d[1] * r, k.center[2] + d[2] * r]).tissue;
          if (t === Tissue.PerirenalFat) inFat = true;
          else if (inFat && !own.has(t)) {
            next.set(t, (next.get(t) ?? 0) + 1);
            break;
          }
        }
      }
    const tag = JSON.stringify(Object.fromEntries([...next].map(([t, n]) => [Tissue[t], n])));
    expect(next.get(Tissue.Bowel) ?? 0, tag).toBe(0);
    // la grasa retroperitoneal es lo que más lo rodea; detrás, la pared y el cuadrado lumbar; arriba y delante, el hígado
    expect(next.get(Tissue.RetroperitonealFat) ?? 0, tag).toBeGreaterThan(250);
    expect(next.get(Tissue.QuadratusLumborum) ?? 0, tag).toBeGreaterThan(20);
    expect(next.get(Tissue.Liver) ?? 0, tag).toBeGreaterThan(50);
    // delante del retroperitoneo queda mesenterio; no se inventa una luz intestinal sin eje geométrico
    expect(cls([k.center[0], retroFrontY(Math.abs(k.center[0]), k.center[2]) + 5, k.center[2]]).tissue).toBe(Tissue.MesentericFat);
  });

  it('el compartimento: detrás del peritoneo parietal posterior, por delante de los grandes vasos y hasta el flanco', () => {
    // delante de la aorta y de la VCI, grasa hasta y = frontY; más adelante, asas
    expect(cls([0, RETRO_FAT.frontY - 3, -120]).tissue).toBe(Tissue.RetroperitonealFat);
    expect(cls([0, RETRO_FAT.frontY + 3, -120]).tissue).toBe(Tissue.MesentericFat);
    // entre la VCI y la aorta (la ventana del flanco): grasa, no asas
    expect(cls([-3, -18, -60]).tissue).toBe(Tissue.RetroperitonealFat);
    // en el flanco la grasa llega a la pared detrás de la línea axilar posterior; delante, la pared lateral toca asas
    expect(retroFrontY(RETRO_FAT.xLateral, -100)).toBeCloseTo(RETRO_FAT.yLateral, 9);
    expect(retroFatSdf([RETRO_FAT.xLateral + 1, -60, -100])).toBeGreaterThan(0);
    // bajo los riñones solo queda la gotera paravertebral
    expect(retroFrontY(20, RETRO_FAT.zLow - RETRO_FAT.zRamp - 10)).toBeCloseTo(RETRO_FAT.yLow, 9);
    // la pared anterior nunca es retroperitoneo
    for (let x = -120; x <= 120; x += 5) expect(retroFatSdf([x, 20, -100])).toBeGreaterThan(0);
  });

  it('la distancia a la frontera de lo retroperitoneal no pasa de la real', () => {
    // gate volumétrico TS ↔ GLSL: un punto con bd ≥ 1 mm se da por interior; si bd sobrestimara la distancia, un punto
    // pegado a la frontera contaría como interior. Se mueve el punto 0,95·bd en 14 direcciones: entre psoas, cuadrado,
    // grasa, asas y columna el tejido no cambia. Frente a lo que se clasifica antes, el «resto» hereda las cotas de antes
    // de la 81: no cuenta los tubos ni la cortina, y la pared (métrica radial del tronco, |∇| hasta 1,2), el diafragma y la
    // grasa perirrenal (≥ 0,75–0,9·bd en la revisión adversarial) no son euclídeos
    const group = new Set([Tissue.Psoas, Tissue.QuadratusLumborum, Tissue.RetroperitonealFat, Tissue.Bowel]);
    const judged = new Set([...group, Tissue.Vertebra]);
    const dirs: Vec3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      ...[-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [-1, 1].map((c) => [a, b, c].map((v) => v / Math.sqrt(3)) as Vec3))),
    ];
    let state = 20260926;
    const rnd = () => (state = (state * 16807) % 2147483647) / 2147483647;
    let checked = 0;
    for (let i = 0; i < 40_000; i++) {
      const m: Vec3 = [-140 + 280 * rnd(), -95 + 105 * rnd(), -260 + 240 * rnd()];
      const c = cls(m);
      if (!group.has(c.tissue) || c.boundaryDistance < 0.3) continue;
      checked++;
      for (const d of dirs) {
        const s = 0.95 * c.boundaryDistance;
        const t = cls([m[0] + d[0] * s, m[1] + d[1] * s, m[2] + d[2] * s]).tissue;
        if (!judged.has(t)) continue;
        expect(Tissue[t], `${Tissue[c.tissue]} en ${m.map((v) => v.toFixed(2)).join(', ')} con bd ${c.boundaryDistance.toFixed(2)}`).toBe(
          Tissue[c.tissue],
        );
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('tejidos nuevos al final de la tabla, con nombre GLSL y propiedades de músculo y de grasa', () => {
    expect([Tissue.Psoas, Tissue.QuadratusLumborum, Tissue.RetroperitonealFat]).toEqual([27, 28, 29]);
    expect(TISSUE_GLSL_NAME[Tissue.Psoas]).toBe('T_PSOAS');
    // hipoecoicos entre sus septos (como el músculo de la pared) y la grasa, ecogénica y granulosa como la perirrenal
    for (const t of [Tissue.Psoas, Tissue.QuadratusLumborum]) {
      expect(TISSUES[t].backscatter).toBeLessThan(0.5);
      expect(TISSUES[t].alpha1).toBe(TISSUES[Tissue.Muscle].alpha1);
    }
    expect(TISSUES[Tissue.RetroperitonealFat].backscatter).toBeGreaterThan(1.2);
    expect(TISSUES[Tissue.RetroperitonealFat].speckleClump).toBe(TISSUES[Tissue.PerirenalFat].speckleClump);
  });

  it('el gemelo GLSL toma las constantes del módulo y classify lo llama tras el hígado', () => {
    const n = PSOAS_NODES.length;
    const f = (v: number) => v.toFixed(4);
    expect(RETROPERITONEUM_GLSL).toContain(`const vec4 PSOAS[${n}] = vec4[${n}](vec4(${PSOAS_NODES[0].map(f).join(', ')})`);
    expect(RETROPERITONEUM_GLSL).toContain(`${f(QUADRATUS.zTop)}, ${f(QUADRATUS.zBottom)}`);
    expect(RETROPERITONEUM_GLSL).toContain(`${f(RETRO_FAT.frontY)}, ${f(RETRO_FAT.xFront)}`);
    expect(ANATOMY_GLSL).toContain(RETROPERITONEUM_GLSL);
    expect(ANATOMY_GLSL).toContain('uSpine.y + 46.0');
    expect(ANATOMY_GLSL).toContain('c.tissue = retroperitoneum(retroPoint, -depth - wall, dPeri, bdRetro);');
    // la función TS da los mismos tejidos que classify en el resto (el orden: psoas, cuadrado, grasa, asas)
    expect(retroperitoneum([-30, -46, -97], 10, 1e3)[0]).toBe(Tissue.Psoas);
    expect(retroperitoneum([-65, -60, -150], 5, 1e3)[0]).toBe(Tissue.QuadratusLumborum);
    expect(retroperitoneum([-65, -60, -150], 5, -1)[0]).toBe(Tissue.RetroperitonealFat);
    expect(retroperitoneum([0, 20, -120], 60, 1e3)[0]).toBe(Tissue.Bowel);
  });
});
