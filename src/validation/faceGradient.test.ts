import { describe, expect, it } from 'vitest';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { FACE_GRADIENT_EPS_MM, INTERFACES, Interface, LAST_TUBE_INTERFACE } from '../anatomy/interfaces';
import { tubeFaceGradient, tubeQuery, type Tube } from '../anatomy/primitives';
import { AnatomyQuery } from '../anatomy/query';
import { AnatomyScene, faceGeometryOf } from '../anatomy/scene';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { PhysiologyEngine } from '../physiology/engine';
import { clonePatient } from '../physiology/patientState';
import {
  IFACE_GRADIENT_MAX,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  INTERFACE_ECHO_GLSL,
  faceDelta,
  faceProfile,
} from '../ultrasound/interfaceEcho';
import { FRAG_QUERY } from '../ultrasound/shaders/passes.glsl';

/**
 * El eco de interfaz evalúa su perfil de integral unidad en δ = ifd/(|∇|·cosθ) (decisión 57): `ifd` es
 * el valor de la distancia de la cara, que no siempre es euclídea, y |∇| la norma de su gradiente
 * (`faceGradient`). Sin |∇|, la suma del perfil a lo largo de un rayo valía 1/|∇|: la pared AP de la VCI
 * elíptica (|∇| = 1/apScale) perdía 2,2 dB a apScale 0,777 y 6 dB a 0,5. Aquí: la suma vale 1 en una VCI
 * elíptica sintética y en la de la escena, el gradiente y la curvatura de `tubeFaceGradient` (gemelo de
 * la GLSL) son los de la distancia del tubo, y la salida barata de la pasada B (ifd > alcance·cota antes
 * de calcular el gradiente) no descarta ninguna muestra al alcance de su cara.
 */
type V = Vec3;
const dr = 180 / 1024;
const add = (p: V, d: V, t: number): V => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const db = (x: number) => 20 * Math.log10(x);

/** VCI sintética: eje z, radio lateral 10 mm, sección elíptica de semieje AP 10·apScale; pared 0,8 mm. */
const syntheticIvc = (apScale: number, taper = 0): Tube => ({
  kind: 'tube',
  nodes: [
    { p: [0, 0, -60], r: 10 - taper },
    { p: [0, 0, 60], r: 10 + taper },
  ],
  apScale,
});
const WALL_MM = 0.8;

/**
 * Suma del perfil de dos lados a lo largo del rayo P + d·t que cruza la cara del tubo en P, promediada
 * sobre 50 posiciones de la cara dentro de una muestra. `withNorm` = false es la regla de antes (|∇| = 1).
 */
function profileSum(tube: Tube, P: V, d: V, withNorm = true): number {
  let acc = 0;
  const N = 50;
  for (let o = 0; o < N; o++)
    for (let k = -20; k <= 20; k++) {
      const p = add(P, d, (k + o / N) * dr);
      const hit = tubeQuery(p, tube, 1);
      if (hit.d >= WALL_MM) continue; // fuera de la pared: el hígado no conoce la cara
      const { gradient } = tubeFaceGradient(p, tube, 1, hit);
      const norm = Math.hypot(gradient[0], gradient[1], gradient[2]);
      const cos = Math.abs(dot(gradient, d)) / norm;
      acc += faceProfile(faceDelta(Math.abs(hit.d), withNorm ? norm : 1, cos), true) * dr;
    }
  return acc / N;
}

/** Rota v un ángulo a alrededor del eje unitario u (Rodrigues). */
const rotate = (v: V, u: V, a: number): V => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x: V = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [0, 1, 2].map((i) => v[i] * c + x[i] * s + u[i] * dot(u, v) * (1 - c)) as V;
};

