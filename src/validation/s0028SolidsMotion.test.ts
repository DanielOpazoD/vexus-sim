import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it, vi } from 'vitest';
import { installAnatomyBundle, S0028_BUNDLE as B } from '../anatomy/anatomyBundle';
import { abdominalAtlas, setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setThoracicAtlas, thoracicAtlas } from '../anatomy/thoracicAtlas';
import { abdominalBody, setAbdominalBody } from '../anatomy/referenceBody';
import { setS0028Wall } from '../anatomy/s0028Wall';
import { setS0028Solids } from '../anatomy/s0028Solids';
import { AnatomyScene } from '../anatomy/scene';
import { AnatomyQuery } from '../anatomy/query';
import { Interface } from '../anatomy/interfaces';
import { Tissue } from '../anatomy/tissues';
import { structureIdentity } from '../anatomy/structureIdentity';
import { NORMAL_ADULT } from '../cases';
import { PhysiologyEngine, type PhysiologySample } from '../physiology/engine';
import { CONVEX_C35 } from '../probe/probe';
import { probeContact } from '../probe/contact';
import { compressionReachMm, compressionSample, uncompress } from '../anatomy/compression';
import { s0028SourceValue } from '../anatomy/s0028Source';
import { startPointsFor } from '../app/startPoints';
import { cutMapDirections, cutMapPoint } from '../ui/cutMapGeometry';
import type { CutMapInit, CutMapRequest, CutMapResponse } from '../ui/cutMapWorker';
import type { Vec3 } from '../core/vec3';

const raw = (name: string) => new Uint8Array(gunzipSync(readFileSync(`src/anatomy/s0028/${name}.gzip.bin`))).buffer;
let scene: AnatomyScene, capacity: ArrayBuffer, skin: ArrayBuffer, sample: PhysiologySample;
beforeAll(() => {
  installAnatomyBundle(B);
  setAbdominalAtlas(new Uint16Array(raw('abdominal-direct')));
  setThoracicAtlas(new Uint16Array(raw('thoracic-direct')));
  capacity = raw('annotation-capacity');
  skin = raw('skin-polar');
  setS0028Wall(capacity, skin);
  setS0028Solids(capacity);
  setAbdominalBody(new Float32Array(new Uint8Array(readFileSync('src/anatomy/abdominal-body.bin')).buffer));
  scene = new AnatomyScene(NORMAL_ADULT);
  sample = new PhysiologyEngine(NORMAL_ADULT, scene.vesselAreas()).sample;
});
const poses = () => startPointsFor(scene.torso, B).map((p) => ({ ...p, rock: p.rock ?? 0, tilt: p.tilt ?? 0 }));

it('contacto: P3 conserva la carta P2 y su U; los 30 contactos s0028 son los de main 3c50b18 salvo la tabla rígida (r3)', () => {
  const values = [];
  for (const pose of poses())
    for (const lift of [-3, 0, 10]) {
      const { rigid, ...contact } = probeContact({ ...pose, lift }, CONVEX_C35, scene.torso);
      // r3 sólo añade las zonas rígidas por nodo; el alcance crece en el tramo renal más largo (σ' = 0 dentro).
      expect(rigid).toHaveLength(64);
      expect(contact.reachMm).toBe(compressionReachMm(contact.nodes) + Math.max(0, ...rigid!.map((r) => r[2])));
      values.push({ id: pose.id, lift, contact: { ...contact, reachMm: compressionReachMm(contact.nodes) } });
    }
  // SHA de main (script contact-s0028.mts de la evidencia P3 r2 sobre git archive 3c50b18).
  expect(createHash('sha256').update(JSON.stringify(values)).digest('hex')).toBe(
    '56201065819f134067b4fbf53feb17cc43285558cd409731e6fb8d40b4a92d1c',
  );
});

