import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { SimulationClock } from '../core/clock';
import { PhysiologyEngine } from '../physiology/engine';
import { CONVEX_C35, lineCoupling, lineDirection, pointOnLine, probeFrame, type ProbePose } from '../probe/probe';
import { kidneyQuery, kidneyWorld } from '../anatomy/primitives';
import { renalPatternFromPeaks } from '../vexus/classification';

describe('Anatomía implícita (base B)', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const cls = (p: [number, number, number]) => scene.classify(p, BASELINE_CALIBER);

  it('clasifica puntos de referencia', () => {
    expect(cls([0, 200, 0]).tissue).toBe(Tissue.Air);
    expect(cls([0, 114, 0]).tissue).toBe(Tissue.Skin);
    expect(cls([0, 105, -120]).tissue).toBe(Tissue.Fat);
    expect(cls([-60, 20, 10]).tissue).toBe(Tissue.Liver);
    expect(cls([-22, -20, 0]).tissue).toBe(Tissue.Blood);
    expect(cls([-22, -20, 0]).vessel).toBe('ivcInfra');
    expect(cls([0, -48, 0]).tissue).toBe(Tissue.Vertebra);
    expect(cls([30, -77, 0]).tissue).toBe(Tissue.Vertebra); // apófisis transversa
    // no hay arco costal por detrás de la columna: lo que hay ahí es vértebra, no costilla
    expect(cls([-30, -78, 5]).tissue).toBe(Tissue.Vertebra);
    expect(cls([-30, -78, 5]).tissue).not.toBe(Tissue.Bone);
    expect(cls([-55, -5, 120]).tissue).toBe(Tissue.Lung);
    expect(cls([12, -24, 0]).vessel).toBe('aorta');
    expect(cls([-12, -8, -55]).vessel).toBe('pvTrunk');
  });

  it('los vasos tienen pared distinta de la luz y la porta tiene pared ecogénica', () => {
    // borde posterior del tronco portal: radio 5,5 → a 6 mm del eje hay pared
    // (por delante corre la arteria hepática, como en el ligamento hepatoduodenal)
    expect(cls([-12, -8 - 6.1, -55]).tissue).toBe(Tissue.VesselWallPortal);
    expect(cls([-12, -8 + 6.1, -55]).vessel).toBe('hepaticArtery');
    expect(cls([-22 - 10.4, -20, 0]).tissue).toBe(Tissue.VesselWallThin);
  });

  it('suprahepáticas: tres troncos, tributarias y tronco común que desemboca en la cava', () => {
    expect(cls([-68, -18, 50]).vessel).toBe('hvRight');
    expect(cls([-30, 4, 52]).vessel).toBe('hvMiddle');
    expect(cls([0, 2, 66]).vessel).toBe('hvLeft');
    expect(cls([-83, -12, 35]).vessel).toMatch(/^hvRight/);
    // el tronco común y la desembocadura de la derecha están dentro de la cava supra
    for (const p of [
      [-21, -14, 90],
      [-26, -16, 78],
    ] as [number, number, number][]) {
      expect(cls(p).tissue).toBe(Tissue.Blood);
      expect(['hvCommonTrunk', 'hvRight', 'ivcSupra', 'ivcInfra']).toContain(cls(p).vessel);
    }
  });

  it('porta con ramas de segundo orden y vía biliar anterior a la porta', () => {
    expect(cls([-58, 2, -20]).vessel).toBe('pvRight');
    expect(cls([-10, 8, -18]).vessel).toBe('pvLeft');
    expect(cls([35, 30, 4]).vessel).toBe('pvLeftLateral');
    expect(cls([-100, 30, -2]).vessel).toBe('pvRightAnterior');
    // colédoco: luz anecoica con pared ecogénica, sin vaso
    const cbd = cls([-16, 4, -52]);
    expect(cbd.tissue).toBe(Tissue.Fluid);
    expect(cbd.vessel).toBeNull();
    expect(cls([-16, 4 + 3.1, -52]).tissue).toBe(Tissue.BileDuctWall);
  });

  it('riñón derecho: seno ecogénico, pirámides, corteza, grasa perirrenal e interlobares', () => {
    const k = scene.kidneyRight;
    expect(cls(k.center).tissue).toBe(Tissue.RenalSinus);
    expect(cls(kidneyWorld([13, -18, 0], k)).tissue).toBe(Tissue.RenalMedulla);
    expect(cls(kidneyWorld([13, -25.5, 0], k)).tissue).toBe(Tissue.RenalCortex);
    expect(cls(kidneyWorld([0, -28.5, 0], k)).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(kidneyWorld([0, -18, 1.8], k)).vessel).toBe('interlobarVein2');
    expect(cls(kidneyWorld([0, -18, -1.8], k)).vessel).toBe('interlobarArtery2');
    expect(cls(scene.kidneyLeft.center).tissue).toBe(Tissue.RenalSinus);
    // el hígado no invade el riñón (impresión renal): ninguna muestra de la línea
    // centro del riñón → centro del hígado es hígado dentro del riñón + 4 mm
    let nLiver = 0;
    for (let t = 0; t <= 1; t += 0.02) {
      const p: [number, number, number] = [
        k.center[0] + (scene.liver.center[0] - k.center[0]) * t,
        k.center[1] + (scene.liver.center[1] - k.center[1]) * t,
        k.center[2] + (scene.liver.center[2] - k.center[2]) * t,
      ];
      const c = cls(p);
      if (c.tissue === Tissue.Liver) {
        nLiver++;
        expect(scene.liverSdf(p)).toBeLessThan(0);
        expect(kidneyQuery(p, k).dOuter).toBeGreaterThan(scene.renalImpressionMm - 1e-6);
      }
    }
    expect(nLiver).toBeGreaterThan(5);
  });

  it('el hígado tiene borde inferior por debajo del reborde costal y ≈ 13–15 cm craneocaudales', () => {
    let top = -999;
    let bottom = 999;
    for (let z = -120; z <= 120; z += 1) {
      const t = cls([-70, 30, z]).tissue;
      if (t === Tissue.Liver || t === Tissue.LiverCapsule || t === Tissue.Fluid) {
        top = Math.max(top, z);
        bottom = Math.min(bottom, z);
      }
    }
    expect(top - bottom).toBeGreaterThan(125);
    expect(top - bottom).toBeLessThan(160);
    expect(bottom).toBeLessThan(-40);
    // sin gas intestinal en el avatar de referencia
    expect(scene.gasPockets.length).toBe(0);
  });

  it('árbol hepático procedural: ≥ 40 ramas de 3.º–4.º orden dentro del hígado, con id de su madre y sin alterar áreas', () => {
    const branches = scene.vessels.filter((v) => v.flowFactor !== undefined);
    expect(branches.length).toBeGreaterThanOrEqual(40);
    for (const b of branches) {
      expect(b.tube.nodes.length).toBe(2);
      for (const n of b.tube.nodes) expect(scene.liverInteriorMargin(n.p)).toBeGreaterThan(1.9);
      expect(scene.vesselById.has(b.id)).toBe(true); // la madre existe y sigue siendo la autoridad
      expect(scene.vesselById.get(b.id)!.flowFactor).toBeUndefined();
      expect(b.flowFactor!).toBeGreaterThan(0.5);
      expect(b.flowFactor!).toBeLessThan(1);
      expect(b.tube.nodes[0].r).toBeGreaterThanOrEqual(0.9);
    }
    // determinista: misma escena → mismas ramas
    const again = new AnatomyScene(NORMAL_ADULT).vessels.filter((v) => v.flowFactor !== undefined);
    expect(again.map((b) => b.tube.nodes[1].p)).toEqual(branches.map((b) => b.tube.nodes[1].p));
    // un punto dentro de una rama se clasifica como sangre de la madre con factor < 1
    const b0 = branches[0];
    const mid: [number, number, number] = [
      0.5 * (b0.tube.nodes[0].p[0] + b0.tube.nodes[1].p[0]),
      0.5 * (b0.tube.nodes[0].p[1] + b0.tube.nodes[1].p[1]),
      0.5 * (b0.tube.nodes[0].p[2] + b0.tube.nodes[1].p[2]),
    ];
    const c = cls(mid);
    expect(c.tissue).toBe(Tissue.Blood);
    expect(c.vessel).toBe(b0.id);
    expect(c.flowFactor).toBeLessThan(1);
  });

  it('el patrón renal se deriva de picos y mínimo', () => {
    expect(renalPatternFromPeaks(20, 18, 12)).toBe('continuous');
    expect(renalPatternFromPeaks(15, 18, 0)).toBe('biphasic');
    expect(renalPatternFromPeaks(2, 18, 0)).toBe('monophasic');
    expect(renalPatternFromPeaks(15, 18, -8)).toBe('reversal-out-of-scheme');
    expect(renalPatternFromPeaks(Number.NaN, 18, 0)).toBe('not-assessed');
  });

  it('el peso respiratorio es 0 en la pared y 1 en las vísceras', () => {
    expect(scene.respiratoryWeight([0, 110, 0])).toBe(0);
    expect(scene.respiratoryWeight([-60, 20, 20])).toBeCloseTo(1, 3);
  });

  it('la deformación es invertible y desplaza el hígado en sentido caudal', () => {
    const engine = new PhysiologyEngine({ ...NORMAL_ADULT, respiratoryPattern: 'deep' }, scene.vesselAreas());
    while (engine.sample.resp.volume < 0.9) engine.step();
    const q = new AnatomyQuery(scene);
    const m: [number, number, number] = [-60, 20, 20];
    const w = q.deformation.toWorld(m, engine.sample.resp);
    expect(w[2]).toBeLessThan(m[2] - 20);
    const back = q.deformation.toMaterial(w, engine.sample.resp);
    expect(Math.hypot(back[0] - m[0], back[1] - m[1], back[2] - m[2])).toBeLessThan(0.05);
  });

  it('las áreas de referencia son positivas y coherentes con los radios', () => {
    const a = scene.vesselAreas();
    expect(a.pvTrunk).toBeCloseTo(Math.PI * 5.5 * 5.5, 3);
    expect(a.ivcSupra).toBeCloseTo(Math.PI * 10 * 10 * 0.8, 3); // sección elíptica (apScale 0,8)
  });
});

