import { describe, expect, it } from 'vitest';
import { bestGateOnVessel } from '../app/gatePlacement';
import { acousticWindowWeight } from '../app/gateTransmission';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient, type RespiratoryPattern } from '../physiology/patientState';
import { uncompress } from '../anatomy/compression';
import { sdSpineDisc } from '../anatomy/primitives';
import { domeFloor } from '../anatomy/organs/heart';
import { heartChamber } from '../anatomy/organs/heartChamber';
import { kidneyLocal, kidneyOuterSdf, perirenalOuterSdf } from '../anatomy/organs/kidney';
import { contactCoupling, probeContact } from '../probe/contact';
import { CONVEX_C35, lineDirection, pointOnLine, type ProbePose } from '../probe/probe';
import { rayAttenuationDb } from '../ultrasound/transmission';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

/**
 * Cada punto de partida debe cortar de verdad la estructura que promete su
 * texto, sin afinar la sonda: la anatomía cambia a menudo (decisiones 33–37) y
 * esta es la única valla que impide que una ventana quede «vacía». El tejido es el que muestra la aplicación: el
 * de la pose con la compresión de la sonda y su marco efectivo (la sonda hundida, decisión 63), y el
 * acoplamiento, el contacto conseguido.
 */
const scene = new AnatomyScene(NORMAL_ADULT);

interface Sweep {
  vessels: Map<string, number>;
  tissues: Map<Tissue, number>;
  coupling: number;
}

function sweep(sp: StartPoint, depthMm: number): Sweep {
  const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  const fr = contact.frame;
  const vessels = new Map<string, number>();
  const tissues = new Map<Tissue, number>();
  let coupling = 0;
  const nLines = 61;
  for (let i = 0; i < nLines; i++) {
    const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
    coupling += contactCoupling(contact, theta) / nLines;
    for (let r = 2; r < depthMm; r += 2) {
      const q = scene.classify(uncompress(pointOnLine(fr, CONVEX_C35, theta, r), contact), BASELINE_CALIBER);
      tissues.set(q.tissue, (tissues.get(q.tissue) ?? 0) + 1);
      if (q.vessel) vessels.set(q.vessel, (vessels.get(q.vessel) ?? 0) + 1);
    }
  }
  return { vessels, tissues, coupling };
}

const byId = (id: StartPoint['id']) => START_POINTS.find((s) => s.id === id)!;
/** Longitud aproximada (mm) que un vaso ocupa en el plano: muestras × paso / líneas que lo cruzan. */
const samples = (s: Sweep, id: string) => s.vessels.get(id) ?? 0;
const poseOf = (sp: StartPoint): ProbePose => ({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 });

/**
 * Muestra del plano como la ve el alumno: x en la pantalla (mm; + = derecha, con el marcador a la izquierda, +θ, como
 * `passes.glsl`) y y hacia abajo (mm bajo el centro de curvatura de la cara), sobre la línea `line` a `r` mm de la cara.
 */