it('reposo y compresión: dueños evaluados en el material, invariantes de límites y U nunca conocido', () => {
  const query = new AnatomyQuery(scene);
  for (const id of ['renal', 'hepatorenal', 'intercostal', 'subcostal']) {
    const pose = poses().find((p) => p.id === id)!;
    for (const compression of [null, probeContact({ ...pose, lift: 0 }, CONVEX_C35, scene.torso)]) {
      query.setProbeCompression(compression);
      const k = compression ?? probeContact({ ...pose, lift: 0 }, CONVEX_C35, scene.torso),
        f = k.frame;
      let kidney = 0,
        bone = 0;
      for (let j = 0; j < 160; j += 3)
        for (let i = 0; i < 267; i += 3) {
          const p = f.skinPoint.map((x, c) => x + (-100 + 0.75 * i) * f.lateral[c] + 0.75 * j * f.axial[c]) as Vec3;
          const w = query.classifyWorld(p, sample),
            c = scene.classify(query.deformation.toMaterial(p, sample.resp), query.caliberFor(sample));
          // El mundo sólo cambia dónde se consulta: mismo material, mismos dueños.
          expect(w.solids, `${id} ${i},${j}`).toEqual(c.solids);
          if (!c.solids) continue;
          const { state, owners } = c.solids;
          // Hallazgo heredado de P7 (igual en main 3c50b18): el tórax E del corazón da distancias negativas.
          if (owners[0]?.id !== 'heart')
            expect(Number.isFinite(c.boundaryDistance) && c.boundaryDistance >= 0, `${id} ${i},${j}`).toBe(true);
          expect(state).toBe(owners.length > 1 ? 'conflict' : owners.length ? 'known' : 'U');
          for (const o of owners) expect(o.id === 'compatible_fat' ? o.d === 0 : o.d < 0, `${id} ${o.id}`).toBe(true);
          const tube = c.vesselHit || c.interface === Interface.DuctLumen;
          if (state === 'conflict') expect(c.tissue).toBe(Tissue.UnsegmentedSoftTissue);
          else if (state === 'U' && !tube && c.tissue !== Tissue.Diaphragm) expect(c.tissue).toBe(Tissue.UnsegmentedSoftTissue);
          else if (owners[0]?.id.startsWith('kidney_r')) {
            kidney++;
            // El material del riñón sigue siendo U con y sin presión; la compresión heredada sí lo desplaza (r3).
            expect([c.tissue, c.vessel]).toEqual([Tissue.UnsegmentedSoftTissue, null]);
          } else if (owners[0]?.id === 'bone') {
            bone++;
            expect([Tissue.Bone, Tissue.Vertebra]).toContain(c.tissue);
          }
        }
      if (id === 'renal') expect(kidney, `${id} ${compression ? 'compresión' : 'reposo'}`).toBeGreaterThan(50);
      if (id === 'intercostal') expect(bone).toBeGreaterThan(20);
    }
  }
});

