import { describe, expect, it } from 'vitest';
import { AnatomyQuery } from '../anatomy/query';
import { uncompress } from '../anatomy/compression';
import { START_POINTS } from '../app/startPoints';
import { AnatomyScene, BASELINE_CALIBER, wallThicknessMm, type FaceGeometry } from '../anatomy/scene';
import { Interface } from '../anatomy/interfaces';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { CASES, NORMAL_ADULT } from '../cases';
import { SimulationClock } from '../core/clock';
import { PhysiologyEngine } from '../physiology/engine';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame, skinSoftness, type ProbePose } from '../probe/probe';
import {
  ARCUATE,
  MEDULLA_MIN_DEPTH_MM,
  PERIRENAL,
  PYRAMIDS,
  RENAL_IMPRESSION_OVERLAP_MM,
  hilumChannelSdf,
  kidneyLocal,
  kidneyOuterSdf,
  kidneyQuery,
  kidneySinusSdf,
  kidneyWorld,
  perirenalThicknessMm,
  sdRoundCone,
} from '../anatomy/organs/kidney';
import { sdEllipsoidLocal, sdSpine, tubeQuery } from '../anatomy/primitives';
import { HEART_WALLS, domeFloor, heartChambers, ivcAtrium } from '../anatomy/organs/heart';
import { renalPatternFromPeaks } from '../vexus/classification';
import { VESSEL_META } from '../physiology/vessels';
import { BRANCH_MAX_RADIUS_SCALE, BRANCH_TIP_RADIUS_MM, RENAL_VEIN_SINUS_V, branchShapeMax } from '../anatomy/vesselTree';

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
    // el pulmón derecho, lateral a la aurícula y a la grasa del ángulo cardiofrénico (decisión 85)
    expect(cls([-75, -5, 70]).tissue).toBe(Tissue.Lung);
    expect(cls([12, -24, 0]).vessel).toBe('aorta');
    expect(cls([-14, 4, -75]).vessel).toBe('pvTrunk');
  });

  it('la fisura umbilical excava el lóbulo izquierdo y la rellena el ligamento redondo (ecogénico)', () => {
    // dentro de la fisura: x 15, sobre la cara visceral del lóbulo izquierdo (en cuña desde la decisión 72: a (15, 56)
    // queda a z ≈ −44), tercio inferior
    expect(cls([15, 56, -40]).tissue).toBe(Tissue.LigamentumTeres);
    // fuera de la lámina (x 25) y por encima de zMax (z −30): hígado normal
    expect(cls([25, 56, -40]).tissue).toBe(Tissue.Liver);
    expect(cls([15, 36, -20]).tissue).toBe(Tissue.Liver);
    // más hondo que la fisura (14 mm desde la cara visceral) y por encima de zMax: hígado
    expect(cls([15, 40, -28]).tissue).toBe(Tissue.Liver);
    // el SDF con fisura es ≥ el SDF base en todo punto (solo excava, nunca añade)
    for (const p of [
      [15, 56, -40],
      [15, 40, -28],
      [-60, 20, -10],
      [15, 36, -20],
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
    const d1 = dir(infundibulum.p, hartmann.p);
    const d2 = dir(hartmann.p, neck.p);
    expect((Math.acos(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) * 180) / Math.PI).toBeGreaterThan(40);
    // volumen y tamaño de una vesícula normal en ayunas (7–10 cm × ≤ 4 cm; 30–50 mL)
    const lo = [0, 1, 2].map((k) => Math.min(...gb.nodes.map((n) => n.p[k] - n.r)));
    const hi = [0, 1, 2].map((k) => Math.max(...gb.nodes.map((n) => n.p[k] + n.r)));
    const axis = dir(neck.p, fundus.p);
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
    const body = scene.gallbladder.nodes[1].p;
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
    // vena se dibujaba con flujo dentro de la bilis. Solo el cístico toca el cuello, donde nace: el colédoco (antes
    // 1,4 mm dentro de la pared del cuello, con su luz a 1 mm de la bilis, decisión 69) y los hepáticos, nunca.
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
            if (t?.vessel) inside.set(t.vessel, (inside.get(t.vessel) ?? 0) + 1);
            // cada conducto por separado, con su luz y su pared (la clasificación solo ve el que gana)
            for (const d of sc.ducts)
              if (tubeQuery(m, d.tube, 1).d < d.wallMm) inside.set(`conducto ${d.id}`, (inside.get(`conducto ${d.id}`) ?? 0) + 1);
          }
      expect(
        [...inside].filter(([id]) => id !== 'conducto cysticDuct'),
        p.id,
      ).toEqual([]);
      // el cístico solo entra en la punta del cuello
      expect(inside.get('conducto cysticDuct') ?? 0, p.id).toBeLessThan(60);
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
    expect(cls([-14, 4 - 6.1, -75]).tissue).toBe(Tissue.VesselWallPortal);
    // la arteria hepática propia corre por delante y a la izquierda de la porta hacia el hilio (decisión 69)
    expect(cls([-18, 8, -49]).vessel).toBe('hepaticArtery');
    // pared lateral de la VCI a z 0 (eje interpolado entre sus nodos)
    const ivc = scene.vessels.find((v) => v.id === 'ivcInfra')!.tube.nodes;
    const k = ivc.findIndex((n, i) => i < ivc.length - 1 && n.p[2] <= 0 && ivc[i + 1].p[2] > 0);
    const t = (0 - ivc[k].p[2]) / (ivc[k + 1].p[2] - ivc[k].p[2]);
    const c = [0, 1, 2].map((j) => ivc[k].p[j] + (ivc[k + 1].p[j] - ivc[k].p[j]) * t);
    // (su calibre ondula a lo largo del eje, decisión 90: la pared lateral, justo más allá de la luz, a ~1 cm del eje)
    let lat = 9;
    while (cls([c[0] - lat, c[1], 0]).tissue === Tissue.Blood) lat += 0.05;
    expect(lat).toBeGreaterThan(9.5);
    expect(lat).toBeLessThan(11);
    expect(cls([c[0] - lat - 0.4, c[1], 0]).tissue).toBe(Tissue.VesselWallThin);
  });

  it('VCI y aorta (decisión 69): VCI curva con embudo, por delante de la aorta arriba; ramas viscerales en su orden', () => {
    const tubeOf = (id: string) => scene.vessels.find((v) => v.id === id)!.tube;
    // eje de un tubo a una altura z (interpolado entre sus nodos)
    const axisAt = (id: string, z: number): [number, number, number] => {
      const n = tubeOf(id).nodes;
      for (let i = 0; i < n.length - 1; i++) {
        const [a, b] = [n[i].p, n[i + 1].p];
        if ((a[2] - z) * (b[2] - z) <= 0 && a[2] !== b[2]) {
          const t = (z - a[2]) / (b[2] - a[2]);
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z];
        }
      }
      throw new Error(`${id} no llega a z ${z}`);
    };
    const ivcAt = (z: number) => axisAt(z >= 35 ? 'ivcSupra' : 'ivcInfra', z);
    // la VCI no es recta: entre el nivel renal y la AD (su orificio, decisión 85) sube hacia delante más de 15 mm, sin saltos
    expect(ivcAt(60)[1] - ivcAt(-60)[1]).toBeGreaterThan(15);
    let prev = ivcAt(-60)[1];
    for (let z = -50; z <= 60; z += 10) {
      const y = ivcAt(z)[1];
      expect(y - prev, `z ${z}`).toBeGreaterThan(-1.5);
      expect(y - prev, `z ${z}`).toBeLessThan(6);
      prev = y;
    }
    // por delante de la aorta: ≥ 10 mm en el segmento retrohepático y ≥ 20 mm cerca de la AD; casi a la par en el renal
    expect(ivcAt(15)[1] - axisAt('aorta', 15)[1]).toBeGreaterThan(10);
    expect(ivcAt(60)[1] - axisAt('aorta', 60)[1]).toBeGreaterThan(20);
    expect(Math.abs(ivcAt(-62)[1] - axisAt('aorta', -62)[1])).toBeLessThan(10);
    // a la derecha de la aorta, a ~30 mm entre centros
    expect(axisAt('aorta', -62)[0] - ivcAt(-62)[0]).toBeGreaterThan(25);
    // embudo hacia la AD
    const sup = tubeOf('ivcSupra').nodes;
    expect(sup[sup.length - 1].r).toBeGreaterThan(sup[0].r + 2);
    // ramas viscerales por la cara anterior: celíaco por encima de la AMS, y esta por encima de las renales
    const originZ = (id: string) => tubeOf(id).nodes[0].p[2];
    expect(originZ('celiacTrunk')).toBeGreaterThan(originZ('sma'));
    expect(originZ('sma')).toBeGreaterThan(originZ('renalArteryRight'));
    expect(cls(tubeOf('celiacTrunk').nodes[1].p).vessel).toBe('celiacTrunk');
    expect(cls(tubeOf('sma').nodes[2].p).vessel).toBe('sma');
    // la hepática nace del celíaco (no de la aorta)
    const ha0 = tubeOf('hepaticArtery').nodes[0].p;
    const celEnd = tubeOf('celiacTrunk').nodes.at(-1)!.p;
    expect(Math.hypot(ha0[0] - celEnd[0], ha0[1] - celEnd[1], ha0[2] - celEnd[2])).toBeLessThan(1);
    // la porta pasa por delante de la VCI con un hueco (hiato de Winslow) y no toca la aorta ni la vena renal izquierda
    for (const z of [-75, -60]) {
      const pv = axisAt('pvTrunk', z);
      const ivc = ivcAt(z);
      expect(pv[1] - ivc[1], `z ${z}`).toBeGreaterThan(10);
    }
    const pvNodes = tubeOf('pvTrunk').nodes;
    for (const other of ['aorta', 'renalVeinLeft', 'ivcInfra'] as const) {
      let clearance = Infinity;
      for (let i = 0; i < pvNodes.length - 1; i++)
        for (let t = 0; t <= 1; t += 0.05) {
          const q = [0, 1, 2].map((j) => pvNodes[i].p[j] + (pvNodes[i + 1].p[j] - pvNodes[i].p[j]) * t) as [number, number, number];
          const r = pvNodes[i].r + (pvNodes[i + 1].r - pvNodes[i].r) * t;
          clearance = Math.min(clearance, tubeQuery(q, tubeOf(other), 1).d - r);
        }
      expect(clearance, other).toBeGreaterThan(2);
    }
    // holguras entre paredes (≥ 0) de los pares que chocaban (revisión de la decisión 69): la vena renal izquierda con la
    // aorta (3,45 mm de su luz dentro de la aórtica, sin pared entre ambas) y con la AMS en la pinza; la hepática con el
    // cístico (−0,8 mm entre luces) y con el colédoco (−2,8 mm)
    const tubeDef = (id: string) => {
      const v = scene.vessels.find((x) => x.id === id && x.flowFactor === undefined);
      if (v) return { tube: v.tube, wall: (r: number) => wallThicknessMm(v, r) };
      const d = scene.ducts.find((x) => x.id === id)!;
      return { tube: d.tube, wall: () => d.wallMm };
    };
    const wallGap = (a: string, b: string) => {
      const [A, B] = [tubeDef(a), tubeDef(b)];
      let gap = Infinity;
      const n = A.tube.nodes;
      for (let i = 0; i < n.length - 1; i++)
        for (let k = 0; k <= 100; k++) {
          const t = k / 100;
          const q = [0, 1, 2].map((j) => n[i].p[j] + (n[i + 1].p[j] - n[i].p[j]) * t) as [number, number, number];
          const r = n[i].r + (n[i + 1].r - n[i].r) * t;
          const h = tubeQuery(q, B.tube, 1);
          gap = Math.min(gap, h.d - B.wall(h.r) - r - A.wall(r));
        }
      return gap;
    };
    for (const [a, b] of [
      ['renalVeinLeft', 'aorta'],
      ['renalVeinLeft', 'sma'],
      ['cysticDuct', 'hepaticArtery'],
      ['hepaticArtery', 'cbd'],
    ] as const)
      expect(Math.min(wallGap(a, b), wallGap(b, a)), `${a} × ${b}`).toBeGreaterThanOrEqual(0);
    // la pinza aortomesentérica: 10–28 mm entre las luces de la aorta y de la AMS donde la cruza la vena renal izquierda
    // (antes 8), con la vena más estrecha allí que junto al hilio
    const lrv = tubeOf('renalVeinLeft').nodes;
    const clamp = lrv.reduce((best, n) =>
      Math.abs(n.p[0] - axisAt('aorta', n.p[2])[0]) < Math.abs(best.p[0] - axisAt('aorta', best.p[2])[0]) ? n : best,
    );
    const radiusAt = (id: string, z: number) => {
      const n = tubeOf(id).nodes;
      const i = n.findIndex((a, j) => j < n.length - 1 && (a.p[2] - z) * (n[j + 1].p[2] - z) <= 0);
      return n[i].r + ((n[i + 1].r - n[i].r) * (z - n[i].p[2])) / (n[i + 1].p[2] - n[i].p[2]);
    };
    const ao = axisAt('aorta', clamp.p[2]);
    const sm = axisAt('sma', clamp.p[2]);
    const amd = Math.hypot(sm[0] - ao[0], sm[1] - ao[1]) - radiusAt('aorta', clamp.p[2]) - radiusAt('sma', clamp.p[2]);
    expect(amd).toBeGreaterThan(10);
    expect(amd).toBeLessThan(28);
    expect(clamp.r).toBeLessThan(lrv[1].r);
    // la aorta apoya en la cara anterior izquierda de la vértebra sin hundirse en ella (antes su luz entraba 4,8 mm y el
    // 9 % de ella se clasificaba como vértebra, que va antes que los tubos)
    const aorta = scene.vessels.find((v) => v.id === 'aorta')!;
    let spineGap = Infinity;
    const an = aorta.tube.nodes;
    for (let i = 0; i < an.length - 1; i++)
      for (let k = 0; k <= 100; k++) {
        const t = k / 100;
        const q = [0, 1, 2].map((j) => an[i].p[j] + (an[i + 1].p[j] - an[i].p[j]) * t) as [number, number, number];
        spineGap = Math.min(spineGap, sdSpine(q, scene.spine) - (an[i].r + (an[i + 1].r - an[i].r) * t) - aorta.wallMm);
      }
    expect(spineGap).toBeGreaterThanOrEqual(0);
  });

  it('suprahepáticas: tres troncos, tributarias y tronco común que desemboca en la cava', () => {
    expect(cls([-68, -18, 10]).vessel).toBe('hvRight');
    expect(cls([-30, 4, 12]).vessel).toBe('hvMiddle');
    expect(cls([0, 6, 26]).vessel).toBe('hvLeft');
    expect(cls([-83, -12, -5]).vessel).toMatch(/^hvRight/);
    // el tronco común y la desembocadura de la derecha están dentro de la cava supra
    for (const p of [
      [-20, -1, 50],
      [-27, -9, 39],
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
    // la rama del segmento III sube por delante dentro de la cuña del segmento lateral (decisión 72)
    expect(cls([23, 64, -17]).vessel).toBe('pvLeftLateral');
    expect(cls([-100, 30, -19]).vessel).toBe('pvRightAnterior');
    // colédoco: luz anecoica con pared ecogénica, sin vaso, a la derecha y por delante de la porta (decisión 69)
    const cbd = cls([-26, 12, -69]);
    expect(cbd.tissue).toBe(Tissue.Fluid);
    expect(cbd.vessel).toBeNull();
    expect(cls([-26, 12 + 3.1, -69]).tissue).toBe(Tissue.BileDuctWall);
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

  it('riñón realista (decisión 68): pirámides distintas bajo la corteza, seno digitado, pelvis colapsada, grasa variable', () => {
    const k = scene.kidneyRight;
    // pirámides: conos redondeados de tamaños distintos, bajo ≥ 6,5 mm de corteza
    const bases = PYRAMIDS.map((p) => p.baseR);
    expect(Math.max(...bases) - Math.min(...bases)).toBeGreaterThan(1.5);
    expect(PYRAMIDS.length).toBeGreaterThanOrEqual(12);
    // el centro de la base de cada pirámide queda bajo la corteza (7,5 mm de la cápsula por su eje)
    for (const p of PYRAMIDS) expect(-kidneyOuterSdf(p.base, k)).toBeGreaterThan(7);
    // …y toda su superficie visible (médula): el casquete de la base, de radio baseR, llegaba a 3 mm de la cápsula
    // (mediana de 3,9 mm de corteza sobre las pirámides). Rayos desde cinco puntos del eje hasta la superficie del cono;
    // justo dentro, donde es médula (ni seno ni corteza), su profundidad bajo la cápsula
    expect(MEDULLA_MIN_DEPTH_MM).toBeGreaterThanOrEqual(6.5);
    let surfaceMin = Infinity;
    PYRAMIDS.forEach((p, i) => {
      const cone = (q: V) => sdRoundCone(q, p.apex, p.base, p.apexR, p.baseR);
      let seen = 0;
      for (let a = 0; a <= 4; a++) {
        const c: V = [0, 1, 2].map((j) => p.apex[j] + ((p.base[j] - p.apex[j]) * a) / 4) as V;
        for (let n = 0; n < 160; n++) {
          // direcciones de Fibonacci en la esfera
          const z = 1 - (2 * (n + 0.5)) / 160;
          const rr = Math.sqrt(1 - z * z);
          const ph = n * 2.399963229728653;
          const d: V = [rr * Math.cos(ph), rr * Math.sin(ph), z];
          let lo = 0;
          let hi = 0.5;
          while (cone([c[0] + d[0] * hi, c[1] + d[1] * hi, c[2] + d[2] * hi]) < 0) hi += 0.5;
          for (let it = 0; it < 40; it++) {
            const mid = 0.5 * (lo + hi);
            if (cone([c[0] + d[0] * mid, c[1] + d[1] * mid, c[2] + d[2] * mid]) < 0) lo = mid;
            else hi = mid;
          }
          const q: V = [c[0] + d[0] * (lo - 0.05), c[1] + d[1] * (lo - 0.05), c[2] + d[2] * (lo - 0.05)];
          const kh = kidneyQuery(kidneyWorld(q, k), k);
          if (kh.region !== 'medulla') continue;
          seen++;
          surfaceMin = Math.min(surfaceMin, -kh.dOuter);
        }
      }
      // cada pirámide conserva médula visible
      expect(seen, `pirámide ${i}`).toBeGreaterThan(20);
    });
    expect(surfaceMin).toBeGreaterThanOrEqual(6.5);
    // en el corte coronal por el eje largo (plano u–v) se ven ≥ 5 pirámides separadas, siempre con corteza encima
    const blobs = new Set<number>();
    for (let u = -50; u <= 50; u += 1)
      for (let v = -27; v <= 27; v += 1) {
        const q: V = [u, v, 0];
        const kh = kidneyQuery(kidneyWorld(q, k), k);
        if (kh.region !== 'medulla') continue;
        expect(-kh.dOuter).toBeGreaterThan(MEDULLA_MIN_DEPTH_MM);
        let best = 0;
        let bd = Infinity;
        PYRAMIDS.forEach((p, i) => {
          const dd = sdRoundCone(q, p.apex, p.base, p.apexR, p.baseR);
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        });
        blobs.add(best);
      }
    expect(blobs.size).toBeGreaterThanOrEqual(5);
    // pelvis colapsada: a lo sumo una hendidura de ≤ 2,5 mm de grosor anteroposterior
    let pelvisAp = 0;
    for (let w = -5; w <= 5; w += 0.1) if (kidneyQuery(kidneyWorld([0, k.sinusOffset + 3, w], k), k).region === 'pelvis') pelvisAp += 0.1;
    expect(pelvisAp).toBeLessThanOrEqual(2.5);
    // seno digitado: el radio del borde del seno en el plano coronal varía más que el de un óvalo liso
    const radii: number[] = [];
    for (let a = 0; a < 72; a++) {
      const th = (2 * Math.PI * a) / 72;
      let r = 0;
      while (r < 40 && kidneySinusSdf([Math.cos(th) * r * 2.2, k.sinusOffset + Math.sin(th) * r, 0], k) < 0) r += 0.1;
      radii.push(r);
    }
    const ellipse = radii.map((_, a) => {
      const th = (2 * Math.PI * a) / 72;
      let r = 0;
      while (r < 40 && sdEllipsoidLocal([Math.cos(th) * r * 2.2, Math.sin(th) * r, 0], k.sinusRadii) < 0) r += 0.1;
      return r;
    });
    const bumps = radii.map((r, a) => r - ellipse[a]);
    expect(Math.max(...bumps)).toBeGreaterThan(2);
    // grasa perirrenal: fina en Morison (anterolateral), gruesa detrás y en los polos
    const t = (q: V) => perirenalThicknessMm(q, k);
    expect(t([0, -20, 15])).toBeLessThan(1.5);
    expect(t([0, 0, -23])).toBeGreaterThan(6);
    expect(t([54, 0, 0])).toBeGreaterThan(6);
    expect(t([-54, 0, 0])).toBeGreaterThan(6);
    // en los dos riñones, fina delante y gruesa detrás (el izquierdo es especular: su w apunta hacia atrás; antes tenía
    // 8,2 mm delante y 1,2 detrás). Grosor en el punto del contorno por el que sale un rayo del centro hacia ±y
    for (const kk of [scene.kidneyRight, scene.kidneyLeft]) {
      const along = (dy: number) => {
        let r = 0;
        while (kidneyOuterSdf(kidneyLocal([kk.center[0], kk.center[1] + dy * r, kk.center[2]], kk), kk) < 0) r += 0.05;
        return perirenalThicknessMm(kidneyLocal([kk.center[0], kk.center[1] + dy * r, kk.center[2]], kk), kk);
      };
      const side = kk === scene.kidneyRight ? 'derecho' : 'izquierdo';
      expect(along(1), `${side}, delante`).toBeLessThan(2.5);
      expect(along(-1), `${side}, detrás`).toBeGreaterThan(6);
    }
  });

  // Decisión 87 (juez ciego, ronda 3): «pirámides como tres hendiduras oscuras» (eran las interlobares; las pirámides, bandas
  // de 4–6 mm que el cáliz se comía), «la cápsula no cierra», «el seno es el mismo moteado más brillante» y «una columna
  // negra que cruza el contorno» (la vena renal desde el centro del seno, no la pelvis, que no está en el plano)
  it('riñón (decisión 87): conos de médula hasta el seno, arcuatos en su base, hilio sin cápsula y sin columna negra', () => {
    const k = scene.kidneyRight;
    const region = (q: V) => kidneyQuery(kidneyWorld(q, k), k).region;
    // pirámides: por su eje, la médula visible empieza a ≤ 3 mm de la papila (el cáliz la ahueca, no se la come) y mide
    // ≥ 8 mm en la fila lateral (antes 4,3–6,3), ≥ 4,5 mm en las demás (antes 0–1,4 en la anterior y la posterior)
    PYRAMIDS.forEach((p, i) => {
      const d: V = [p.base[0] - p.apex[0], p.base[1] - p.apex[1], p.base[2] - p.apex[2]];
      const L = Math.hypot(...d);
      let first = NaN;
      let last = NaN;
      for (let t = -3; t <= L + 3; t += 0.05) {
        if (region([p.apex[0] + (d[0] * t) / L, p.apex[1] + (d[1] * t) / L, p.apex[2] + (d[2] * t) / L]) !== 'medulla') continue;
        if (Number.isNaN(first)) first = t;
        last = t;
      }
      expect(first, `pirámide ${i}`).toBeLessThan(3);
      expect(last - first, `pirámide ${i}`).toBeGreaterThan(i < 4 ? 8 : 4.5);
    });
    // la médula es ≥ 15 % del parénquima del corte coronal (antes 10,6 %) y sigue bajo ≥ 7 mm de corteza (decisión 68)
    let med = 0;
    let par = 0;
    for (let u = -56; u <= 56; u += 0.5)
      for (let v = -29; v <= 29; v += 0.5) {
        const kh = kidneyQuery(kidneyWorld([u, v, 0], k), k);
        if (kh.dOuter >= 0) continue;
        const r = kh.region;
        if (r === 'medulla') med++;
        if (r === 'medulla' || r === 'cortex' || r === 'arcuate') par++;
      }
    expect(med / par).toBeGreaterThan(0.15);
    // arcuatos: pared arterial en el borde de la base de cada pirámide de los dos riñones (el izquierdo, especular), a ≤
    // halfMm de la unión corticomedular (se busca alrededor de la base, en el marco del cono: la unión es curva y el eje de
    // las pirámides se abre en abanico)
    for (const kk of [scene.kidneyRight, scene.kidneyLeft])
      PYRAMIDS.forEach((p, i) => {
        const n: V = [p.base[0] - p.apex[0], p.base[1] - p.apex[1], p.base[2] - p.apex[2]];
        const l = Math.hypot(...n);
        const a: V = [n[0] / l, n[1] / l, n[2] / l];
        const h = Math.abs(a[0]) < 0.9 ? ([1, 0, 0] as V) : ([0, 1, 0] as V);
        const c1: V = [a[1] * h[2] - a[2] * h[1], a[2] * h[0] - a[0] * h[2], a[0] * h[1] - a[1] * h[0]];
        const l1 = Math.hypot(...c1);
        const e1: V = [c1[0] / l1, c1[1] / l1, c1[2] / l1];
        const e2: V = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
        let arc = 0;
        for (let f = 0; f < 16; f++) {
          const ph = (2 * Math.PI * f) / 16;
          const e: V = [0, 1, 2].map((j) => Math.cos(ph) * e1[j] + Math.sin(ph) * e2[j]) as V;
          for (let t = 0; t <= p.baseR + 1; t += 0.25)
            for (let sa = -4; sa <= 3; sa += 0.25) {
              const q: V = [0, 1, 2].map((j) => p.base[j] + e[j] * t + a[j] * sa) as V;
              const kh = kidneyQuery(kidneyWorld(q, kk), kk);
              if (kh.region !== 'arcuate') continue;
              // la clasificación lo da como pared arterial (sin luz ni vaso)
              if (arc++ === 0) expect(cls(kidneyWorld(q, kk))).toMatchObject({ tissue: Tissue.ArteryWall, vessel: null });
              expect(Math.abs(-kh.dOuter - MEDULLA_MIN_DEPTH_MM), `pirámide ${i}`).toBeLessThan(ARCUATE.halfMm + 1e-9);
            }
        }
        expect(arc, `pirámide ${i}`).toBeGreaterThan(20);
      });
    // …y no en las columnas de Bertin: a la profundidad de la unión, entre dos pirámides laterales, corteza
    expect(region([-2.8, -20, 0])).toBe('cortex');
    // el radio del canal del hilio de la GPU es el del riñón derecho (`uKidExtra.x`): los dos riñones deben compartirlo
    expect(scene.kidneyLeft.hilumRadius).toBe(scene.kidneyRight.hilumRadius);
    // hilio: por el eje del canal del seno, del seno a la grasa perirrenal sin cápsula ni cara (antes la cápsula cruzaba la
    // boca del hilio); fuera del canal, el contorno sí tiene su cápsula
    const seq: string[] = [];
    for (let v = 8; v <= 34; v += 0.1) {
      const c = cls(kidneyWorld([0, v, -1], k));
      if (c.tissue === Tissue.PerirenalFat) expect(c.interface, `v ${v.toFixed(1)}`).toBe(Interface.None);
      if (seq[seq.length - 1] !== Tissue[c.tissue]) seq.push(Tissue[c.tissue]);
    }
    expect(seq).not.toContain('RenalCapsule');
    expect(seq).toContain('PerirenalFat');
    expect(hilumChannelSdf([0, 20, -1], k)).toBeLessThan(0);
    // cierre del contorno: en el corte coronal, todo rayo del centro que no sale por el hilio cruza la cápsula renal
    for (let a = 0; a < 72; a++) {
      const th = (2 * Math.PI * a) / 72;
      const dir: V = [Math.cos(th), Math.sin(th), 0];
      let r = 0;
      while (kidneyOuterSdf([dir[0] * r, dir[1] * r, 0], k) < 0) r += 0.05;
      const q: V = [dir[0] * (r - 0.3), dir[1] * (r - 0.3), 0];
      if (hilumChannelSdf(q, k) < 0) continue;
      expect(cls(kidneyWorld(q, k)).tissue, `${a * 5}°`).toBe(Tissue.RenalCapsule);
    }
    // sin columna negra: la vena renal nace en el borde medial del seno (en su antiguo nodo, el centro del seno, hay grasa
    // del seno) y dentro del contorno del riñón ocupa < 0,2 cm³ (0,08; antes 0,71)
    expect(cls(kidneyWorld([0, 8, 5], k)).tissue).toBe(Tissue.RenalSinus);
    expect(RENAL_VEIN_SINUS_V).toBeGreaterThan(k.sinusOffset + k.sinusRadii[1] - 2);
    let vein = 0;
    for (let u = -10; u <= 10; u += 0.5)
      for (let v = 0; v <= 30; v += 0.5)
        for (let w = -5; w <= 15; w += 0.5) {
          const m = kidneyWorld([u, v, w], k);
          if (kidneyQuery(m, k).dOuter < 0 && cls(m).vessel === 'renalVeinRight') vein += 0.125;
        }
    expect(vein).toBeLessThan(200);
    // ecogenicidad (revisión 25-09): médula < corteza < hígado < grasa perirrenal < seno
    const b = (t: Tissue) => TISSUES[t].backscatter;
    expect(b(Tissue.RenalMedulla)).toBeLessThan(b(Tissue.RenalCortex));
    expect(b(Tissue.RenalCortex)).toBeLessThan(b(Tissue.Liver));
    expect(b(Tissue.Liver)).toBeLessThan(b(Tissue.PerirenalFat));
    expect(b(Tissue.PerirenalFat)).toBeLessThan(b(Tissue.RenalSinus));
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
    // grasa perirrenal lateral fina (≈ 1 mm, decisión 68)
    expect(cls(kidneyWorld([0, -27.5, 0], k)).tissue).toBe(Tissue.PerirenalFat);
    // interlobares por la columna de Bertin: el nodo medio de cada tubo es luz de su vaso
    const mid = (id: string) => scene.vessels.find((v) => v.id === id)!.tube.nodes[1].p;
    expect(cls(mid('interlobarVein2')).vessel).toBe('interlobarVein2');
    expect(cls(mid('interlobarArtery2')).vessel).toBe('interlobarArtery2');
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
        // el hígado apoya en la cara externa de la grasa perirrenal, de grosor variable (decisión 68)
        expect(kidneyQuery(p, k).dOuter).toBeGreaterThan(perirenalThicknessMm(kidneyLocal(p, k), k) - RENAL_IMPRESSION_OVERLAP_MM - 1e-6);
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
      // el origen (el nodo más grueso) conserva ≥ 0,6 mm (0,9 salvo las laterales de las madres afiladas, que no nacen más
      // gruesas que ellas); el extremo sigue en sus hijas o se afila (decisión 87)
      expect(Math.max(b.tube.nodes[0].r, b.tube.nodes[1].r)).toBeGreaterThanOrEqual(0.6);
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

  // Decisión 87: el juez ciego (ronda 3) veía «una vena recta que acaba en un círculo, como una piruleta»: todas las ramas
  // terminaban con 0,9 mm y una tapa esférica, y seis madres (la VSH derecha con 2,4 mm) sin hijas en su extremo, con una
  // de 2–2,4 mm. Ahora cada extremo periférico del árbol hepático o sigue en hijas casi tan gruesas como él (la unión en «Y»,
  // sin bola) o se afila hasta BRANCH_TIP_RADIUS_MM.
  it('ningún extremo periférico del árbol hepático acaba en una tapa: se afila o sigue en sus hijas (decisión 87)', () => {
    for (const p of CASES) {
      const sc = new AnatomyScene(p);
      const hepatic = sc.vessels.filter((v) => ['hepaticVein', 'portal'].includes(VESSEL_META[v.id].system));
      const bad: string[] = [];
      let tapered = 0;
      for (const v of hepatic) {
        const n = v.tube.nodes;
        // extremo periférico: las suprahepáticas (y sus ramas) van de la periferia a la cava; la porta, al revés
        const tip = VESSEL_META[v.id].system === 'hepaticVein' ? n[0] : n[n.length - 1];
        const kids = hepatic.filter(
          (b) =>
            b !== v &&
            b.flowFactor !== undefined &&
            b.tube.nodes.some((k) => Math.hypot(k.p[0] - tip.p[0], k.p[1] - tip.p[1], k.p[2] - tip.p[2]) < 1e-6),
        );
        if (tip.r <= BRANCH_TIP_RADIUS_MM + 1e-9) tapered++;
        else if (kids.length === 0) {
          // los troncos que no llegan a la periferia del modelo (la porta principal y la izquierda, la VSH común…) se
          // continúan en otra rama madre por su nodo: no son extremos
          const cont = sc.vessels.some(
            (o) =>
              o !== v &&
              o.flowFactor === undefined &&
              o.tube.nodes.some((k) => Math.hypot(k.p[0] - tip.p[0], k.p[1] - tip.p[1], k.p[2] - tip.p[2]) < 1e-6),
          );
          if (!cont) bad.push(`${p.id} ${v.id}${v.flowFactor === undefined ? '' : '*'}: tapa de ${tip.r.toFixed(2)} mm`);
        } else {
          // sin bola: las hijas nacen tan gruesas como el extremo que continúan (la unión en «Y»)
          const r0 = Math.max(...kids.map((b) => Math.max(b.tube.nodes[0].r, b.tube.nodes[1].r)));
          if (r0 < tip.r - 1e-9) bad.push(`${p.id} ${v.id}: hijas de ${r0.toFixed(2)} en un extremo de ${tip.r.toFixed(2)} mm`);
        }
      }
      // y ninguna rama nace más gruesa que el vaso del que sale: su esfera de origen cabe en la luz de otro tubo del mismo
      // id (la madre o la rama que continúa); antes la lateral de una madre afilada salía con 0,9 mm donde esta medía 0,81.
      // Con los radios de sus nodos: la forma orgánica (decisión 90) modula unos pocos por ciento la luz de las dos
      for (const b of hepatic.filter((x) => x.flowFactor !== undefined)) {
        const [n0, n1] = b.tube.nodes;
        const o = n0.r >= n1.r ? n0 : n1;
        const inside = Math.min(
          ...hepatic.filter((v) => v !== b && v.id === b.id).map((v) => tubeQuery(o.p, { ...v.tube, shape: undefined }, 1).d + o.r),
        );
        if (inside > 1e-6) bad.push(`${p.id} ${b.id}*: nace ${inside.toFixed(2)} mm más gruesa que su madre`);
      }
      expect(bad).toEqual([]);
      expect(tapered, p.id).toBeGreaterThan(40);
    }
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
        // con el mayor saliente de su forma orgánica (decisión 90)
        const shapeMax = branchShapeMax(b, sMax);
        const len = Math.hypot(e.p[0] - o.p[0], e.p[1] - o.p[1], e.p[2] - o.p[2]);
        const n = Math.ceil(2 * len);
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          if (t * len < o.r * sMax) continue;
          const q: [number, number, number] = [0, 1, 2].map((j) => o.p[j] + (e.p[j] - o.p[j]) * t) as [number, number, number];
          const r = (o.r + (e.r - o.r) * t) * sMax * shapeMax;
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
    // el bd de cada punto de intestino no supera la distancia a la interfaz que se encuentra. Desde la decisión 81 el
    // «resto» de detrás del peritoneo parietal posterior es grasa retroperitoneal (la primera columna), con el mismo bd
    for (const [x, y, expected] of [
      [70, -5, Tissue.Diaphragm],
      [60, 20, Tissue.LiverCapsule],
      [40, 30, Tissue.LiverCapsule],
    ] as const) {
      const samples: Array<{ z: number; bd: number }> = [];
      let zT = Number.NaN;
      for (let z = -120; z < 60; z += 0.25) {
        const c = cls([x, y, z]);
        if (c.tissue === Tissue.Bowel || c.tissue === Tissue.RetroperitonealFat) samples.push({ z, bd: c.boundaryDistance });
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
    expect(cls([-14, 4, -75]).vessel).toBe('pvTrunk');
    expect(cls([-14, 4, -75]).interface).toBe(Interface.PortalLumen);
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
    // Morison: subiendo desde el riñón derecho, grasa perirrenal y enseguida el hígado, sin hueco (la impresión renal
    // solapa 1 mm la grasa, que gana: decisión 68). Por el polo superior la grasa es gruesa y aun así dibuja la línea de
    // Morison con su cara externa (antes, ninguna cara: ni la de la grasa, solo fina, ni la de la cápsula, que se la
    // cede); del lado del hígado no hay otra (la cápsula, si asoma, no dibuja la suya)
    const kr = scene.kidneyRight;
    const k = kr.center;
    const fat = first(k, [0, 0, 1], Tissue.PerirenalFat, 70);
    let t = fat.t;
    while (cls(along(k, [0, 0, 1], t)).tissue === Tissue.PerirenalFat) t += 0.05;
    const after = cls(along(k, [0, 0, 1], t));
    expect([Tissue.LiverCapsule, Tissue.Liver]).toContain(after.tissue);
    expect(after.interface).toBe(Interface.None);
    const last = along(k, [0, 0, 1], t - 0.05);
    expect(perirenalThicknessMm(kidneyLocal(last, kr), kr)).toBeGreaterThan(PERIRENAL.faceMaxMm);
    expect(cls(last).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(last).interface).toBe(Interface.PerirenalFat);
    expect(cls(last).interfaceDistance).toBeLessThan(0.1);
  });

  it('riñón: cápsula renal, mitad interna de la grasa y toda la fina dibujan la cápsula; la mitad externa de la gruesa, la grasa', () => {
    const k = scene.kidneyRight;
    const up: V = [0, 0, 1];
    const dOuter = (p: V) => kidneyQuery(p, k).dOuter;
    const capsule = first(k.center, up, Tissue.RenalCapsule, 70).p;
    const capsuleIn = along(capsule, up, 0.2);
    expect(cls(capsuleIn).tissue).toBe(Tissue.RenalCapsule);
    expect(cls(capsuleIn).interface).toBe(Interface.RenalCapsule);
    expect(cls(capsuleIn).interfaceDistance).toBeCloseTo(-dOuter(capsuleIn), 9);
    const fat = first(k.center, up, Tissue.PerirenalFat, 70).p;
    // grosor local de la grasa (decisión 68): en el polo superior, gruesa
    const t = (p: V) => perirenalThicknessMm(kidneyLocal(p, k), k);
    const inner = along(fat, up, 0.2 * t(fat));
    const outer = along(fat, up, 0.8 * t(fat));
    expect(t(fat)).toBeGreaterThan(4);
    expect(dOuter(inner)).toBeLessThan(0.5 * t(inner));
    expect(dOuter(outer)).toBeGreaterThan(0.5 * t(outer));
    expect(cls(inner).interface).toBe(Interface.RenalCapsule);
    expect(cls(inner).interfaceDistance).toBeCloseTo(dOuter(inner), 9);
    expect(cls(outer).tissue).toBe(Tissue.PerirenalFat);
    // en el polo superior la grasa es gruesa pero apoya en el hígado: su mitad externa dibuja la cara de Morison
    expect(cls(outer).interface).toBe(Interface.PerirenalFat);
    expect(cls(outer).interfaceDistance).toBeCloseTo(t(outer) - dOuter(outer), 9);
    // detrás también es gruesa y no la toca el hígado: su mitad externa se funde con la grasa retroperitoneal sin cara
    const back: V = [-k.w[0], -k.w[1], -k.w[2]];
    const fatBack = first(k.center, back, Tissue.PerirenalFat, 70).p;
    expect(t(fatBack)).toBeGreaterThan(PERIRENAL.faceMaxMm);
    const outerBack = along(fatBack, back, 0.8 * t(fatBack));
    expect(cls(outerBack).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(outerBack).interface).toBe(Interface.None);
    // donde es fina (anterolateral, contra el hígado) toda ella dibuja la cápsula renal (decisión 81): su cara externa, a
    // 1–2,5 mm de la de la cápsula, hacía de Morison una doble línea paralela; la cápsula hepática le cede la suya
    const antLat = kidneyWorld([0, -0.6 * k.radii[1], 0.8 * k.radii[2]], k);
    const dirOut: V = [antLat[0] - k.center[0], antLat[1] - k.center[1], antLat[2] - k.center[2]];
    const nOut: V = dirOut.map((x) => x / Math.hypot(...dirOut)) as V;
    const fatThin = first(k.center, nOut, Tissue.PerirenalFat, 70).p;
    expect(t(fatThin)).toBeLessThan(PERIRENAL.faceMaxMm);
    const outerThin = along(fatThin, nOut, 0.8 * t(fatThin));
    expect(cls(outerThin).tissue).toBe(Tissue.PerirenalFat);
    expect(cls(outerThin).interface).toBe(Interface.RenalCapsule);
    expect(cls(outerThin).interfaceDistance).toBeCloseTo(dOuter(outerThin), 9);
    // al otro lado de la grasa fina, el hígado (la impresión renal la solapa) sin cara
    let past = outerThin;
    while (cls(past).tissue === Tissue.PerirenalFat) past = along(past, nOut, 0.05);
    expect([Tissue.Liver, Tissue.LiverCapsule]).toContain(cls(past).tissue);
    expect(cls(past).interface).toBe(Interface.None);
  });

  it('Morison (decisiones 68 y 81): todo paso hígado ↔ grasa perirrenal tiene una línea y una sola', () => {
    // Antes la cara externa de la grasa solo se dibujaba donde medía ≤ 2,5 mm, y la cápsula hepática que la toca le
    // cede la suya: el contacto con grasa gruesa (el 62 %) quedaba sin línea (26 de 29 pasos en la vista renal, 26 de 38
    // en el plano de Morison del flanco, 454 de 905 en los rayos desde el riñón). Pasos directos o por una lámina de
    // intestino (grasa retroperitoneal desde la decisión 81) de ≤ 3 mm. Línea: con la grasa gruesa, la de la grasa o la
    // de la cápsula hepática, a < 0,5 mm, en ±1,5 mm del paso; con la fina (decisión 81), la de la cápsula renal al otro
    // lado de la grasa. Y una sola: la de la grasa y la de la cápsula hepática a la vez, a ≥ 0,6 mm y sin parénquima
    // entre ellas, eran el 11–14 % de los pasos de los rayos (una grasa fina y la cápsula al otro lado de la lámina); y
    // con la fina, su cara externa y la de la cápsula renal, a 1–2,5 mm, dos líneas paralelas (el 100 % hasta la 81)
    type Sample = { r: number; t: Tissue; f: Interface; fd: number; fat: number };
    const isLiver = (t: Tissue) => t === Tissue.Liver || t === Tissue.LiverCapsule;
    const isLamina = (t: Tissue) => t === Tissue.Bowel || t === Tissue.RetroperitonealFat;
    // grosor local de la grasa perirrenal del riñón derecho (el de Morison) en un punto
    const fatAt = (p: V) => perirenalThicknessMm(kidneyLocal(p, scene.kidneyRight), scene.kidneyRight);
    const faceless: string[] = [];
    const doubled: string[] = [];
    let passes = 0;
    let thinPasses = 0;
    const check = (seq: Sample[], tag: string) => {
      for (let j = 1; j < seq.length; j++) {
        const a = seq[j - 1];
        let k = j;
        while (k < seq.length && isLamina(seq[k].t) && seq[k].r - seq[j].r < 3) k++;
        const b = seq[k];
        if (!b || !((isLiver(a.t) && b.t === Tissue.PerirenalFat) || (a.t === Tissue.PerirenalFat && isLiver(b.t)))) continue;
        passes++;
        // la grasa del paso: fina si su grosor local en el paso no pasa de faceMaxMm; su tramo en el rayo, hasta el riñón
        const into = a.t === Tissue.PerirenalFat ? -1 : 1;
        const fatAt = a.t === Tissue.PerirenalFat ? j - 1 : k;
        let end = fatAt;
        while (seq[end + into]?.t === Tissue.PerirenalFat) end += into;
        const thin = seq[fatAt].fat <= PERIRENAL.faceMaxMm;
        const near = seq.filter((q) => q.r >= Math.min(a.r, b.r) - 1.5 && q.r <= Math.max(a.r, b.r) + 1.5);
        const [lo, hi] = [Math.min(seq[fatAt].r, seq[end].r) - 0.5, Math.max(seq[fatAt].r, seq[end].r) + 0.5];
        const inFat = seq.filter((q) => q.r >= lo && q.r <= hi);
        const line = thin
          ? inFat.some((q) => q.f === Interface.RenalCapsule && q.fd < 0.5)
          : near.some((q) => (q.f === Interface.PerirenalFat || q.f === Interface.LiverCapsule) && q.fd < 0.5);
        if (!line) faceless.push(`${tag} r ${b.r.toFixed(1)}`);
        const fatFace = near.filter((q) => q.f === Interface.PerirenalFat && q.fd < 0.3).map((q) => q.r);
        const capFace = near.filter((q) => q.f === Interface.LiverCapsule && q.fd < 0.3).map((q) => q.r);
        const apart = (rf: number, rc: number) => {
          const [lo, hi] = [Math.min(rf, rc), Math.max(rf, rc)];
          return hi - lo >= 0.6 && !seq.some((q) => q.r > lo && q.r < hi && q.t === Tissue.Liver);
        };
        if (fatFace.some((rf) => capFace.some((rc) => apart(rf, rc)))) doubled.push(`${tag} r ${b.r.toFixed(1)}`);
        if (thin) {
          thinPasses++;
          // con la fina, ni su cara externa ni la de la cápsula hepática junto a la de la cápsula renal
          if (fatFace.length || capFace.length) doubled.push(`${tag} r ${b.r.toFixed(1)} (fina)`);
        }
      }
    };
    // rayos desde el centro del riñón derecho, en todas las direcciones de su marco
    const kr = scene.kidneyRight;
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 32; j++) {
        const th = Math.acos(1 - (2 * (i + 0.5)) / 16);
        const ph = (2 * Math.PI * j) / 32;
        const dl: V = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        const d = [0, 1, 2].map((a) => kr.u[a] * dl[0] + kr.v[a] * dl[1] + kr.w[a] * dl[2]) as V;
        const seq: Sample[] = [];
        for (let r = 10; r < 90; r += 0.1) {
          const p = along(kr.center, d, r);
          const c = cls(p);
          seq.push({ r, t: c.tissue, f: c.interface, fd: c.interfaceDistance, fat: fatAt(p) });
        }
        check(seq, `rayo ${i},${j}`);
      }
    const fromRays = passes;
    const doubledRays = doubled.length;
    // las líneas de la vista renal, del flanco y del plano de Morison (flanco abanicado 20° hacia atrás)
    for (const [id, dTilt] of [
      ['renal', 0],
      ['flank', 0],
      ['flank', -20],
    ] as const) {
      const sp = START_POINTS.find((x) => x.id === id)!;
      const pose: ProbePose = {
        phi: sp.phi,
        z: sp.z,
        lift: 0,
        yaw: sp.yaw,
        rock: sp.rock ?? 0,
        tilt: (sp.tilt ?? 0) + (dTilt * Math.PI) / 180,
      };
      const contact = probeContact(pose, CONVEX_C35, scene.torso);
      for (let i = 0; i < 61; i++) {
        const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / 60;
        const seq: Sample[] = [];
        for (let r = 2; r < 180; r += 0.1) {
          const p = uncompress(pointOnLine(contact.frame, CONVEX_C35, theta, r), contact);
          const c = cls(p);
          seq.push({ r, t: c.tissue, f: c.interface, fd: c.interfaceDistance, fat: fatAt(p) });
        }
        check(seq, `${id}${dTilt ? ` ${dTilt}°` : ''} línea ${i}`);
      }
    }
    expect(fromRays).toBeGreaterThan(50);
    expect(passes - fromRays).toBeGreaterThan(20);
    // la prueba tiene dientes en los dos casos: grasa fina y gruesa
    expect(thinPasses).toBeGreaterThan(20);
    expect(passes - thinPasses).toBeGreaterThan(20);
    expect(faceless).toEqual([]);
    // en las vistas, ninguna doble línea; en los rayos desde el riñón, como mucho dos pasos (de ~150): detrás del polo
    // superior, junto a la pared posterior (donde no mira ninguna ventana), el redondeo del borde de la impresión renal
    // con la cara visceral en cuña (decisión 72) deja una lámina de ~1 mm contra la grasa gruesa (`morison-rim-sliver`)
    expect(doubled.slice(doubledRays)).toEqual([]);
    expect(doubledRays, doubled.join(', ')).toBeLessThanOrEqual(2);
  });

  it('la VCI que entra en la aurícula (decisión 85): dentro de ella ni pared ni cara, la luz con su flujo; por debajo, su cara', () => {
    // el embudo de la VCI suprahepática entra por el suelo de la aurícula: classify prueba los tubos antes que el tórax, así
    // que dentro de la cavidad de la AD la luz sigue siendo la VCI (el chorro que entra) y la pared es sangre de la aurícula,
    // sin cara (antes, un eco de pared a +13–14 dB y un anillo de pared dentro de la cavidad negra); fuera de la aurícula, a
    // más de IVC_ORIFICE_MM sobre la cúpula, no hay VCI
    const atrium = (p: V) => ivcAtrium(p, domeFloor(p, scene.diaphragm, scene.torso));
    const supra = scene.vessels.find((v) => v.id === 'ivcSupra')!;
    const last = supra.tube.nodes[supra.tube.nodes.length - 1].p;
    const hiatus = supra.tube.nodes[supra.tube.nodes.length - 3].p;
    expect(atrium(last).cavity).toBeLessThan(0);
    expect(atrium(hiatus).cavity).toBeGreaterThan(0);
    let lumenInRa = 0;
    let wallInRa = 0;
    let tubeBelow = 0;
    let trimmed = 0;
    for (let x = -14; x <= 14; x += 0.5)
      for (let y = -14; y <= 14; y += 0.5)
        for (const f of [-0.4, 0, 0.3, 0.6, 0.8, 1, 1.1]) {
          const p: V = along(hiatus, [last[0] - hiatus[0], last[1] - hiatus[1], last[2] - hiatus[2]], f);
          p[0] += x;
          p[1] += y;
          const c = cls(p);
          const t = scene.faceTube(p, BASELINE_CALIBER);
          if (!t || t.vessel !== 'ivcSupra') continue;
          const tag = `${p.map((v) => v.toFixed(1)).join(', ')}`;
          const a = atrium(p);
          if (a.cavity < 0) {
            expect(c.interface, tag).toBe(Interface.None);
            expect(c.interfaceDistance).toBe(1e3);
            expect(c.tissue, tag).toBe(Tissue.Blood);
            if (t.hit.d < 0) {
              lumenInRa++;
              expect(c.vessel, tag).toBe('ivcSupra');
            } else {
              wallInRa++;
              expect(c.vessel, tag).toBeNull();
            }
          } else if (!a.outside) {
            tubeBelow++;
            expect(c.interface, tag).toBe(Interface.IvcLumen);
          } else {
            // fuera de la AD tallada: con el calibre del sano, solo la tapa del embudo junto al tabique interauricular (el
            // limbo de la fosa oval, a 4 mm de la AI), que sigue siendo tabique
            trimmed++;
            expect(c.vessel, tag).toBeNull();
            expect(Tissue[c.tissue], tag).toBe('Myocardium');
            expect(heartChambers(p)[3], tag).toBeLessThan(HEART_WALLS.ias);
          }
        }
    const tag = JSON.stringify({ lumenInRa, wallInRa, tubeBelow, trimmed });
    expect(lumenInRa, tag).toBeGreaterThan(200);
    expect(wallInRa, tag).toBeGreaterThan(20);
    expect(tubeBelow, tag).toBeGreaterThan(200);
    expect(trimmed, tag).toBeLessThan(0.25 * lumenInRa);
  });

  it('hígado, intestino y pulmón no dibujan cara; el músculo de la pared, la de su capa (decisión 62)', () => {
    for (const [p, t] of [
      [[-60, 20, -10], Tissue.Liver],
      [[40, 40, -120], Tissue.Bowel],
      [[-75, -5, 70], Tissue.Lung],
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