interface ScreenSample {
  x: number;
  y: number;
  line: number;
  r: number;
}
interface ScreenMap {
  coupling: number;
  /**
   * Muestras VISIBLES de la luz de un vaso (por id), de una cavidad del corazón (`'ra'`, `'rv'`, `'lv'`, `'la'`, decisión 85)
   * o de un tejido (por su número), 1 mm de paso en 61 líneas: las que no tienen gas (pulmón, gas intestinal) ni hueso antes
   * en su línea. Detrás del pulmón la imagen es su espejo y detrás del hueso, su sombra: lo que haya ahí no lo ve el alumno.
   */
  of: (...keys: Array<string | Tissue>) => ScreenSample[];
  /** Todas las muestras, visibles o no (lo que corta el plano). */
  all: (...keys: Array<string | Tissue>) => ScreenSample[];
  /** Tejido en la línea `line` a `r` mm (redondeado al paso). */
  tissueAt: (line: number, r: number) => Tissue | undefined;
  /** Clasificación en un punto cualquiera de la pantalla (x, y como en `ScreenSample`). */
  at: (x: number, y: number) => ReturnType<AnatomyScene['classify']>;
}
const MAP_LINES = 61;
function screenMap(pose: ProbePose, depthMm: number): ScreenMap {
  const contact = probeContact(pose, CONVEX_C35, scene.torso);
  const R0 = CONVEX_C35.curvatureRadius;
  const lineTheta = (i: number) => -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (MAP_LINES - 1);
  const seen = new Map<string | Tissue, ScreenSample[]>();
  const cut = new Map<string | Tissue, ScreenSample[]>();
  const tissues: Tissue[][] = [];
  let coupling = 0;
  for (let i = 0; i < MAP_LINES; i++) {
    const th = lineTheta(i);
    coupling += contactCoupling(contact, th) / MAP_LINES;
    tissues.push([]);
    // la línea queda tapada tras la primera muestra de gas o de hueso (el gel antes de la piel no cuenta)
    let entered = false;
    let blocked = false;
    for (let r = 1; r < depthMm; r++) {
      const mat = uncompress(pointOnLine(contact.frame, CONVEX_C35, th, r), contact);
      const q = scene.classify(mat, BASELINE_CALIBER);
      tissues[i][r] = q.tissue;
      const s = { x: -(R0 + r) * Math.sin(th), y: (R0 + r) * Math.cos(th), line: i, r };
      // la sangre sin vaso es la de una cavidad del corazón (decisión 85)
      const chamber = !q.vessel && q.tissue === Tissue.Blood ? heartChamber(mat, domeFloor(mat, scene.diaphragm, scene.torso)) : null;
      const keys: Array<string | Tissue> = q.vessel ? [q.vessel, q.tissue] : chamber ? [chamber, q.tissue] : [q.tissue];
      for (const key of keys) {
        (cut.get(key) ?? cut.set(key, []).get(key)!).push(s);
        if (!blocked) (seen.get(key) ?? seen.set(key, []).get(key)!).push(s);
      }
      if (q.tissue !== Tissue.Air) entered = true;
      if (entered && (TISSUES[q.tissue].gas || TISSUES[q.tissue].bone)) blocked = true;
    }
  }
  return {
    coupling,
    of: (...keys) => keys.flatMap((k) => seen.get(k) ?? []),
    all: (...keys) => keys.flatMap((k) => cut.get(k) ?? []),
    tissueAt: (line, r) => tissues[line]?.[Math.round(r)],
    at: (x, y) =>
      scene.classify(
        uncompress(pointOnLine(contact.frame, CONVEX_C35, -Math.atan2(x, y), Math.hypot(x, y) - R0), contact),
        BASELINE_CALIBER,
      ),
  };
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const centroid = (s: ScreenSample[]) => ({ x: mean(s.map((p) => p.x)), y: mean(s.map((p) => p.y)) });
/**
 * Ancho y alto (mm) en la pantalla de la luz de un vaso: las cuerdas horizontal y vertical por su centroide, a pasos
 * de 0,1 mm (las muestras del mapa están a 3,4 mm entre líneas a 11 cm).
 */
function lumenChords(m: ScreenMap, ids: string[]): { width: number; height: number } {
  const c = centroid(m.of(...ids));
  const inside = (x: number, y: number) => ids.includes(m.at(x, y).vessel ?? '');
  const chord = (dx: number, dy: number) => {
    let a = 0;
    let b = 0;
    while (inside(c.x - (a + 0.1) * dx, c.y - (a + 0.1) * dy)) a += 0.1;
    while (inside(c.x + (b + 0.1) * dx, c.y + (b + 0.1) * dy)) b += 0.1;
    return a + b;
  };
  return { width: chord(1, 0), height: chord(0, 1) };
}
/** Menor distancia (mm, en el plano de la pantalla) entre dos conjuntos de muestras. */
function gapMm(a: ScreenSample[], b: ScreenSample[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  return best;
}
/** Cuánto se aleja (mm) en el plano un vaso de otro: la mayor distancia de sus muestras a las del otro. */
function reachMm(a: ScreenSample[], from: ScreenSample[]): number {
  let worst = 0;
  for (const p of a) {
    let d = Infinity;
    for (const q of from) d = Math.min(d, Math.hypot(p.x - q.x, p.y - q.y));
    worst = Math.max(worst, d);
  }
  return worst;
}
const IVC = ['ivcInfra', 'ivcSupra'];
const HEPATIC_VEINS = ['hvRight', 'hvMiddle', 'hvLeft'] as const;

describe('Puntos de partida (decisión 17): cada ventana corta lo que promete', () => {
  it('porta lateral (decisión 69): porta principal y derecha en el plano, VCI detrás, sin costillas y con ángulo Doppler útil', () => {
    const s = sweep(byId('portal'), 170);
    expect(s.coupling).toBeGreaterThan(0.75);
    expect(samples(s, 'pvTrunk') + samples(s, 'pvRight')).toBeGreaterThan(40);
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(20);
    expect(s.tissues.get(Tissue.Bone) ?? 0).toBe(0);
    // la puerta sobre la porta con el haz a ≤ 60° de su eje
    const sp = byId('portal');
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    const engine = new PhysiologyEngine(clonePatient(NORMAL_ADULT), scene.vesselAreas(), { historySeconds: 2 });
    const anatomy = new AnatomyQuery(scene);
    const g = bestGateOnVessel(anatomy, contact.frame, CONVEX_C35, engine.sample, ['pvTrunk'], 165);
    expect(g).not.toBeNull();
    expect(g!.cosAngle).toBeGreaterThanOrEqual(0.5);
  });

  it('subxifoideo: VCI en eje largo (infra + supra) a través del hígado, con acoplamiento útil', () => {
    const s = sweep(byId('subxiphoid'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    // ≥ 60 mm de VCI en el plano: 60 mm / 2 mm de paso = 30 muestras, ×~5 líneas por su calibre
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(120);
    expect(s.tissues.get(Tissue.Liver) ?? 0).toBeGreaterThan(400);
  });

  it('intercostal derecho: suprahepáticas y VCI a través del hígado', () => {
    const s = sweep(byId('intercostal'), 160);
    // los bordes, más allá de ±21°, no apoyan en el tórax curvo (decisión 63): 0,63
    expect(s.coupling).toBeGreaterThan(0.55);
    const hv = samples(s, 'hvRight') + samples(s, 'hvMiddle') + samples(s, 'hvRightAnterior');
    // 31 muestras en el tronco rígido; 30 con la sonda hundida (el empuje baja la derecha de 22 a 20 muestras)
    expect(hv).toBeGreaterThan(25);
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(20);
    expect(s.tissues.get(Tissue.Liver) ?? 0).toBeGreaterThan(600);
  });

  it('intercostal derecho: ninguna costilla en todo el sector, ósea o cartílago, hasta el fondo de la imagen', () => {
    // decisión 62: la pose de antes (casi craneocaudal) cruzaba seis costillas óseas; la primera del 8.º espacio,
    // con 11° de basculación, dejaba una en cada borde (a 36–52 y a 71 mm) y 14 líneas sin acoplar. Con la de
    // ahora, girar la sonda 2° ya mete la 9.ª en un borde. La vértebra y sus discos (PR119; recuperación provisional de la decisión 103), al fondo (14–16 cm), no
    // cuentan.
    const sp = byId('intercostal');
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    const fr = contact.frame;
    const nLines = 61;
    for (let i = 0; i < nLines; i++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
      for (let r = 1; r < 180; r += 1) {
        const m = uncompress(pointOnLine(fr, CONVEX_C35, theta, r), contact);
        const t = scene.classify(m, BASELINE_CALIBER).tissue;
        const disc = t === Tissue.Cartilage && sdSpineDisc(m, scene.spine) < 0;
        expect(t === Tissue.Bone || (t === Tissue.Cartilage && !disc), `línea ${i} a ${r} mm`).toBe(false);
      }
    }
  });

  it('intercostal derecho: la puerta del operador en una suprahepática a ≤ 50° y con ventana, en espiración y respirando', () => {
    // La función de la vista, no solo su anatomía: `bestGateOnVessel` con el peso de ventana acústica (como la
    // e2e y la pestaña Medir) en apnea espiratoria y en el máximo descenso del diafragma de la respiración
    // tranquila (8 s). El peso incluye la atenuación de ida y vuelta a la frecuencia Doppler: 0,058 a 89 mm con
    // 43° y 0,038 a 101 mm con 35°; la puerta de la pose casi craneocaudal de antes quedaba a 63–80 mm (peso
    // 0,09–0,16, sin sombra en la puerta) con 57–68°, por encima de la cota.
    const sp = byId('intercostal');
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    for (const pattern of ['apnea-expiratory', 'quiet'] as RespiratoryPattern[]) {
      const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: pattern };
      const sc = new AnatomyScene(patient);
      const anatomy = new AnatomyQuery(sc);
      const engine = new PhysiologyEngine(patient, sc.vesselAreas(), { historySeconds: 12 });
      let sample = engine.step();
      for (let i = 1; i < Math.round(8 / engine.clock.dt); i++) {
        const s = engine.step();
        if (s.resp.diaphragmCaudalMm > sample.resp.diaphragmCaudalMm) sample = s;
      }
      const contact = probeContact(pose, CONVEX_C35, sc.torso);
      const frame = contact.frame;
      anatomy.setProbeCompression(contact);
      const w = acousticWindowWeight(anatomy, frame, CONVEX_C35, contact, sample, 180, CONVEX_C35_PROFILE.dopplerEffectiveMHz);
      const g = bestGateOnVessel(anatomy, frame, CONVEX_C35, sample, ['hvRight', 'hvMiddle'], 175, 1.2, w);
      expect(g, pattern).not.toBeNull();
      const tag = `${pattern}: ${JSON.stringify({ r: g!.r, theta: g!.theta })}`;
      expect((Math.acos(g!.cosAngle) * 180) / Math.PI, tag).toBeLessThanOrEqual(50);
      expect(w(g!.theta, g!.r), tag).toBeGreaterThanOrEqual(0.03);
    }
  });

  it('flanco: VCI transhepática coronal con suprahepáticas desembocando en ella', () => {
    const s = sweep(byId('flank'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    expect(samples(s, 'ivcInfra') + samples(s, 'ivcSupra')).toBeGreaterThan(120);
    expect(samples(s, 'hvRight') + samples(s, 'hvMiddle')).toBeGreaterThan(30);
  });

  it('epigástrica transversa (decisión 83): vértebra centrada en la base con su sombra, aorta redonda justo delante y a la derecha, VCI oval a la izquierda con hígado delante', () => {
    const m = screenMap(poseOf(byId('epigastric')), 170);
    // el cuerpo vertebral que corta el plano y su cara anterior, lo que se ve de él (detrás, su sombra)
    const body = m.all(Tissue.Vertebra);
    const vert = m.of(Tissue.Vertebra);
    const aorta = m.of('aorta');
    const ivc = m.of(...IVC);
    const [cv, ca, ci] = [centroid(body), centroid(aorta), centroid(ivc)];
    const [chA, chI] = [lumenChords(m, ['aorta']), lumenChords(m, IVC)];
    const face = Math.min(...vert.map((s) => s.r));
    // la aorta apoyada en la vértebra: en sus líneas, lo que va de su última muestra de luz a la primera de vértebra
    const lastAorta = new Map<number, number>();
    for (const s of aorta) lastAorta.set(s.line, Math.max(lastAorta.get(s.line) ?? 0, s.r));
    let aortaToVert = Infinity;
    for (const [line, r] of lastAorta) {
      const v = vert.filter((s) => s.line === line).map((s) => s.r);
      if (v.length) aortaToVert = Math.min(aortaToVert, Math.min(...v) - r);
    }
    // el hígado delante de la VCI: en la línea que pasa por su centroide, los 15 mm por delante de su luz
    const ivcLine = ivc.reduce((a, b) => (Math.abs(b.x - ci.x) < Math.abs(a.x - ci.x) ? b : a)).line;
    const ivcTop = Math.min(...ivc.filter((s) => s.line === ivcLine).map((s) => s.r));
    const front = Array.from({ length: 15 }, (_, k) => m.tissueAt(ivcLine, ivcTop - 3 - k));
    const liverFront = front.filter((t) => t === Tissue.Liver).length / front.length;
    // la sombra: en la línea central, la vértebra se come la señal (ida y vuelta, a la frecuencia de la imagen B)
    const central = Array.from({ length: 169 }, (_, k) => m.tissueAt(30, k + 1)!);
    const vFace = central.indexOf(Tissue.Vertebra) + 1;
    const f = CONVEX_C35_PROFILE.bEffectiveMHz;
    const shadowDb = rayAttenuationDb(central.slice(0, vFace + 10), 1, f) - rayAttenuationDb(central.slice(0, vFace - 1), 1, f);
    const tag = JSON.stringify({
      acoplamiento: +m.coupling.toFixed(2),
      vértebra: { x: +cv.x.toFixed(1), cara: face, sombraDb: +shadowDb.toFixed(0) },
      aorta: { x: +ca.x.toFixed(1), ancho: +chA.width.toFixed(1), alto: +chA.height.toFixed(1), aVértebra: aortaToVert },
      vci: { x: +ci.x.toFixed(1), ancho: +chI.width.toFixed(1), alto: +chI.height.toFixed(1), hígadoDelante: +liverFront.toFixed(2) },
    });
    expect(m.coupling, tag).toBeGreaterThan(0.95);
    // ninguna costilla ósea (el cartílago del reborde costal derecho asoma en la esquina del campo cercano, sin sombra)
    expect(m.of(Tissue.Bone), tag).toHaveLength(0);
    // la vértebra en el centro de la base: centrada (±5 mm) y por detrás de la aorta y de la VCI, con la cara a 10–14 cm;
    // la aorta y la VCI, enteras a la vista (nada de gas ni de hueso por delante)
    expect(aorta.length, tag).toBe(m.all('aorta').length);
    expect(ivc.length, tag).toBe(m.all(...IVC).length);
    expect(Math.abs(cv.x), tag).toBeLessThan(5);
    expect(face, tag).toBeGreaterThan(100);
    expect(face, tag).toBeLessThan(140);
    expect(cv.y - ca.y, tag).toBeGreaterThan(20);
    expect(cv.y - ci.y, tag).toBeGreaterThan(20);
    // …con su sombra: > 60 dB en sus primeros 10 mm (hueso, decisión 54)
    expect(shadowDb, tag).toBeGreaterThan(60);
    // la aorta a la derecha del centro de la pantalla (la izquierda del paciente, con el marcador a su derecha), justo
    // delante de la vértebra y apoyada en ella
    expect(ca.x, tag).toBeGreaterThan(5);
    expect(ca.x, tag).toBeLessThan(35);
    expect(aortaToVert, tag).toBeLessThan(5);
    // redonda y ≤ 2,5 cm; la compresión de la sonda (decisión 63) la acorta en profundidad
    // (`probe-compression-kinematic`: 21 mm de alto con el tronco rígido)
    expect(chA.width, tag).toBeLessThanOrEqual(25);
    expect(chA.height, tag).toBeGreaterThan(14);
    expect(chA.width / chA.height, tag).toBeLessThan(1.3);
    // la VCI a la izquierda de la pantalla (la derecha del paciente) y oval: más ancha que alta, y más aplanada que la
    // aorta (la compresión acorta las dos por igual: con el tronco rígido, 19,9 × 16,0 frente a 21 × 21)
    expect(ci.x, tag).toBeLessThan(-10);
    expect(chI.width / chI.height - chA.width / chA.height, tag).toBeGreaterThan(0.15);
    // …con el hígado delante (el caudado y la lámina del ligamento venoso)
    expect(liverFront, tag).toBeGreaterThan(0.7);
  });

  it('epigástrica: hacia los pies salen de la cara anterior de la aorta el celíaco y después la AMS; hacia la cabeza, las suprahepáticas se acercan a la VCI', () => {
    const sp = byId('epigastric');
    // deslizando la sonda hacia los pies a pasos de 2 mm: dónde aparece cada rama (≥ 8 muestras), a qué distancia de la
    // luz de la aorta y cuánto se adelanta a su techo (su punta y su centro)
    const branch = (dz: number, id: 'celiacTrunk' | 'sma') => {
      const m = screenMap({ ...poseOf(sp), z: sp.z - dz }, 150);
      const aorta = m.of('aorta');
      const b = m.of(id);
      const roof = Math.min(...aorta.map((s) => s.y));
      return b.length < 8 ? null : { dz, gap: gapMm(b, aorta), tip: roof - Math.min(...b.map((s) => s.y)), center: roof - centroid(b).y };
    };
    const firstCut = (id: 'celiacTrunk' | 'sma') => {
      for (let dz = 0; dz <= 40; dz += 2) {
        const b = branch(dz, id);
        if (b) return b;
      }
      return null;
    };
    const celiac = firstCut('celiacTrunk');
    const sma = firstCut('sma');
    const smaBelow = sma && branch(sma.dz + 10, 'sma');
    const tag = JSON.stringify({ celiac, sma, smaBelow });
    // el celíaco a 1 cm y la AMS a 2,4 cm del punto de partida (T12 y L1), en ese orden
    expect(celiac, tag).not.toBeNull();
    expect(sma, tag).not.toBeNull();
    expect(celiac!.dz, tag).toBeGreaterThan(0);
    expect(sma!.dz, tag).toBeGreaterThan(celiac!.dz);
    // cada una sale de la aorta: en su primer corte su luz queda a < 3 mm de la de la aorta (las dos paredes) y se
    // adelanta a su techo
    for (const b of [celiac!, sma!]) {
      expect(b.gap, tag).toBeLessThan(3);
      expect(b.tip, tag).toBeGreaterThan(2);
    }
    // el tronco celíaco corre hacia delante (≥ 6 mm por delante del techo de la aorta, la «gaviota»); la AMS, 1 cm más
    // abajo, baja por delante de la aorta y separada de ella
    expect(celiac!.tip, tag).toBeGreaterThan(6);
    expect(smaBelow, tag).not.toBeNull();
    expect(smaBelow!.gap, tag).toBeGreaterThan(4);
    expect(smaBelow!.center, tag).toBeGreaterThan(5);
    // abanicando el haz hacia la cabeza (26°) la derecha y la media llegan a la VCI (a 1 y 3 mm) y la izquierda se acerca
    // a 9 mm, con un tercio tras el pulmón; en el punto de partida quedan lejos de ella, cortadas de través en el hígado.
    // Cortadas de través: el abanico entero del «conejo» pide más de los 40° que bascula la sonda (`probe-angle-40deg`)
    const hvGaps = (tilt: number) => {
      const m = screenMap({ ...poseOf(sp), tilt }, 170);
      const ivc = m.of(...IVC);
      return HEPATIC_VEINS.map((id) => ({ id, n: m.of(id).length, gap: m.of(id).length ? gapMm(m.of(id), ivc) : Infinity }));
    };
    const up = hvGaps(0.45);
    const flat = hvGaps(0);
    const tag2 = JSON.stringify({ up, flat });
    expect(up.filter((h) => h.n >= 10 && h.gap < 5).length, tag2).toBeGreaterThanOrEqual(2);
    for (const h of up) expect(h.gap, tag2).toBeLessThan(12);
    for (const h of flat) expect(h.gap, tag2).toBeGreaterThan(20);
  });

  it('subcostal (decisión 83): la VSH media recorre el plano hasta el tronco común y la VCI, y la derecha desemboca a su lado', () => {
    const m = screenMap(poseOf(byId('subcostal')), 165);
    const ivc = m.of(...IVC);
    // la desembocadura: la VCI y el tronco común de la media y la izquierda (lo que se ve de ellos)
    const sink = [...ivc, ...m.of('hvCommonTrunk')];
    const hv = HEPATIC_VEINS.map((id) => {
      const s = m.of(id);
      return { id, n: s.length, gap: s.length ? gapMm(s, sink) : Infinity, reach: s.length ? reachMm(s, sink) : 0 };
    });
    // lo craneal (la desembocadura) a la izquierda de la pantalla, con el marcador craneal
    const [cSink, cMiddle] = [centroid(sink), centroid(m.of('hvMiddle'))];
    const tag = JSON.stringify({
      acoplamiento: +m.coupling.toFixed(2),
      vci: `${ivc.length}/${m.all(...IVC).length}`,
      tronco: m.of('hvCommonTrunk').length,
      xDesembocadura: +cSink.x.toFixed(1),
      xVshMedia: +cMiddle.x.toFixed(1),
      hv,
    });
    expect(m.coupling, tag).toBeGreaterThan(0.85);
    expect(m.of(Tissue.Bone), tag).toHaveLength(0);
    // la VCI a la vista (161 muestras, entera desde la decisión 85: antes, 94 de 215, su parte craneal tras el pulmón de
    // encima de la cúpula) con el tronco común (28)
    expect(ivc.length, tag).toBeGreaterThan(60);
    expect(m.of('hvCommonTrunk').length, tag).toBeGreaterThan(15);
    // la VSH media desemboca en el plano (a < 3 mm del tronco común o de la VCI) y lo recorre ≥ 4,5 cm, entera a la vista
    const [right, middle] = hv;
    expect(middle.gap, tag).toBeLessThan(3);
    expect(middle.reach, tag).toBeGreaterThan(45);
    expect(middle.n, tag).toBe(m.all('hvMiddle').length);
    // y la derecha desemboca a su lado (un tramo corto, de través): dos suprahepáticas convergen en la VCI
    expect(right.n, tag).toBeGreaterThan(10);
    expect(right.gap, tag).toBeLessThan(3);
    // con el marcador craneal a la izquierda de la pantalla, la VSH media baja de derecha a izquierda hasta la VCI: con el
    // marcador al revés (giro + π) todas las distancias de arriba se cumplen igual y la imagen sale en espejo
    expect(cSink.x, tag).toBeLessThan(cMiddle.x - 15);
  });

  it('subcostal: la VSH media se mide a 1–2 cm de la VCI a ≤ 60° y con ventana, y la puerta del operador cae en ella a ≤ 60° y con ventana, en espiración y respirando', () => {
    // la medida del protocolo en esta ventana (VExUS: ángulo < 60°); como en la intercostal, con el peso de ventana
    // acústica (la transmisión hasta la puerta) y en el máximo descenso del diafragma de la respiración tranquila (8 s).
    // A 8–10 cm la atenuación ida y vuelta de la pared y el hígado a 2,5 MHz ya la deja en 0,036–0,072; una costilla o
    // el pulmón en el camino la bajan de 10⁻³ (hueso 106 dB en 1 cm, gas 60 dB/cm): ≥ 0,02 es una ventana sin sombra.
    // Medido: a 1–2 cm de la VCI, 32° (espiración) y 47° (inspiración tranquila); la puerta del operador, 34° y 56° (antes de
    // que la VSH media se curvara en este plano, decisión 90: 40°, 47°, 42° y 50°).
    const pose = poseOf(byId('subcostal'));
    const R = CONVEX_C35.curvatureRadius;
    const screen = (th: number, r: number) => [(R + r) * Math.sin(th), (R + r) * Math.cos(th)] as const;
    for (const pattern of ['apnea-expiratory', 'quiet'] as RespiratoryPattern[]) {
      const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: pattern };
      const sc = new AnatomyScene(patient);
      const anatomy = new AnatomyQuery(sc);
      const engine = new PhysiologyEngine(patient, sc.vesselAreas(), { historySeconds: 12 });
      let sample = engine.step();
      for (let i = 1; i < Math.round(8 / engine.clock.dt); i++) {
        const s = engine.step();
        if (s.resp.diaphragmCaudalMm > sample.resp.diaphragmCaudalMm) sample = s;
      }
      const contact = probeContact(pose, CONVEX_C35, sc.torso);
      anatomy.setProbeCompression(contact);
      const w = acousticWindowWeight(anatomy, contact.frame, CONVEX_C35, contact, sample, 180, CONVEX_C35_PROFILE.dopplerEffectiveMHz);
      // la luz de la VSH media lejos de su pared (≥ 1,2 mm, como la puerta del operador) y la VCI de ese instante
      const ivc: Array<readonly [number, number]> = [];
      const mhv: Array<{ th: number; r: number; cos: number }> = [];
      for (let th = -CONVEX_C35.halfSector; th <= CONVEX_C35.halfSector; th += 0.005)
        for (let r = 40; r < 165; r += 0.5) {
          const q = anatomy.classifyWorld(pointOnLine(contact.frame, CONVEX_C35, th, r), sample);
          if (q.vessel && IVC.includes(q.vessel)) ivc.push(screen(th, r));
          if (q.vessel !== 'hvMiddle' || !q.vesselHit || q.boundaryDistance < 1.2) continue;
          const d = lineDirection(contact.frame, th);
          const t = q.vesselHit.tangent;
          mhv.push({ th, r, cos: Math.abs(d[0] * t[0] + d[1] * t[1] + d[2] * t[2]) });
        }
      const toIvc = (th: number, r: number) => {
        const [x, y] = screen(th, r);
        return Math.min(...ivc.map(([a, b]) => Math.hypot(a - x, b - y)));
      };
      // el mejor punto de la VSH media a 1–2 cm de la VCI (en el plano)
      const band = mhv
        .filter((c) => toIvc(c.th, c.r) >= 10 && toIvc(c.th, c.r) <= 20)
        .sort((a, b) => b.cos * w(b.th, b.r) - a.cos * w(a.th, a.r))
        .at(0);
      // la puerta que pone el operador (bestGateOnVessel: el mejor ángulo por la ventana, a ≥ 10 mm de la VCI)
      const g = bestGateOnVessel(anatomy, contact.frame, CONVEX_C35, sample, ['hvMiddle'], 165, 1.2, w);
      const deg = (c: number) => +((Math.acos(c) * 180) / Math.PI).toFixed(1);
      const tag = `${pattern}: ${JSON.stringify({
        banda: band && { r: band.r, grados: deg(band.cos), w: +w(band.th, band.r).toFixed(3), aVci: +toIvc(band.th, band.r).toFixed(1) },
        operador: g && { r: g.r, grados: deg(g.cosAngle), w: +w(g.theta, g.r).toFixed(3), aVci: +toIvc(g.theta, g.r).toFixed(1) },
      })}`;
      expect(band, tag).toBeDefined();
      expect(deg(band!.cos), tag).toBeLessThanOrEqual(60);
      expect(w(band!.th, band!.r), tag).toBeGreaterThanOrEqual(0.02);
      expect(g, tag).not.toBeNull();
      expect(deg(g!.cosAngle), tag).toBeLessThanOrEqual(60);
      expect(w(g!.theta, g!.r), tag).toBeGreaterThanOrEqual(0.02);
    }
  });

  it('subxifoidea (decisión 85): la VCI entra en la AD, a la vista a 10–15 cm en el lado craneal', () => {
    // Antes, por encima de la cúpula todo era pulmón y la esfera de la AD no apoyaba en el diafragma: la AD quedaba tras el
    // espejo del pulmón (0 de 669 muestras a la vista) y la VCI se veía hasta el borde de ese espejo
    const m = screenMap(poseOf(byId('subxiphoid')), 170);
    const [ra, ivc] = [m.of('ra'), m.of(...IVC)];
    const [cRa, cIvc] = [centroid(ra), centroid(ivc)];
    const tag = JSON.stringify({
      ad: `${ra.length}/${m.all('ra').length}`,
      vci: `${ivc.length}/${m.all(...IVC).length}`,
      xAd: +cRa.x.toFixed(1),
      xVci: +cIvc.x.toFixed(1),
      hondoAd: +(cRa.y - CONVEX_C35.curvatureRadius).toFixed(1),
      unión: +gapMm(ra, ivc).toFixed(2),
    });
    // la AD a la vista (casi entera) y la VCI entera
    expect(ra.length, tag).toBeGreaterThan(150);
    expect(ra.length, tag).toBeGreaterThan(0.8 * m.all('ra').length);
    expect(ivc.length, tag).toBe(m.all(...IVC).length);
    // la luz de la VCI llega a la cavidad de la aurícula (sin pared de por medio) por el lado craneal de la pantalla (el
    // marcador craneal a la izquierda), a la profundidad que promete la pista
    expect(gapMm(ra, ivc), tag).toBeLessThan(1.5);
    expect(cRa.x, tag).toBeLessThan(cIvc.x - 20);
    expect(cRa.y - CONVEX_C35.curvatureRadius, tag).toBeGreaterThan(100);
    expect(cRa.y - CONVEX_C35.curvatureRadius, tag).toBeLessThan(150);
    // en cada línea que llega a la aurícula sin cruzar la VCI, entre el hígado y la aurícula están el diafragma y el
    // pericardio (tejido del mediastino), sin pulmón
    const ivcLines = new Set(ivc.map((s) => s.line));
    const raLines = [...new Set(ra.map((s) => s.line))].filter((l) => !ivcLines.has(l));
    expect(raLines.length, tag).toBeGreaterThanOrEqual(4);
    for (const l of raLines) {
      const first = Math.min(...ra.filter((s) => s.line === l).map((s) => s.r));
      const before = Array.from({ length: first - 1 }, (_, k) => m.tissueAt(l, k + 1));
      const fromLiver = before.slice(before.lastIndexOf(Tissue.Liver) + 1);
      expect(fromLiver, `línea ${l}: ${tag}`).toContain(Tissue.Diaphragm);
      expect(fromLiver, `línea ${l}: ${tag}`).toContain(Tissue.Mediastinum);
      expect(fromLiver, `línea ${l}: ${tag}`).not.toContain(Tissue.Lung);
    }
  });

  it('subcostal (decisión 85): más allá de la VSH media y de la VCI, la aurícula derecha a la vista', () => {
    const m = screenMap(poseOf(byId('subcostal')), 165);
    const [ra, mhv, ivc] = [m.of('ra'), m.of('hvMiddle'), m.of(...IVC)];
    const tag = JSON.stringify({ ad: `${ra.length}/${m.all('ra').length}`, vci: `${ivc.length}/${m.all(...IVC).length}` });
    expect(ra.length, tag).toBeGreaterThan(60);
    // la VCI entera a la vista (antes, 94 de 215: su parte craneal quedaba tras el pulmón de encima de la cúpula)
    expect(ivc.length, tag).toBe(m.all(...IVC).length);
    // la aurícula, en el extremo craneal (a la izquierda de la pantalla), más allá de la desembocadura de la VSH media
    expect(centroid(ra).x, tag).toBeLessThan(centroid(mhv).x - 30);
    expect(gapMm(ra, ivc), tag).toBeLessThan(1.5);
  });

  it('epigástrica abanicada hacia la cabeza (decisión 85): la aorta sigue entera a la vista, en el mediastino', () => {
    // antes, por encima de la cúpula la aorta iba rodeada de pulmón y el abanico de 26° la perdía entera (0 de 103)
    const m = screenMap({ ...poseOf(byId('epigastric')), tilt: 0.45 }, 170);
    const aorta = m.of('aorta');
    const c = centroid(aorta);
    const tag = JSON.stringify({ aorta: `${aorta.length}/${m.all('aorta').length}`, x: +c.x.toFixed(1), y: +c.y.toFixed(1) });
    expect(aorta.length, tag).toBeGreaterThan(80);
    expect(aorta.length, tag).toBe(m.all('aorta').length);
    // delante de la aorta, entre ella y el hígado, tejido del mediastino (no pulmón)
    const lastLiver = (line: number) => {
      for (let r = Math.min(...aorta.filter((s) => s.line === line).map((s) => s.r)); r > 0; r--)
        if (m.tissueAt(line, r) === Tissue.Liver) return r;
      return 0;
    };
    const central = aorta.reduce((a, b) => (Math.abs(b.x - c.x) < Math.abs(a.x - c.x) ? b : a)).line;
    const top = Math.min(...aorta.filter((s) => s.line === central).map((s) => s.r));
    const front = Array.from({ length: top - lastLiver(central) - 1 }, (_, k) => m.tissueAt(central, lastLiver(central) + 1 + k));
    expect(front, tag).toContain(Tissue.Mediastinum);
    expect(front, tag).not.toContain(Tissue.Lung);
  });

  it('renal: corteza, médula y seno del riñón derecho con un vaso interlobar, el hígado y grasa alrededor', () => {
    const s = sweep(byId('renal'), 160);
    expect(s.coupling).toBeGreaterThan(0.5);
    expect(s.tissues.get(Tissue.RenalCortex) ?? 0).toBeGreaterThan(150);
    // pirámides discretas (decisión 43) en cono hasta el seno (decisión 87: 58 → 89 muestras)
    expect(s.tissues.get(Tissue.RenalMedulla) ?? 0).toBeGreaterThan(70);
    expect(s.tissues.get(Tissue.RenalSinus) ?? 0).toBeGreaterThan(40);
    expect([...s.vessels.keys()].some((v) => /interlobar|renalVein/i.test(v))).toBe(true);
    // el hígado junto al polo superior (Morison)
    expect(s.tissues.get(Tissue.Liver) ?? 0).toBeGreaterThan(150);
    // decisión 81: alrededor del riñón (a 8 mm de su grasa perirrenal) grasa retroperitoneal y ninguna asa; antes, 328
    // muestras de asas y ninguna de grasa
    const sp = byId('renal');
    const pose: ProbePose = { phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 };
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    const k = scene.kidneyRight;
    const ring = new Map<Tissue, number>();
    for (let i = 0; i < 61; i++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / 60;
      for (let r = 2; r < 160; r += 2) {
        const m = uncompress(pointOnLine(contact.frame, CONVEX_C35, theta, r), contact);
        const d = perirenalOuterSdf(kidneyLocal(m, k), k);
        if (d <= 0 || d > 8) continue;
        const t = scene.classify(m, BASELINE_CALIBER).tissue;
        ring.set(t, (ring.get(t) ?? 0) + 1);
      }
    }
    const tag = JSON.stringify(Object.fromEntries([...ring].map(([t, n]) => [Tissue[t], n])));
    expect(ring.get(Tissue.Bowel) ?? 0, tag).toBe(0);
    expect(ring.get(Tissue.RetroperitonealFat) ?? 0, tag).toBeGreaterThan(200);
    // decisión 87: sin la columna negra que cruzaba el contorno (la vena renal desde el centro del seno: 17 muestras dentro
    // del riñón); la vena nace en el borde medial del seno y el plano solo la corta en el hilio
    let veinInside = 0;
    for (let i = 0; i < 61; i++) {
      const theta = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / 60;
      for (let r = 2; r < 160; r += 2) {
        const m = uncompress(pointOnLine(contact.frame, CONVEX_C35, theta, r), contact);
        if (kidneyOuterSdf(kidneyLocal(m, k), k) < 0 && scene.classify(m, BASELINE_CALIBER).vessel === 'renalVeinRight') veinInside++;
      }
    }
    expect(veinInside).toBeLessThan(8);
  });
});