it('respiración: sólo los estímulos E de 10/20 mm del diseño, mismo material en CPU y Worker bit a bit', async () => {
  const posted: unknown[] = [];
  vi.stubGlobal('self', { postMessage: (m: unknown) => posted.push(m) });
  await import('../ui/cutMapWorker');
  const handler = (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => Promise<void> } }).self.onmessage;
  const init: CutMapInit = {
    type: 'init',
    identity: B,
    id: 1,
    patient: NORMAL_ADULT,
    referenceProfile: abdominalBody,
    abdominalField: abdominalAtlas,
    thoracicField: thoracicAtlas,
    wall: capacity,
    skin,
  };
  await handler({ data: init });
  const query = new AnatomyQuery(scene);
  const pose = poses().find((p) => p.id === 'renal')!;
  const k = probeContact({ ...pose, lift: 0 }, CONVEX_C35, scene.torso);
  query.setProbeCompression(k);
  let id = 1;
  for (const D of [10, 20]) {
    // El TAC es estático: el campo vigente (w·D·dir) desplaza el centro renal (w = 1) en (0, 0,15, −1)·D normalizado.
    const s = { ...sample, resp: { ...sample.resp, diaphragmCaudalMm: D } };
    const center: Vec3 = [-50.52, -27.72, -128.08]; // centroide de la máscara renal derecha (resp-weights-head.json)
    expect(query.deformation.displacement(center, s.resp).map((v) => +v.toFixed(3))).toEqual(
      D === 10 ? [0, 1.483, -9.889] : [0, 2.967, -19.779],
    );
    const req: CutMapRequest = {
      type: 'map',
      id: ++id,
      frame: k.frame,
      transducer: CONVEX_C35,
      compression: k,
      depthMm: 160,
      sample: s,
      width: 48,
      height: 64,
    };
    await handler({ data: req });
    const map = posted.find((m): m is CutMapResponse => (m as CutMapResponse).type === 'map' && (m as CutMapResponse).id === id)!;
    const dirs = cutMapDirections(k.frame, CONVEX_C35, 48);
    let owned = 0;
    for (let v = 0; v < 64; v++)
      for (let u = 0; u < 48; u++) {
        const m = query.deformation.toMaterial(
          cutMapPoint(k.frame.curvatureCenter, dirs[u], CONVEX_C35.curvatureRadius + (160 * (v + 0.5)) / 64),
          s.resp,
        );
        const c = scene.classify(m, query.caliberFor(s)),
          i = v * 48 + u;
        expect([map.tissue[i], map.structure[i]], `D${D} ${u},${v}`).toEqual([
          c.tissue,
          structureIdentity(m, c.tissue, c.interface, scene, c.solids),
        ]);
        if (c.solids?.state === 'known') owned++;
      }
    expect(owned).toBeGreaterThan(1000);
  }
  vi.unstubAllGlobals();
});

it('compresión rígida por dueño (r3): el riñón se traslada entero y la columna no se mueve; el mapa sigue monótono', () => {
  const sd = (m: Vec3, name: string) => s0028SourceValue(m, name);
  for (const id of ['renal', 'hepatorenal', 'subcostal', 'flank', 'epigastric']) {
    const k = probeContact({ ...poses().find((p) => p.id === id)!, lift: 0 }, CONVEX_C35, scene.torso),
      f = k.frame;
    const strain: number[] = [],
      vertebra: number[] = [];
    let slope = Infinity;
    for (let j = 0; j < 214; j += 2)
      for (let i = 0; i < 267; i += 2) {
        const p = f.skinPoint.map((x, c) => x + (-100 + 0.75 * i) * f.lateral[c] + 0.75 * j * f.axial[c]) as Vec3;
        const s = compressionSample(p, k),
          h = 0.05;
        if (s.rho < 1e-6) continue;
        const at = (t: number) => compressionSample(p.map((x, c) => x + t * s.rhat[c]) as Vec3, k).shift,
          ds = (at(h) - at(-h)) / (2 * h);
        // dr/dd = 1 + ∂s/∂d ≥ 1: nunca se pliega ni se estira a lo largo de la línea.
        slope = Math.min(slope, ds);
        const m = uncompress(p, k),
          tb = sd(m, 'thoracicBone'),
          lb = sd(m, 'lumbarSacralBone');
        if (Math.min(sd(m, 'kidneyRight').d, sd(m, 'kidneyLeft').d) < -1.5) strain.push(Math.abs(ds));
        if ((lb.d < -1.5 && lb.label <= 5) || (tb.d < -1.5 && tb.label >= 25 && tb.label <= 36)) vertebra.push(-s.shift);
      }
    const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.floor(f * (v.length - 1))];
    expect(slope, id).toBeGreaterThanOrEqual(-1e-6);
    // main: ∂s/∂r ≈ 0,25 en todo el riñón y vértebras desplazadas hasta 1,4 mm (compression-owners-main.json); r3: 0.
    if (id !== 'epigastric') {
      expect(strain.length, id).toBeGreaterThan(100);
      expect(q(strain, 0.9), `${id} riñón`).toBeLessThanOrEqual(0.02);
    }
    if (id === 'hepatorenal' || id === 'epigastric') expect(vertebra.length, id).toBeGreaterThan(40);
    if (vertebra.length) expect(Math.max(...vertebra), `${id} vértebra`).toBeLessThanOrEqual(0.01);
  }
});
