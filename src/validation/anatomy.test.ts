import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER, wallThicknessMm, type FaceGeometry } from '../anatomy/scene';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT } from '../cases';
import { SimulationClock } from '../core/clock';
import { PhysiologyEngine } from '../physiology/engine';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, skinSoftness, type ProbePose } from '../probe/probe';
import { kidneyQuery, kidneyWorld } from '../anatomy/organs/kidney';
import { renalPatternFromPeaks } from '../vexus/classification';
import { VESSEL_META } from '../physiology/vessels';
import { BRANCH_MAX_RADIUS_SCALE } from '../anatomy/vesselTree';

describe('Anatomía implícita (base B)', () => {
  const scene = new AnatomyScene(NORMAL_ADULT);
  const cls = (p: [number, number, number]) => scene.classify(p, BASELINE_CALIBER);
  type V = [number, number, number];
  const sdf = (face: FaceGeometry) => (p: V) => scene.faceSdf(p, BASELINE_CALIBER, face);

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

  it('vesícula en pera curvada (decisión 67): fondo anteroinferolateral, cuello en «S» hacia el hilio, 30–50 mL', () => {
    const gb = scene.gallbladder;
    const [fundus, body, infundibulum, hartmann, neck] = gb.nodes;
    // el fondo es más bajo, más anterior y más lateral (derecha = −x) que el cuello
    expect(fundus.p[2]).toBeLessThan(neck.p[2]);
    expect(fundus.p[1]).toBeGreaterThan(neck.p[1]);
    expect(fundus.p[0]).toBeLessThan(neck.p[0]);
    // cuerpo ancho y cuello estrecho; la bolsa de Hartmann cuelga por debajo del infundíbulo y del cuello
    expect(body.r).toBeGreaterThan(2.5 * neck.r);
    expect(hartmann.p[2]).toBeLessThan(Math.min(infundibulum.p[2], neck.p[2]));
    // el cuello se dobla: > 40° entre el tramo de Hartmann y el del cuello
    const dir = (a: V, b: V): V => {
      const d: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(...d);
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    const d1 = dir(infundibulum.p as V, hartmann.p as V);
    const d2 = dir(hartmann.p as V, neck.p as V);
    expect((Math.acos(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) * 180) / Math.PI).toBeGreaterThan(40);
    // volumen y tamaño de una vesícula normal en ayunas (7–10 cm × ≤ 4 cm; 30–50 mL)
    const lo = [0, 1, 2].map((k) => Math.min(...gb.nodes.map((n) => n.p[k] - n.r)));
    const hi = [0, 1, 2].map((k) => Math.max(...gb.nodes.map((n) => n.p[k] + n.r)));
    const axis = dir(neck.p as V, fundus.p as V);
    let lumen = 0;
    let aMin = Infinity;
    let aMax = -Infinity;
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          if (sdf('gallbladder')([x, y, z])! >= 0) continue;
          lumen++;
          const a = x * axis[0] + y * axis[1] + z * axis[2];
          aMin = Math.min(aMin, a);
          aMax = Math.max(aMax, a);
        }
    expect(lumen / 1000).toBeGreaterThan(30);
    expect(lumen / 1000).toBeLessThan(50);
    expect(aMax - aMin).toBeGreaterThan(70);
    expect(aMax - aMin).toBeLessThan(100);
    expect(2 * body.r).toBeLessThanOrEqual(40);
    // bilis en el cuerpo y en el cuello; pared ecogénica alrededor de la luz
    expect(cls([...body.p] as V).tissue).toBe(Tissue.Fluid);
    expect(cls([...neck.p] as V).tissue).toBe(Tissue.Fluid);
    expect(scene.gallbladderWallMm).toBeLessThan(3);
  });

  it('pared vesicular única (decisión 67): la cápsula hepática de la fosa no dibuja su propia cara', () => {
    // desde el cuerpo hacia arriba (craneal) se cruza la luz, la pared y entra en el hígado por la fosa: la única
    // cara especular es la de la luz; la cápsula pegada a la pared no dibuja otra línea paralela
    const body = scene.gallbladder.nodes[1].p as V;
    const faces = new Set<Interface>();
    let reachedLiver = false;
    for (let t = 0; t < 40; t += 0.05) {
      const c = cls([body[0], body[1], body[2] + t]);
      if (c.interface !== Interface.None && c.interfaceDistance < 0.5) faces.add(c.interface);
      if (c.tissue === Tissue.Liver) {
        reachedLiver = true;
        break;
      }
    }
    expect(reachedLiver).toBe(true);
    expect([...faces]).toEqual([Interface.GallbladderLumen]);
  });

  it('ningún vaso ni conducto atraviesa la luz o la pared de la vesícula (decisión 67)', () => {
    // Antes la suprahepática media nacía en la fosa y cruzaba 34 mm de la luz (726 mm³, hasta 5,4 mm dentro): la
    // vena se dibujaba con flujo dentro de la bilis. Solo el cístico toca el cuello, donde nace.
    for (const p of CASES) {
      const sc = new AnatomyScene(p);
      const gb = sc.gallbladder;
      const lo = [0, 1, 2].map((k) => Math.min(...gb.nodes.map((n) => n.p[k] - n.r)) - 3);
      const hi = [0, 1, 2].map((k) => Math.max(...gb.nodes.map((n) => n.p[k] + n.r)) + 3);
      const inside = new Map<string, number>();
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const m: V = [x, y, z];
            if (sc.faceSdf(m, BASELINE_CALIBER, 'gallbladder')! >= sc.gallbladderWallMm) continue;
            const t = sc.faceTube(m, BASELINE_CALIBER);
            if (!t) continue;
            const id = t.vessel ?? 'conducto';
            inside.set(id, (inside.get(id) ?? 0) + 1);
          }
      const vessels = [...inside].filter(([id]) => id !== 'conducto');
      expect(vessels, p.id).toEqual([]);
      // el cístico solo entra en la punta del cuello
      expect(inside.get('conducto') ?? 0, p.id).toBeLessThan(60);
    }
    // la suprahepática media corre por encima de la fosa, a ≥ 5 mm de la pared aun con el calibre máximo
    const hvm = scene.vessels.find((v) => v.id === 'hvMiddle')!;
    const sMax = BRANCH_MAX_RADIUS_SCALE[VESSEL_META.hvMiddle.caliber];
    let clearance = Infinity;
    const nodes = hvm.tube.nodes;
    for (let i = 0; i < nodes.length - 1; i++)
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        const q: V = [0, 1, 2].map((j) => nodes[i].p[j] + (nodes[i + 1].p[j] - nodes[i].p[j]) * t) as V;
        const r = (nodes[i].r + (nodes[i + 1].r - nodes[i].r) * t) * sMax;
        clearance = Math.min(clearance, sdf('gallbladder')(q)! - scene.gallbladderWallMm - r);
      }
    expect(clearance).toBeGreaterThan(5);
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

  it('el acoplamiento es total en contacto y se pierde al separar o bascular (contacto de la decisión 63)', () => {
    const coupling = (pose: ProbePose, theta: number) => contactCoupling(probeContact(pose, CONVEX_C35, scene.torso), theta);
    const flat: ProbePose = { phi: 0, z: 0, lift: 0, yaw: 0, rock: 0, tilt: 0 };
    expect(coupling(flat, 0)).toBe(1);
    expect(coupling({ ...flat, lift: 12 }, 0)).toBe(0);
    const rocked = { ...flat, rock: 0.35 };
    expect(coupling(rocked, CONVEX_C35.halfSector)).toBeLessThan(coupling(rocked, -CONVEX_C35.halfSector));
    // la pared blanda del epigastrio absorbe la basculación: bajo el xifoides se conserva más
    // contacto que sobre las costillas del flanco con la misma basculación craneal (decisión 43)
    const mean = (pose: ProbePose) => {
      const k = probeContact(pose, CONVEX_C35, scene.torso);
      let c = 0;
      for (let i = 0; i <= 40; i++) c += contactCoupling(k, -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / 40) / 41;
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

describe('Caras geométricas del banco de interfaces (faceSdf)', () => {
  // La incidencia de cada pared y cada cara del banco (y la e2e de normales de la GPU) sale del
  // gradiente de `faceSdf`: debe valer la distancia de la clasificación, con su signo y pendiente 1.
  const scene = new AnatomyScene(NORMAL_ADULT);
  type V = [number, number, number];
  const sdf = (face: FaceGeometry) => (p: V) => scene.faceSdf(p, BASELINE_CALIBER, face);
  const grad = (f: (p: V) => number | null, p: V, eps = 0.02): V => {
    const g: V = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const plus: V = [...p];
      const minus: V = [...p];
      plus[a] += eps;
      minus[a] -= eps;
      g[a] = (f(plus)! - f(minus)!) / (2 * eps);
    }
    return g;
  };
  const along = (p: V, d: V, t: number): V => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
  /** Cruce con la cara (sdf = 0) sobre el segmento p0 → p0 + d·tMax, con sdf(p0) < 0 < sdf(fin). */
  const crossing = (face: FaceGeometry, p0: V, d: V, tMax: number): V => {
    let lo = 0;
    let hi = tMax;
    expect(sdf(face)(p0)!).toBeLessThan(0);
    expect(sdf(face)(along(p0, d, tMax))!).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (sdf(face)(along(p0, d, mid))! > 0) hi = mid;
      else lo = mid;
    }
    return along(p0, d, 0.5 * (lo + hi));
  };

  it('tubo: −r en el eje, la distancia a la luz con pendiente 1 en la pared y null fuera de todo tubo', () => {
    // tronco portal: tramo recto de radio constante 5,5 mm; radial hacia atrás y a la derecha
    const pv = scene.vessels.find((v) => v.id === 'pvTrunk')!;
    const [a, b] = [pv.tube.nodes[0].p, pv.tube.nodes[1].p];
    const axis: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(t[0], t[1]);
    const radial: V = [-t[1] / l, t[0] / l, 0];
    expect(pv.tube.nodes[0].r).toBe(5.5);
    expect(sdf('tube')(axis)).toBeCloseTo(-5.5, 6);
    expect(sdf('tube')(along(axis, radial, 5.3))).toBeCloseTo(-0.2, 6);
    // en la pared (0,5–1,4 mm) es positiva: la luz queda dentro
    expect(sdf('tube')(along(axis, radial, 5.8))).toBeCloseTo(0.3, 6);
    expect(sdf('tube')(along(axis, radial, 9))).toBeNull();
    expect(sdf('tube')([-60, 20, -10])).toBeNull(); // hígado sin vasos
    const g = grad(sdf('tube'), along(axis, radial, 5.3));
    expect(Math.abs(Math.hypot(...g) - 1)).toBeLessThan(1e-3);
    expect(g[0] * radial[0] + g[1] * radial[1] + g[2] * radial[2]).toBeGreaterThan(1 - 1e-5); // radial (error de las diferencias centrales)
  });

  it('cúpula, riñón, vesícula y superficie hepática: negativas dentro, positivas fuera y pendiente 1 en la cara', () => {
    // dentro / fuera de lo que encierra cada cara
    expect(sdf('dome')([-55, -5, 70])!).toBeLessThan(0); // tórax
    expect(sdf('dome')([-60, 20, -10])!).toBeGreaterThan(0); // abdomen
    expect(sdf('kidneyOuter')(scene.kidneyRight.center)!).toBeLessThan(0);
    expect(sdf('kidneyOuter')(scene.kidneyLeft.center)!).toBeLessThan(0);
    expect(sdf('kidneyOuter')([-60, 20, -10])!).toBeGreaterThan(0);
    expect(sdf('gallbladder')(scene.gallbladder.nodes[1].p)!).toBeLessThan(0);
    expect(sdf('gallbladder')([-60, 20, -10])!).toBeGreaterThan(0);
    expect(sdf('liverSurface')([-60, 20, -10])!).toBeLessThan(0);
    expect(sdf('liverSurface')([0, 75, -120])!).toBeGreaterThan(0); // músculo de la pared
    // la cara de la clasificación: la cápsula es −faceSdf < 0,8 mm dentro del hígado
    expect(cls0([-60, 20, -10]).boundaryDistance).toBeCloseTo(-sdf('liverSurface')([-60, 20, -10])!, 9);
    // pendiente 1 sobre la cara: cúpula (desde el pulmón hacia abajo), contorno renal (polo lateral y
    // polo superior), superficie hepática bajo la cúpula
    const exact: Array<[FaceGeometry, V, V, number]> = [
      ['dome', [-55, -5, 70], [0, 0, -1], 40],
      ['dome', [-70, 10, 60], [0, 0, -1], 40],
      ['kidneyOuter', [...scene.kidneyRight.center], [-1, 0, 0], 60],
      ['kidneyOuter', [...scene.kidneyRight.center], [...scene.kidneyRight.u], 80],
      ['liverSurface', [-60, 20, -10], [0, 0, 1], 80],
    ];
    for (const [face, p0, d, tMax] of exact) {
      const g = grad(sdf(face), crossing(face, p0, d, tMax));
      expect(Math.abs(Math.hypot(...g) - 1), `${face} desde ${p0.join(',')}`).toBeLessThan(1e-3);
    }
    // la vesícula es una cadena de conos redondeados: en el cuerpo, la distancia se aparta ≤ 1 % (el radio
    // crece solo 2,5 mm en los 20 mm del fondo al cuerpo)
    const gbBody = scene.gallbladder.nodes[1].p;
    const gb = grad(sdf('gallbladder'), crossing('gallbladder', [gbBody[0], gbBody[1], gbBody[2]], [0, 0, 1], 30));
    expect(Math.abs(Math.hypot(...gb) - 1)).toBeLessThan(0.01);
  });

  function cls0(p: V) {
    return scene.classify(p, BASELINE_CALIBER);
  }
});

describe('Caras de interfaz en classify (decisión 57)', () => {
  // Cada punto dice qué cara dibuja (una por estructura) y a qué distancia está de ella; la GPU dice
  // lo mismo (`Cls.iface`, `Cls.ifd`) y la e2e de equivalencia lo comprueba punto a punto.
  const scene = new AnatomyScene(NORMAL_ADULT);
  type V = [number, number, number];
  const cls = (p: V) => scene.classify(p, BASELINE_CALIBER);
  const sdf = (face: FaceGeometry, p: V) => scene.faceSdf(p, BASELINE_CALIBER, face)!;
  const along = (p: V, d: V, t: number): V => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
  /** Cruce de la cara (sdf = 0) entre p0 (sdf < 0) y p0 + d·tMax (sdf > 0). */
  const crossing = (face: FaceGeometry, p0: V, d: V, tMax: number, sign = 1): V => {
    let lo = 0;
    let hi = tMax;
    expect(sign * sdf(face, p0)).toBeLessThan(0);
    expect(sign * sdf(face, along(p0, d, tMax))).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (sign * sdf(face, along(p0, d, mid)) > 0) hi = mid;
      else lo = mid;
    }
    return along(p0, d, 0.5 * (lo + hi));
  };
  /** Primer punto (pasos de 0,05 mm) de `tissue` sobre p0 + d·t. */
  const first = (p0: V, d: V, tissue: Tissue, tMax: number): { p: V; t: number } => {
    for (let t = 0; t <= tMax; t += 0.05) if (cls(along(p0, d, t)).tissue === tissue) return { p: along(p0, d, t), t };
    throw new Error(`${Tissue[tissue]} no aparece`);
  };

  it('luz de la VCI: la sangre a 0,2 mm de la pared y la pared dibujan IvcLumen a |hit.d|', () => {
    const center: V = [-22, -16, 0];
    expect(cls(center).vessel).toBe('ivcInfra');
    const c = crossing('tube', center, [1, 0, 0], first(center, [1, 0, 0], Tissue.VesselWallThin, 20).t);
    const blood = cls(along(c, [1, 0, 0], -0.2));
    expect(blood.tissue).toBe(Tissue.Blood);
    expect(blood.interface).toBe(Interface.IvcLumen);
    expect(blood.interfaceDistance).toBeCloseTo(Math.abs(sdf('tube', along(c, [1, 0, 0], -0.2))), 6);
    expect(blood.interfaceDistance).toBeGreaterThan(0.1);
    const wall = cls(along(c, [1, 0, 0], 0.2));
    expect(wall.tissue).toBe(Tissue.VesselWallThin);
    expect(wall.interface).toBe(Interface.IvcLumen);
    expect(wall.interfaceDistance).toBeCloseTo(sdf('tube', along(c, [1, 0, 0], 0.2)), 6);
  });

  it('cada sistema tiene su cara de la luz: suprahepática, porta, arteria, colédoco y vesícula', () => {
    const mid = (nodes: { p: V }[]): V =>
      along(nodes[0].p, [nodes[1].p[0] - nodes[0].p[0], nodes[1].p[1] - nodes[0].p[1], nodes[1].p[2] - nodes[0].p[2]], 0.5);
    const hv = scene.vessels.find((v) => VESSEL_META[v.id].system === 'hepaticVein' && v.flowFactor === undefined)!;
    const hvCls = cls(mid(hv.tube.nodes));
    expect(hvCls.tissue).toBe(Tissue.Blood);
    expect(hvCls.interface).toBe(Interface.VeinLumen);
    expect(cls([-12, -8, -72]).vessel).toBe('pvTrunk');
    expect(cls([-12, -8, -72]).interface).toBe(Interface.PortalLumen);
    expect(cls([12, -24, 0]).vessel).toBe('aorta');
    expect(cls([12, -24, 0]).interface).toBe(Interface.ArteryLumen);
    const cbd = scene.ducts.find((d) => d.id === 'cbd')!;
    const cbdCls = cls(mid(cbd.tube.nodes));
    expect(cbdCls.tissue).toBe(Tissue.Fluid);
    expect(cbdCls.interface).toBe(Interface.DuctLumen);
    const gbBody = scene.gallbladder.nodes[1].p;
    const gb = cls([gbBody[0], gbBody[1], gbBody[2]]);
    expect(gb.tissue).toBe(Tissue.Fluid);
    expect(gb.interface).toBe(Interface.GallbladderLumen);
    expect(gb.interfaceDistance).toBeCloseTo(-sdf('gallbladder', [gbBody[0], gbBody[1], gbBody[2]]), 9);
  });

  it('diafragma: la mitad abdominal dibuja la cara hepática a 2,5 − dDome; la pleural, ninguna', () => {
    const c = crossing('dome', [-55, -5, 70], [0, 0, -1], 40);
    const pleural = along(c, [0, 0, -1], 0.5);
    expect(cls(pleural).tissue).toBe(Tissue.Diaphragm);
    expect(sdf('dome', pleural)).toBeLessThan(1.25);
    expect(cls(pleural).interface).toBe(Interface.None);
    const abdominal = along(c, [0, 0, -1], 2);
    const d = sdf('dome', abdominal);
    expect(d).toBeGreaterThan(1.25);
    expect(d).toBeLessThan(2.5);
    expect(cls(abdominal).tissue).toBe(Tissue.Diaphragm);
    expect(cls(abdominal).interface).toBe(Interface.DiaphragmLiver);
    expect(cls(abdominal).interfaceDistance).toBeCloseTo(2.5 - d, 9);
  });

  it('cápsula hepática: dibuja su cara bajo la pared, no junto al diafragma ni en Morison', () => {
    const liver: V = [-60, 20, -10];
    const underWall = along(crossing('liverSurface', liver, [0, 1, 0], 90), [0, 1, 0], -0.3);
    expect(cls(underWall).tissue).toBe(Tissue.LiverCapsule);
    expect(cls(underWall).interface).toBe(Interface.LiverCapsule);
    expect(cls(underWall).interfaceDistance).toBeCloseTo(-sdf('liverSurface', underWall), 9);
    // bajo la cúpula manda la cara del diafragma
    const underDome = along(crossing('liverSurface', liver, [0, 0, 1], 80), [0, 0, 1], -0.3);
    expect(cls(underDome).tissue).toBe(Tissue.LiverCapsule);
    expect(cls(underDome).interface).toBe(Interface.None);
    // Morison: subiendo desde el riñón derecho, grasa perirrenal y enseguida la cápsula, que la toca
    const k = scene.kidneyRight.center;
    const morison = first(k, [0, 0, 1], Tissue.LiverCapsule, 70);
    expect(cls(along(k, [0, 0, 1], morison.t - 0.3)).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(morison.p).interface).toBe(Interface.None);
  });

  it('riñón: cápsula renal y mitad interna de la grasa dibujan la cápsula; la mitad externa, la grasa', () => {
    const k = scene.kidneyRight;
    const up: V = [0, 0, 1];
    const dOuter = (p: V) => kidneyQuery(p, k).dOuter;
    const capsule = first(k.center, up, Tissue.RenalCapsule, 70).p;
    const capsuleIn = along(capsule, up, 0.2);
    expect(cls(capsuleIn).tissue).toBe(Tissue.RenalCapsule);
    expect(cls(capsuleIn).interface).toBe(Interface.RenalCapsule);
    expect(cls(capsuleIn).interfaceDistance).toBeCloseTo(-dOuter(capsuleIn), 9);
    const fat = first(k.center, up, Tissue.PerirenalFat, 70).p;
    const inner = along(fat, up, 0.5);
    const outer = along(fat, up, 3.2);
    expect(dOuter(inner)).toBeLessThan(2);
    expect(dOuter(outer)).toBeGreaterThan(2);
    expect(cls(inner).interface).toBe(Interface.RenalCapsule);
    expect(cls(inner).interfaceDistance).toBeCloseTo(dOuter(inner), 9);
    expect(cls(outer).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(outer).interface).toBe(Interface.PerirenalFat);
    expect(cls(outer).interfaceDistance).toBeCloseTo(scene.perirenalMm - dOuter(outer), 9);
  });

  it('la VCI que entra en la aurícula no dibuja su cara dentro de ella; por debajo, sí', () => {
    // el último nodo de la VCI suprahepática está a ~24 mm del centro de la aurícula (r 30): ~13 mm de tubo
    // y su tapa quedan dentro. classify prueba los tubos antes que la aurícula, así que su pared y su luz
    // se clasifican ahí; la cara no (antes, un eco de pared a +13–14 dB sobre el hígado en la cavidad negra)
    const ra = scene.rightAtrium;
    const inRa = (p: V) => Math.hypot(p[0] - ra.center[0], p[1] - ra.center[1], p[2] - ra.center[2]) < ra.r;
    const supra = scene.vessels.find((v) => v.id === 'ivcSupra')!;
    const last = supra.tube.nodes[supra.tube.nodes.length - 1].p;
    const prev = supra.tube.nodes[supra.tube.nodes.length - 2].p;
    expect(inRa(last)).toBe(true);
    expect(inRa(prev)).toBe(false);
    let tubeInRa = 0;
    let tubeBelow = 0;
    for (let x = -14; x <= 14; x += 0.5)
      for (let y = -14; y <= 14; y += 0.5)
        for (const f of [0.6, 0.8, 1, 1.1]) {
          const p: V = along(prev, [last[0] - prev[0], last[1] - prev[1], last[2] - prev[2]], f);
          p[0] += x;
          p[1] += y;
          const c = cls(p);
          if (scene.faceSdf(p, BASELINE_CALIBER, 'tube') === null) continue;
          if (inRa(p)) {
            tubeInRa++;
            expect(c.interface, `${p.map((v) => v.toFixed(1)).join(', ')}`).toBe(Interface.None);
            expect(c.interfaceDistance).toBe(1e3);
            // el tubo sigue clasificando su tejido: solo se quita la cara
            expect([Tissue.Blood, Tissue.VesselWallThin]).toContain(c.tissue);
          } else if (c.tissue === Tissue.Blood || c.tissue === Tissue.VesselWallThin) {
            tubeBelow++;
            expect(c.interface).toBe(Interface.IvcLumen);
          }
        }
    expect(tubeInRa).toBeGreaterThan(200);
    expect(tubeBelow).toBeGreaterThan(200);
  });

  it('hígado, intestino y pulmón no dibujan cara; el músculo de la pared, la de su capa (decisión 62)', () => {
    for (const [p, t] of [
      [[-60, 20, -10], Tissue.Liver],
      [[40, 40, -120], Tissue.Bowel],
      [[-55, -5, 70], Tissue.Lung],
    ] as [V, Tissue][]) {
      expect(cls(p).tissue).toBe(t);
      expect(cls(p).interface, Tissue[t]).toBe(Interface.None);
      expect(cls(p).interfaceDistance).toBe(1e3);
    }
    // a 20 mm bajo la piel (músculo de 16 a 25,9 mm): la cara de pared más cercana, a menos de medio músculo
    const muscle = cls([-64, 76.8, -10]);
    expect(muscle.tissue).toBe(Tissue.Muscle);
    expect([Interface.DeepFascia, Interface.ObliquePlane, Interface.TransversusPlane, Interface.Transversalis]).toContain(muscle.interface);
    expect(muscle.interfaceDistance).toBeLessThan(5);
    // antes era músculo; ahora la grasa preperitoneal (2,1 mm) de la cara interna de la pared
    expect(cls([-60, 72, -10]).tissue).toBe(Tissue.Fat);
  });
});
