import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER, wallThicknessMm } from '../anatomy/scene';
import { Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT } from '../cases';
import { SimulationClock } from '../core/clock';
import { PhysiologyEngine } from '../physiology/engine';
import { CONVEX_C35, lineCoupling, lineDirection, pointOnLine, probeFrame, skinSoftness, type ProbePose } from '../probe/probe';
import { kidneyQuery, kidneyWorld } from '../anatomy/organs/kidney';
import { renalPatternFromPeaks } from '../vexus/classification';
import { VESSEL_META } from '../physiology/vessels';
import { BRANCH_MAX_RADIUS_SCALE } from '../anatomy/vesselTree';

describe('Anatomía implícita (base B)', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const cls = (p: [number, number, number]) => scene.classify(p, BASELINE_CALIBER);

  it('clasifica puntos de referencia', () => {
    expect(cls([0, 200, 0]).tissue).toBe(Tissue.Air);
    expect(cls([0, 104, 0]).tissue).toBe(Tissue.Skin);
    expect(cls([0, 95, -120]).tissue).toBe(Tissue.Fat);
    expect(cls([-60, 20, -10]).tissue).toBe(Tissue.Liver);
    expect(cls([-22, -16, 0]).tissue).toBe(Tissue.Blood);
    expect(cls([-22, -16, 0]).vessel).toBe('ivcInfra');
    expect(cls([0, -46, 0]).tissue).toBe(Tissue.Vertebra);
    expect(cls([30, -70, 0]).tissue).toBe(Tissue.Vertebra); // apófisis transversa
    // no hay arco costal por detrás de la columna: lo que hay ahí es vértebra, no costilla
    expect(cls([-30, -70, 5]).tissue).toBe(Tissue.Vertebra);
    expect(cls([-30, -70, 5]).tissue).not.toBe(Tissue.Bone);
    expect(cls([-55, -5, 70]).tissue).toBe(Tissue.Lung);
    expect(cls([12, -24, 0]).vessel).toBe('aorta');
    expect(cls([-12, -8, -72]).vessel).toBe('pvTrunk');
  });

  it('la fisura umbilical excava el lóbulo izquierdo y la rellena el ligamento redondo (ecogénico)', () => {
    // dentro de la fisura: x 15, bajo la cara anterior del lóbulo izquierdo, tercio inferior
    expect(cls([15, 56, -48]).tissue).toBe(Tissue.LigamentumTeres);
    // fuera de la lámina (x 25) y por encima de zMax (z −20): hígado normal
    expect(cls([25, 56, -48]).tissue).toBe(Tissue.Liver);
    expect(cls([15, 56, -20]).tissue).toBe(Tissue.Liver);
    // más hondo que la fisura (14 mm desde la superficie): hígado
    expect(cls([15, 40, -48]).tissue).toBe(Tissue.Liver);
    // el SDF con fisura es ≥ el SDF base en todo punto (solo excava, nunca añade)
    for (const p of [
      [15, 56, -48],
      [15, 40, -48],
      [-60, 20, -10],
      [15, 56, -20],
    ] as [number, number, number][])
      expect(scene.liverSdf(p)).toBeGreaterThanOrEqual(scene.liverBaseSdf(p) - 1e-9);
  });

  it('vesícula en pera: fondo ancho anteroinferior, cuello estrecho hacia el hilio, pared ecogénica y fosa en el hígado', () => {
    const gb = scene.gallbladder;
    const along = (t: number, off: [number, number, number] = [0, 0, 0]): [number, number, number] => [
      gb.center[0] + gb.u[0] * t + gb.v[0] * off[1] + gb.w[0] * off[2],
      gb.center[1] + gb.u[1] * t + gb.v[1] * off[1] + gb.w[1] * off[2],
      gb.center[2] + gb.u[2] * t + gb.v[2] * off[1] + gb.w[2] * off[2],
    ];
    // el eje u va del fondo (−u, anteroinferior) al cuello (+u, posterosuperior, hacia el hilio)
    expect(gb.u[1]).toBeLessThan(0);
    expect(gb.u[2]).toBeGreaterThan(0);
    expect(cls(along(0)).tissue).toBe(Tissue.Fluid);
    // a 30 mm del centro hacia el fondo, a 9 mm del eje sigue habiendo bilis; hacia el cuello ya no
    expect(cls(along(-30, [0, 9, 0])).tissue).toBe(Tissue.Fluid);
    expect(cls(along(30, [0, 9, 0])).tissue).not.toBe(Tissue.Fluid);
    // pared ecogénica de 1,5 mm alrededor de la luz, y hígado detrás (fosa vesicular)
    expect(cls(along(0, [0, 11.7, 0])).tissue).toBe(Tissue.BileDuctWall);
    expect(cls(along(0, [0, 11 + 1.5 + 4, 0])).tissue).toBe(Tissue.Liver);
    expect(scene.gallbladderWallMm).toBeCloseTo(1.5, 6);
  });

  it('los vasos tienen pared distinta de la luz y la porta tiene pared ecogénica', () => {
    // borde posterior del tronco portal: radio 5,5 → a 6 mm del eje hay pared
    // (por delante corre la arteria hepática, como en el ligamento hepatoduodenal)
    expect(cls([-12, -8 - 6.1, -72]).tissue).toBe(Tissue.VesselWallPortal);
    expect(cls([-12, -8 + 6.1, -72]).vessel).toBe('hepaticArtery');
    expect(cls([-22 - 10.4, -16, 0]).tissue).toBe(Tissue.VesselWallThin);
  });

  it('suprahepáticas: tres troncos, tributarias y tronco común que desemboca en la cava', () => {
    expect(cls([-68, -18, 10]).vessel).toBe('hvRight');
    expect(cls([-30, 4, 12]).vessel).toBe('hvMiddle');
    expect(cls([0, 2, 26]).vessel).toBe('hvLeft');
    expect(cls([-83, -12, -5]).vessel).toMatch(/^hvRight/);
    // el tronco común y la desembocadura de la derecha están dentro de la cava supra
    for (const p of [
      [-21, -14, 50],
      [-26, -16, 38],
    ] as [number, number, number][]) {
      expect(cls(p).tissue).toBe(Tissue.Blood);
      expect(['hvCommonTrunk', 'hvRight', 'ivcSupra', 'ivcInfra']).toContain(cls(p).vessel);
    }
  });

  it('porta con ramas de segundo orden y vía biliar anterior a la porta', () => {
    expect(cls([-58, 2, -37]).vessel).toBe('pvRight');
    expect(cls([-12, 10, -40]).vessel).toBe('pvLeft');
    // la porción umbilical termina bajo el suelo de la fisura umbilical (ligamento redondo encima)
    expect(cls([8, 30, -38]).vessel).toBe('pvLeft');
    expect(cls([15, 56, -40]).tissue).toBe(Tissue.LigamentumTeres);
    // la arteria renal derecha pasa entre la cava y el cuerpo vertebral sin cortarse
    expect(cls([-12, -29, -67]).vessel).toBe('renalArteryRight');
    expect(cls([-22, -16, -66]).vessel).toMatch(/ivcInfra|renalVeinRight/);
    expect(cls([38, 32, -22]).vessel).toBe('pvLeftLateral');
    expect(cls([-100, 30, -19]).vessel).toBe('pvRightAnterior');
    // colédoco: luz anecoica con pared ecogénica, sin vaso
    const cbd = cls([-16, 4, -69]);
    expect(cbd.tissue).toBe(Tissue.Fluid);
    expect(cbd.vessel).toBeNull();
    expect(cls([-16, 4 + 3.1, -69]).tissue).toBe(Tissue.BileDuctWall);
  });

  // Antes arteria y vena renales compartían el nodo hiliar: el 14–21 % del eje arterial se clasificaba
  // como vena y una puerta PW sobre la arteria del hilio daba el espectro venoso.
  it('en el hilio renal la vena va delante de la arteria y no se tocan', () => {
    for (const side of ['Right', 'Left'] as const) {
      const artery = scene.vessels.find((v) => v.id === `renalArtery${side}`)!;
      const vein = scene.vessels.find((v) => v.id === `renalVein${side}`)!;
      const samples = (d: typeof artery) => {
        const out: { p: [number, number, number]; r: number }[] = [];
        const n = d.tube.nodes;
        for (let i = 0; i + 1 < n.length; i++)
          for (let k = 0; k <= 50; k++) {
            const s = k / 50;
            out.push({
              p: [0, 1, 2].map((j) => n[i].p[j] + (n[i + 1].p[j] - n[i].p[j]) * s) as [number, number, number],
              r: n[i].r + (n[i + 1].r - n[i].r) * s,
            });
          }
        return out;
      };
      const a = samples(artery);
      const w = samples(vein);
      // ningún punto del eje arterial es vena
      expect(a.filter((x) => cls(x.p).vessel === vein.id).length, side).toBe(0);
      // luz + pared de cada una sin solaparse en todo el recorrido
      let gap = Infinity;
      for (const x of a)
        for (const y of w)
          gap = Math.min(gap, Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1], x.p[2] - y.p[2]) - (x.r + y.r + artery.wallMm + vein.wallMm));
      expect(gap, side).toBeGreaterThanOrEqual(0);
      // y en el hilio la vena es anterior (y mayor) a la arteria
      const hv = vein.tube.nodes[1].p;
      const ha = artery.tube.nodes[2].p;
      expect(hv[1], side).toBeGreaterThan(ha[1]);
    }
  });

  it('riñón derecho: seno ecogénico, pirámides, corteza, grasa perirrenal e interlobares', () => {
    const k = scene.kidneyRight;
    // pelvis anecoica en el centro del seno; seno ecogénico alrededor; cápsula fina en la superficie
    expect(cls(kidneyWorld([0, k.sinusOffset, 0], k)).tissue).toBe(Tissue.RenalPelvis);
    expect(cls(kidneyWorld([0, k.sinusOffset - 6, 0], k)).tissue).toBe(Tissue.RenalSinus);
    expect(cls(kidneyWorld([0, -(k.radii[1] - 0.3), 0], k)).tissue).toBe(Tissue.RenalCapsule);
    // pirámides discretas: la lateral en u = 12 es médula y la columna de Bertin en u = 24 es corteza
    expect(cls(kidneyWorld([12, -18, 0], k)).tissue).toBe(Tissue.RenalMedulla);
    expect(cls(kidneyWorld([24, -18, 0], k)).tissue).toBe(Tissue.RenalCortex);
    // interfaz hígado–riñón sin hueco: hígado (cápsula) → grasa perirrenal → cápsula renal → corteza
    const seq: Tissue[] = [];
    for (let t = 0; t <= 1; t += 0.01) {
      const p: [number, number, number] = [
        k.center[0] + (scene.liver.center[0] - k.center[0]) * t,
        k.center[1] + (scene.liver.center[1] - k.center[1]) * t,
        k.center[2] + (scene.liver.center[2] - k.center[2]) * t,
      ];
      const tis = cls(p).tissue;
      if (seq[seq.length - 1] !== tis) seq.push(tis);
    }
    const iFat = seq.indexOf(Tissue.PerirenalFat);
    expect(iFat).toBeGreaterThan(0);
    expect(seq[iFat - 1]).toBe(Tissue.RenalCapsule);
    expect([Tissue.Liver, Tissue.LiverCapsule]).toContain(seq[iFat + 1]);
    expect(seq).not.toContain(Tissue.Bowel);
    expect(cls(k.center).tissue).toBe(Tissue.RenalSinus);
    expect(cls(kidneyWorld([13, -18, 0], k)).tissue).toBe(Tissue.RenalMedulla);
    expect(cls(kidneyWorld([13, -25.5, 0], k)).tissue).toBe(Tissue.RenalCortex);
    expect(cls(kidneyWorld([0, -28.5, 0], k)).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(kidneyWorld([0, -18, 1.8], k)).vessel).toBe('interlobarVein2');
    expect(cls(kidneyWorld([0, -18, -1.8], k)).vessel).toBe('interlobarArtery2');
    expect(cls(scene.kidneyLeft.center).tissue).toBe(Tissue.RenalSinus);
    expect(cls(kidneyWorld([0, scene.kidneyLeft.sinusOffset, 0], scene.kidneyLeft)).tissue).toBe(Tissue.RenalPelvis);
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
    expect(top - bottom).toBeGreaterThan(110);
    expect(top - bottom).toBeLessThan(160);
    expect(bottom).toBeLessThan(-65); // borde por debajo del reborde costal medioclavicular
    expect(top).toBeLessThan(60); // cúpula en T8–T9 (+55 mm sobre el xifoides)
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

  // Antes la contención solo se comprobaba en los extremos: en la congestión grave una rama de
  // hvLeftTributary cruzaba la fisura umbilical (hígado +4 mm fuera en su punto medio) y una luz con
  // flujo sustituía al ligamento redondo; otras rozaban la cápsula con el calibre dilatado.
  it('las ramas procedurales quedan dentro del parénquima en todo su recorrido y con el calibre máximo', () => {
    for (const p of CASES) {
      const sc = new AnatomyScene(p);
      const branches = sc.vessels.filter((v) => v.flowFactor !== undefined);
      expect(branches.length, p.id).toBeGreaterThanOrEqual(40);
      const bad: string[] = [];
      for (const [i, b] of branches.entries()) {
        const [n0, n1] = b.tube.nodes;
        // el origen es el nodo más grueso: su primer radio queda dentro de la luz de la madre
        const [o, e] = n0.r >= n1.r ? [n0, n1] : [n1, n0];
        const sMax = BRANCH_MAX_RADIUS_SCALE[VESSEL_META[b.id].caliber];
        const len = Math.hypot(e.p[0] - o.p[0], e.p[1] - o.p[1], e.p[2] - o.p[2]);
        const n = Math.ceil(2 * len);
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          if (t * len < o.r * sMax) continue;
          const q: [number, number, number] = [0, 1, 2].map((j) => o.p[j] + (e.p[j] - o.p[j]) * t) as [number, number, number];
          const r = (o.r + (e.r - o.r) * t) * sMax;
          const margin = Math.min(sc.liverInteriorMargin(q), sc.ligamentumVenosumSdf(q));
          if (margin < r + wallThicknessMm(b, r)) {
            bad.push(`${p.id} #${i} ${b.id} t=${t.toFixed(2)}: margen ${margin.toFixed(2)} < ${(r + wallThicknessMm(b, r)).toFixed(2)}`);
            break;
          }
        }
      }
      expect(bad).toEqual([]);
    }
  });

  it('el intestino (el «resto») mide su distancia a la frontera: tiende a 0 junto al diafragma y el hígado', () => {
    // Antes valía 5 mm fijos: el gate volumétrico daba por interior un punto pegado al diafragma
    // y float32 lo clasificaba al otro lado (Bowel→Diaphragm en CI). Subiendo por tres columnas,
    // el bd de cada punto de intestino no supera la distancia a la interfaz que se encuentra.
    for (const [x, y, expected] of [
      [70, -5, Tissue.Diaphragm],
      [60, 20, Tissue.LiverCapsule],
      [40, 30, Tissue.LiverCapsule],
    ] as const) {
      const samples: Array<{ z: number; bd: number }> = [];
      let zT = Number.NaN;
      for (let z = -120; z < 60; z += 0.25) {
        const c = cls([x, y, z]);
        if (c.tissue === Tissue.Bowel) samples.push({ z, bd: c.boundaryDistance });
        else if (samples.length && samples[samples.length - 1].z === z - 0.25) {
          expect(c.tissue, `${x},${y}`).toBe(expected);
          zT = z;
          break;
        }
      }
      expect(zT, `${x},${y}: sin transición`).not.toBeNaN();
      expect(samples[samples.length - 1].bd).toBeLessThan(0.3);
      for (const p of samples.filter((q) => zT - q.z < 10)) expect(p.bd).toBeLessThanOrEqual(zT - p.z + 1e-9);
    }
  });

  it('el patrón renal se deriva de picos y mínimo', () => {
    expect(renalPatternFromPeaks(20, 18, 12)).toBe('continuous');
    expect(renalPatternFromPeaks(15, 18, 0)).toBe('biphasic');
    expect(renalPatternFromPeaks(2, 18, 0)).toBe('monophasic');
    expect(renalPatternFromPeaks(15, 18, -8)).toBe('reversal-out-of-scheme');
    expect(renalPatternFromPeaks(Number.NaN, 18, 0)).toBe('not-assessed');
  });

  it('el peso respiratorio es 0 en la pared y 1 en las vísceras', () => {
    expect(scene.respiratoryWeight([0, 100, 0])).toBe(0);
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
    // la pared blanda del epigastrio absorbe la basculación: bajo el xifoides se conserva más
    // contacto que sobre las costillas del flanco con la misma basculación craneal (decisión 43)
    const mean = (pose: ProbePose) => {
      let c = 0;
      for (let i = 0; i <= 40; i++) c += lineCoupling(pose, CONVEX_C35, -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / 40) / 41;
      return c;
    };
    const epigastrium: ProbePose = { phi: Math.PI / 2 + 0.2, z: -20, lift: 0, yaw: 0, rock: 0.5, tilt: 0 };
    const ribs: ProbePose = { phi: Math.PI * 0.9, z: 20, lift: 0, yaw: 0, rock: 0.5, tilt: 0 };
    expect(skinSoftness(epigastrium)).toBeGreaterThan(0.6);
    expect(skinSoftness(ribs)).toBeLessThan(0.2);
    expect(mean(epigastrium)).toBeGreaterThan(0.65);
    expect(mean(epigastrium)).toBeGreaterThan(mean(ribs) + 0.1);
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

describe('Cortina pulmonar y pared periportal (decisión 43)', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  it('el pulmón cubre la parte alta del hígado lateral solo por debajo del borde que baja con la inspiración', () => {
    // punto 1,5 mm bajo la pared, flanco derecho, z −5: hígado en espiración (borde en +18),
    // pulmón en inspiración profunda (borde en 18 − 30 = −12)
    const wall = scene.wallThickness();
    const phi = Math.PI * 0.95;
    const p: [number, number, number] = [
      (scene.torso.a - wall - 1.5) * Math.cos(phi) * 0.999,
      (scene.torso.b - wall - 1.5) * Math.sin(phi) * 0.999,
      -5,
    ];
    const at = (caudal: number) => scene.classify(p, { ...BASELINE_CALIBER, diaphragmCaudalMm: caudal }).tissue;
    expect(at(0)).toBe(Tissue.Liver);
    expect(at(30)).toBe(Tissue.Lung);
    // el mismo punto 10 mm más hondo nunca es cortina (lámina de 3 mm)
    const deep: [number, number, number] = [p[0] * 0.93, p[1] * 0.93, -5];
    expect(scene.classify(deep, { ...BASELINE_CALIBER, diaphragmCaudalMm: 30 }).tissue).toBe(Tissue.Liver);
    // y en el lado izquierdo (x > −45) no hay cortina
    const left: [number, number, number] = [-p[0], p[1], -5];
    expect(scene.classify(left, { ...BASELINE_CALIBER, diaphragmCaudalMm: 30 }).tissue).not.toBe(Tissue.Lung);
  });

  it('la pared periportal es más gruesa en el tronco que en las ramas periféricas', () => {
    const trunk = scene.vessels.find((v) => v.id === 'pvTrunk')!;
    const branch = scene.vessels.find((v) => v.id === 'pvLeftLateral')!;
    expect(wallThicknessMm(trunk, 5.5)).toBeGreaterThan(1.2);
    expect(wallThicknessMm(branch, 1.8)).toBeLessThan(0.6);
    // gradiente monótono con el calibre y acotado
    expect(wallThicknessMm(trunk, 3)).toBeLessThan(wallThicknessMm(trunk, 5));
    expect(wallThicknessMm(trunk, 20)).toBe(1.4);
    // las venas finas no cambian
    const hv = scene.vessels.find((v) => v.id === 'hvRight')!;
    expect(wallThicknessMm(hv, 1)).toBe(hv.wallMm);
  });
});