describe('Sonda (guía §8)', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const pose: ProbePose = { phi: Math.PI * 0.92, z: 5, lift: 0, yaw: 0.3, rock: 0.1, tilt: -0.2 };
  const fr = probeFrame(pose, scene.torso, CONVEX_C35);

  it('el marco es ortonormal y el eje axial entra en el paciente', () => {
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(Math.abs(dot(fr.axial, fr.lateral))).toBeLessThan(1e-6);
    expect(Math.abs(dot(fr.axial, fr.elevation))).toBeLessThan(1e-6);
    expect(Math.abs(dot(fr.lateral, fr.elevation))).toBeLessThan(1e-6);
    expect(dot(fr.axial, fr.skinNormal)).toBeLessThan(-0.9);
  });

  it('la línea central parte de la cara y sigue el eje axial', () => {
    const p0 = pointOnLine(fr, CONVEX_C35, 0, 0);
    expect(Math.hypot(p0[0] - fr.face[0], p0[1] - fr.face[1], p0[2] - fr.face[2])).toBeLessThan(1e-6);
    const d = lineDirection(fr, 0);
    expect(Math.abs(d[0] - fr.axial[0]) + Math.abs(d[1] - fr.axial[1]) + Math.abs(d[2] - fr.axial[2])).toBeLessThan(1e-9);
  });

  it('el acoplamiento es total en contacto y se pierde al separar o bascular', () => {
    const flat: ProbePose = { phi: 0, z: 0, lift: 0, yaw: 0, rock: 0, tilt: 0 };
    expect(lineCoupling(flat, CONVEX_C35, 0)).toBe(1);
    expect(lineCoupling({ ...flat, lift: 12 }, CONVEX_C35, 0)).toBe(0);
    const rocked = { ...flat, rock: 0.35 };
    expect(lineCoupling(rocked, CONVEX_C35, CONVEX_C35.halfSector)).toBeLessThan(lineCoupling(rocked, CONVEX_C35, -CONVEX_C35.halfSector));
  });
});

describe('Reloj único', () => {
  it('acumula tiempo real en pasos enteros y respeta la pausa', () => {
    const c = new SimulationClock(0.004);
    expect(c.requestSteps(0.01)).toBe(2);
    expect(c.requestSteps(0.006)).toBe(2); // 0,002 pendientes + 0,006
    c.pause();
    expect(c.requestSteps(1)).toBe(0);
    c.resume();
    expect(c.requestSteps(10)).toBe(125); // tope por llamada
  });
});