describe('Eco de interfaz en la distancia por la normal (|∇| de la cara)', () => {
  it('VCI elíptica sintética: el perfil suma 1 en las paredes AP y lateral a 0–20° y cualquier apScale', () => {
    for (const ap of [1, 0.777, 0.7, 0.5]) {
      const tube = syntheticIvc(ap);
      for (const [wall, P, n] of [
        ['AP', [0, 10 * ap, 0], [0, 1, 0]],
        ['lateral', [10, 0, 0], [1, 0, 0]],
      ] as [string, V, V][]) {
        // incidencia θ inclinando el rayo en la sección (alrededor del eje) y a lo largo del eje
        for (const [axis, name] of [
          [[0, 0, 1], 'sección'],
          [wall === 'AP' ? [1, 0, 0] : [0, 1, 0], 'eje'],
        ] as [V, string][])
          for (const deg of [0, 10, 20]) {
            const d = rotate(n, axis, (deg * Math.PI) / 180);
            const sum = profileSum(tube, P, d);
            expect(Math.abs(db(sum)), `apScale ${ap}, pared ${wall}, ${deg}° en ${name}: ${db(sum).toFixed(3)} dB`).toBeLessThan(0.1);
          }
      }
      // la regla de antes (δ = ifd/cosθ) integra 1/|∇| = apScale en la pared AP; en la lateral, 1
      const before = profileSum(tube, [0, 10 * ap, 0], [0, 1, 0], false);
      expect(db(before)).toBeCloseTo(db(ap), 1);
      expect(Math.abs(db(profileSum(tube, [10, 0, 0], [1, 0, 0], false)))).toBeLessThan(0.1);
    }
  });

  it('tubeFaceGradient es el gradiente de la distancia del tubo (elíptico y afilado) y su curvatura la de la sección', () => {
    const numGrad = (tube: Tube, p: V): V => {
      const h = 1e-4;
      return [0, 1, 2].map((a) => {
        const pp: V = [...p];
        const pm: V = [...p];
        pp[a] += h;
        pm[a] -= h;
        return (tubeQuery(pp, tube, 1).d - tubeQuery(pm, tube, 1).d) / (2 * h);
      }) as V;
    };
    for (const ap of [1, 0.777, 0.5])
      for (const taper of [0, 1.5]) {
        const tube = syntheticIvc(ap, taper);
        for (let i = 0; i < 64; i++) {
          const phi = (2 * Math.PI * (i + 0.37)) / 64;
          const z = -30 + (60 * i) / 64;
          const rz = 10 + (taper * z) / 60;
          // a ±0,4 mm de la pared (la banda del eco), por la dirección radial de la sección escalada
          for (const off of [-0.4, 0.3]) {
            const p: V = [(rz + off) * Math.cos(phi), (rz + off) * ap * Math.sin(phi), z];
            const hit = tubeQuery(p, tube, 1);
            const { gradient } = tubeFaceGradient(p, tube, 1, hit);
            const g = numGrad(tube, p);
            const norm = Math.hypot(...g);
            expect(Math.hypot(...gradient) / norm - 1, `ap ${ap}, afilado ${taper}`).toBeCloseTo(0, 5);
            expect(dot(gradient, g) / (Math.hypot(...gradient) * norm)).toBeGreaterThan(1 - 1e-8);
          }
        }
        // curvatura: la de la elipse en sus paredes AP y lateral, y la divergencia de la normal en general
        const r = 10;
        const kAp = tubeFaceGradient([0, r * ap, 0], tube, 1, tubeQuery([0, r * ap, 0], tube, 1)).curvature;
        const kLat = tubeFaceGradient([r, 0, 0], tube, 1, tubeQuery([r, 0, 0], tube, 1)).curvature;
        expect(kAp * r).toBeCloseTo(ap, 6);
        expect(kLat * r).toBeCloseTo(1 / (ap * ap), 6);
        if (taper) continue;
        const unitN = (p: V): V => {
          const { gradient: g } = tubeFaceGradient(p, tube, 1, tubeQuery(p, tube, 1));
          const l = Math.hypot(...g);
          return [g[0] / l, g[1] / l, g[2] / l];
        };
        for (const phi of [0.3, 0.9, 1.3, 2.2]) {
          const p: V = [r * Math.cos(phi), r * ap * Math.sin(phi), 0];
          const h = 1e-4;
          let div = 0;
          for (let a = 0; a < 3; a++) {
            const pp: V = [...p];
            const pm: V = [...p];
            pp[a] += h;
            pm[a] -= h;
            div += (unitN(pp)[a] - unitN(pm)[a]) / (2 * h);
          }
          // la cara es un cilindro: la divergencia de su normal es su curvatura circunferencial
          expect(tubeFaceGradient(p, tube, 1, tubeQuery(p, tube, 1)).curvature / div - 1, `ap ${ap}, φ ${phi}`).toBeCloseTo(0, 4);
        }
      }
  });

  describe('en la escena (apnea espiratoria)', () => {
    const patient = { ...clonePatient(NORMAL_ADULT), respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient);
    const anatomy = new AnatomyQuery(scene);
    const engine = new PhysiologyEngine(patient, scene.vesselAreas(), { historySeconds: 4 });
    for (let i = 0; i < Math.round(2 / engine.clock.dt); i++) engine.step();
    const caliber = anatomy.caliberFor(engine.sample);

    it('la VCI infrahepática: classify y faceGradient dan un perfil que suma 1 en sus paredes AP y lateral', () => {
      const ivc = scene.vessels.find((v) => v.id === 'ivcInfra')!;
      const a = ivc.tube.nodes[1].p;
      const b = ivc.tube.nodes[2].p;
      const c: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      expect(caliber.ivcApScale).toBeLessThan(0.8);
      for (const ap of [caliber.ivcApScale, 0.5]) {
        const cal = { ...caliber, ivcApScale: ap };
        for (const d of [
          [0, 1, 0],
          [1, 0, 0],
        ] as V[]) {
          const tube = { ...ivc.tube, apScale: ap };
          const sdf = (t: number) => tubeQuery(add(c, d, t), tube, cal.radiusScale('ivcInfra')).d;
          let lo = 0;
          let hi = 30;
          for (let i = 0; i < 60; i++) {
            const mid = 0.5 * (lo + hi);
            if (sdf(mid) > 0) hi = mid;
            else lo = mid;
          }
          const P = add(c, d, 0.5 * (lo + hi));
          let now = 0;
          let before = 0;
          const N = 20;
          for (let o = 0; o < N; o++)
            for (let k = -20; k <= 20; k++) {
              const p = add(P, d, (k + o / N) * dr);
              const q = scene.classify(p, cal);
              if (q.interface !== Interface.IvcLumen) continue;
              const g = scene.faceGradient(p, cal)!;
              const cos = Math.abs(dot(g.normal, d));
              now += faceProfile(faceDelta(q.interfaceDistance, g.norm, cos), true) * dr;
              before += faceProfile(q.interfaceDistance / cos, true) * dr;
            }
          const tag = `apScale ${ap.toFixed(3)}, pared ${d[1] ? 'AP' : 'lateral'}`;
          expect(Math.abs(db(now / N)), tag).toBeLessThan(0.1);
          // la pared AP de antes perdía 20·log10(apScale)
          if (d[1]) expect(db(before / N), tag).toBeLessThan(db(ap) + 0.2);
        }
      }
    });

    it('la salida barata de la pasada B no descarta ninguna muestra al alcance de su cara', () => {
      // GLSL: sin calcular el gradiente, descarta ifd > alcance·cota, con cota = |∇| exacta en los tubos
      // (va en c.n) e IFACE_GRADIENT_MAX en el resto. Es exacto si toda muestra descartada tiene
      // ifd/|∇| > alcance: se comprueba en puntos del tronco a ≤ 3 mm de una cara que no es de tubo (más
      // hondo, en el centro de la vesícula, el gradiente del elipsoide no es el de su cara)
      let state = 20260924;
      const rnd = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const seen = new Map<Interface, { near: number; dropped: number; maxNorm: number }>();
      for (let i = 0; i < 400_000; i++) {
        const r = Math.sqrt(rnd());
        const a = 2 * Math.PI * rnd();
        const m: V = [scene.torso.a * r * Math.cos(a), scene.torso.b * r * Math.sin(a), -160 + 280 * rnd()];
        const c = scene.classify(m, caliber);
        if (c.interface === Interface.None || c.interface <= LAST_TUBE_INTERFACE || c.interfaceDistance > 3) continue;
        const reach = INTERFACES[c.interface].twoSided ? IFACE_REACH_MM : IFACE_SHIFT_MM + IFACE_REACH_MM;
        const g = scene.faceGradient(m, caliber)!;
        const s = seen.get(c.interface) ?? { near: 0, dropped: 0, maxNorm: 0 };
        s.near++;
        if (c.interfaceDistance > reach * IFACE_GRADIENT_MAX) {
          s.dropped++;
          s.maxNorm = Math.max(s.maxNorm, g.norm);
          expect(c.interfaceDistance / g.norm, `${Interface[c.interface]} en ${m.map((x) => x.toFixed(1)).join(', ')}`).toBeGreaterThan(
            reach,
          );
        }
        seen.set(c.interface, s);
      }
      // todas las caras que no son tubos aparecen, y las que la salida barata recorta tienen muestras; la de la grasa
      // perirrenal, desde la decisión 81, solo donde es gruesa y apoya el hígado (la fina dibuja la de la cápsula renal)
      for (const f of [Interface.LiverCapsule, Interface.DiaphragmLiver, Interface.RenalCapsule, Interface.GallbladderLumen])
        expect(seen.get(f)?.near ?? 0, Interface[f]).toBeGreaterThan(200);
      expect(seen.get(Interface.PerirenalFat)?.near ?? 0).toBeGreaterThan(100);
      for (const f of [Interface.RenalCapsule, Interface.GallbladderLumen])
        expect(seen.get(f)?.dropped ?? 0, Interface[f]).toBeGreaterThan(100);
      // la cara externa de la grasa perirrenal (decisión 68): donde es gruesa y apoya el hígado su mitad externa llega a
      // 4,5 mm y la salida barata recorta muestras; su gradiente, el de su propia distancia (perirenalOuterSdf, hasta
      // 1,25), queda bajo la cota
      expect(seen.get(Interface.PerirenalFat)?.dropped ?? 0).toBeGreaterThan(50);
      expect(seen.get(Interface.PerirenalFat)?.maxNorm ?? 0).toBeLessThan(IFACE_GRADIENT_MAX);
      // las caras de la pared y de las costillas (decisión 62): la distancia de su capa ondula en (u, z) y la
      // de la costilla no es euclídea; la salida barata tampoco pierde muestras suyas. Sin ondas periódicas en
      // la vuelta, la línea media posterior (donde u salta de +P/2 a −P/2) daba aquí un |∇| de ~10³
      for (const f of [
        Interface.SkinFat,
        Interface.Scarpa,
        Interface.DeepFascia,
        Interface.ObliquePlane,
        Interface.TransversusPlane,
        Interface.Transversalis,
        Interface.Peritoneum,
        Interface.RibCortex,
        Interface.Perichondrium,
      ]) {
        expect(seen.get(f)?.near ?? 0, Interface[f]).toBeGreaterThan(50);
        // el peritoneo lo dibuja una grasa preperitoneal de ≥ 1,5 mm cuya mitad honda cae entera dentro de la
        // cota: nunca se descarta
        if (f !== Interface.Peritoneum) expect(seen.get(f)?.dropped ?? 0, Interface[f]).toBeGreaterThan(20);
        expect(seen.get(f)?.maxNorm ?? 0, Interface[f]).toBeLessThan(IFACE_GRADIENT_MAX);
      }
    });

    it('faceGradient da el gradiente numérico de faceSdf fuera de los tubos y el analítico en ellos', () => {
      // los puntos de la banda del eco (0,02–0,5 mm) de cada cara en una rejilla del tronco; en un tubo, la
      // diferencia central de referencia solo vale si sus dos puntos siguen en el mismo segmento del mismo
      // tubo (si no, salta a otro tubo o sale de la pared: las uniones y el borde externo de la pared)
      const worst = { tube: 0, numeric: 0 };
      const count = { tube: 0, numeric: 0 };
      const h = FACE_GRADIENT_EPS_MM;
      for (let x = -120; x <= 110; x += 2.3)
        for (let y = -80; y <= 80; y += 2.3)
          for (let z = -150; z <= 90; z += 7.9) {
            const m: V = [x, y, z];
            const c = scene.classify(m, caliber);
            const face = faceGeometryOf(c.interface);
            if (!face || c.interfaceDistance < 0.02 || c.interfaceDistance > 0.5) continue;
            const t0 = face === 'tube' ? scene.faceTube(m, caliber)! : null;
            const same = (p: V) => {
              const t = scene.faceTube(p, caliber);
              // (las ramas procedurales comparten el id de su madre: dos hermanas con el mismo id y segmento se distinguen
              // por la dirección de su eje)
              const tg = t?.hit.tangent;
              const t0g = t0!.hit.tangent;
              return (
                t !== null &&
                t.vessel === t0!.vessel &&
                t.hit.segment === t0!.hit.segment &&
                t.hit.s > 0 &&
                t.hit.s < 1 &&
                Math.abs(tg![0] * t0g[0] + tg![1] * t0g[1] + tg![2] * t0g[2] - 1) < 1e-9
              );
            };
            let ok = true;
            const num = [0, 1, 2].map((a) => {
              const pp: V = [...m];
              const pm: V = [...m];
              pp[a] += h;
              pm[a] -= h;
              if (t0 && (!same(pp) || !same(pm))) ok = false;
              return (scene.faceSdf(pp, caliber, face)! - scene.faceSdf(pm, caliber, face)!) / (2 * h);
            }) as V;
            if (!ok) continue;
            const g = scene.faceGradient(m, caliber)!;
            const err = Math.abs(g.norm / Math.hypot(...num) - 1);
            const key = face === 'tube' ? 'tube' : 'numeric';
            worst[key] = Math.max(worst[key], err);
            count[key]++;
          }
      expect(count.tube).toBeGreaterThan(500);
      expect(count.numeric).toBeGreaterThan(500);
      // fuera de los tubos es el mismo cálculo; en ellos, el analítico frente a diferencias de 0,02 mm
      expect(worst.numeric).toBeLessThan(1e-12);
      expect(worst.tube).toBeLessThan(1e-3);
    });
  });

  it('GLSL: el gradiente sin normalizar de los tubos, la norma de las diferencias centrales y δ con |∇|', () => {
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    expect(glsl).toContain('n = dist > 0.0 && dot(gn, gn) > 0.0 ? gn : vec3(0.0, 1.0, 0.0);');
    expect(glsl).toContain('kc = (1.0 + cy * cy * (1.0 / (apScale * apScale) - 1.0)) * dist / (r * length(g));');
    expect(glsl).toContain('vec4 faceGradient(Cls c, vec3 m)');
    expect(glsl).toContain('if (lg > 0.0) return vec4(g / lg, lg / (2.0 * FACE_GRAD_EPS));');
    expect(glsl).toContain('return l > 0.0 ? vec4(c.n / l, l) : vec4(0.0, 1.0, 0.0, 1.0);');
    // la aurícula se mide antes que los tubos y les quita la cara
    expect(glsl).toContain('c.iface = inRa ? IF_NONE : iface; c.ifd = inRa ? 1e3 : abs(bestD);');
    const echo = INTERFACE_ECHO_GLSL.replace(/\s+/g, ' ');
    expect(echo).toContain(`#define IFACE_GRAD_MAX ${IFACE_GRADIENT_MAX.toFixed(4)}`);
    // con la compresión de la sonda (decisión 63) la cota se multiplica por la de la jacobiana (warpBound) y el
    // gradiente de la cara se lleva al mundo antes del eco
    expect(echo).toContain('float gBound = (c.iface <= IF_LAST_TUBE ? length(c.n) : IFACE_GRAD_MAX) * warpBound(w);');
    expect(echo).toContain('vec3 gw = warpNormal(w, fg.xyz * fg.w); float gn = length(gw); fg = vec4(gw / max(gn, 1e-9), gn);');
    expect(echo).toContain('return interfaceProfileEcho(c.iface, cosI, curv, c.ifd / (fg.w * cosI));');
    expect(echo).toContain('float kl = dot(lat, circ); kl = kl * kl * c.kc;');
    expect(FRAG_QUERY).toContain('o2 = faceGradient(c, m);');
    // las diferencias centrales de la vesícula y de la cápsula usan las sobrecargas sin normal (decisión 67)
    expect(glsl).toContain('g = vec3(gallbladderSdf(m + h.xyy) - gallbladderSdf(m - h.xyy),');
    expect(glsl).toContain('float dLiver = liverSdf(m, dLiverBase);');
    expect(glsl).toContain('float dg = gallbladderSdf(m) - uGbExtra.y;');
  });
});
