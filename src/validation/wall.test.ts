import { INTERFACE_SOURCES } from '../anatomy/interfaceSources';
import { describe, expect, it } from 'vitest';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import { SCENE_UNIFORMS } from '../anatomy/gpu/sceneUniforms';
import {
  FIRST_WALL_INTERFACE,
  INTERFACES,
  INTERFACE_COUNT,
  INTERFACE_GLSL_NAME,
  Interface,
  LAST_WALL_INTERFACE,
  hasCurvatureCoherence,
  interfaceReflectivity,
  isRibInterface,
  isWallLayerInterface,
} from '../anatomy/interfaces';
import { ORGAN_MODULES } from '../anatomy/organs';
import {
  WALL,
  WALL_GLSL,
  WALL_SWELL_TERMS,
  WALL_WAVE_TERMS,
  preperitonealMm,
  ribSearchDepth,
  ribCurvature,
  ribTangent,
  wallArc,
  wallArcGradient,
  wallDepths,
  wallFaceDepth,
  wallFace,
  wallFaceSd,
  wallFaceSlope,
  wallFatMm,
  wallPerimeter,
  wallPlaneDepth,
  wallPlaneGap,
  wallSwell,
  wallWave,
} from '../anatomy/organs/wall';
import { ribAnteriorEndX, sdRib, torsoDepth, torsoDepthGradient, torsoNormal, torsoSkinPoint } from '../anatomy/primitives';
import { AnatomyScene, BASELINE_CALIBER, faceGeometryOf } from '../anatomy/scene';
import { TISSUES, TISSUE_COUNT, Tissue } from '../anatomy/tissues';
import { START_POINTS } from '../app/startPoints';
import { CASES, NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { CONVEX_C35, lineDirection, pointOnLine, probeFrame } from '../probe/probe';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';
import {
  IFACE_GRADIENT_MAX,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  INTERFACE_ECHO_GLSL,
  faceDelta,
  faceLitFromProbe,
  interfaceEchoField,
} from '../ultrasound/interfaceEcho';
import { FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED } from '../ultrasound/shaders/passes.glsl';
import {
  WALL_FACE_ECHO_GLSL,
  WALL_TEXTURE,
  WALL_TEXTURE_GLSL,
  fatSeptum,
  muscleStriation,
  wallFaceEchoFlat,
  wallFaceGain,
  wallOrientation,
  wallTexture,
} from '../ultrasound/wallTexture';

/**
 * Pared torácica y abdominal realista (decisión 62): geometría de las capas y de sus caras (TS, con su gemelo
 * GLSL en `organs/wall.ts`), la tabla de caras nuevas y la textura de la pasada B (`wallTexture.ts`). Antes la
 * pared eran tres bandas uniformes sin ninguna cara: estas pruebas fallan en `main` (no existe nada de esto).
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const t = scene.torso;
const cls = (p: Vec3) => scene.classify(p, BASELINE_CALIBER);
/** Punto a la profundidad d bajo la piel en el ángulo del tronco φ (radial desde el eje, la métrica de las capas). */
const at = (phi: number, z: number, d: number): Vec3 => {
  const skin: Vec3 = [t.a * Math.cos(phi), t.b * Math.sin(phi), z];
  const k = 1 - d / Math.hypot(skin[0], skin[1]);
  return [skin[0] * k, skin[1] * k, z];
};
const FLANK = Math.PI * 1.04;
const WALL_FACES = [
  Interface.SkinFat,
  Interface.Scarpa,
  Interface.DeepFascia,
  Interface.ObliquePlane,
  Interface.TransversusPlane,
  Interface.Transversalis,
  Interface.Peritoneum,
];

describe('capas de la pared (decisión 62)', () => {
  it('la grasa preperitoneal sale del músculo del hábito (15 % de la grasa, 1,5–4 mm) y el espesor total no cambia', () => {
    expect(preperitonealMm(14)).toBeCloseTo(2.1, 9);
    expect(preperitonealMm(5)).toBe(1.5);
    expect(preperitonealMm(40)).toBe(4);
    expect(t.preperitonealMm).toBeCloseTo(2.1, 9);
    expect(scene.wallThickness()).toBe(t.skinMm + t.fatMm + t.muscleMm);
    // el esquema único sube la grasa preperitoneal en uWall.w
    const uWall = SCENE_UNIFORMS.find((u) => u.name === 'uWall')!;
    expect(uWall.type).toBe('vec4');
    expect(Array.from(uWall.value(scene, { sample: null as never, tubeCount: 0, compression: null }))).toEqual([
      t.skinMm,
      t.fatMm,
      t.muscleMm,
      t.preperitonealMm,
    ]);
  });

  it('u es la longitud de arco de la piel: el cuarto de perímetro de Ramanujan y |du/ds| = 1 a ±0,5 %', () => {
    const a = t.a;
    const b = t.b;
    const ramanujan = (Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))) / 4;
    expect(wallArc([a, 0, 0], t)).toBeCloseTo(ramanujan, 0);
    expect(wallPerimeter(t) / 4).toBeCloseTo(ramanujan, 0);
    expect(wallArc([0, b, 0], t)).toBeCloseTo(0, 9);
    // +x (izquierda del paciente) es u creciente
    expect(wallArc([10, b, 0], t)).toBeGreaterThan(0);
    for (let tau = -3; tau <= 3; tau += 0.25) {
      const p = (s: number): Vec3 => [a * Math.sin(s), b * Math.cos(s), 0];
      const h = 1e-4;
      const ds = Math.hypot(p(tau + h)[0] - p(tau - h)[0], p(tau + h)[1] - p(tau - h)[1]);
      const du = wallArc(p(tau + h), t) - wallArc(p(tau - h), t);
      expect(Math.abs(du / ds - 1), `τ ${tau}`).toBeLessThan(0.005);
    }
  });

  it('las ondas son periódicas en la vuelta: sin costura donde u salta de +P/2 a −P/2 (línea media posterior)', () => {
    const P = wallPerimeter(t);
    for (let k = 0; k < 5; k++)
      for (const z of [-80, 0, 35]) {
        expect(Math.abs(wallWave(P / 2, z, k, t) - wallWave(-P / 2, z, k, t))).toBeLessThan(1e-9);
        if (k < 4) expect(Math.abs(wallSwell(P / 2, z, k, t) - wallSwell(-P / 2, z, k, t))).toBeLessThan(1e-9);
      }
    // la fascia profunda a ambos lados del corte, a 0,001 mm
    const left = wallDepths(t, wallArc([0.001, -104, 10], t), 10).fascia;
    const right = wallDepths(t, wallArc([-0.001, -104, 10], t), 10).fascia;
    expect(Math.abs(left - right)).toBeLessThan(1e-3);
  });

  it('orden de las caras en la pared lateral y fusión de los planos hacia el recto', () => {
    for (const z of [-60, -14, 20]) {
      const u = wallArc(at(FLANK, z, 0), t);
      const w = wallDepths(t, u, z);
      const p0 = wallPlaneDepth(u, z, 0, t);
      const p1 = wallPlaneDepth(u, z, 1, t);
      expect(w.skin).toBeLessThan(w.scarpa);
      expect(w.scarpa).toBeLessThan(w.fascia);
      expect(w.fascia).toBeLessThan(p0);
      expect(p0).toBeLessThan(p1);
      expect(p1).toBeLessThan(w.transversalis);
      expect(w.transversalis).toBeLessThan(w.peritoneum);
      // la grasa preperitoneal ondula sin bajar de 1,5 mm con 2,1 mm de media (la cara de un lado cabe)
      expect(w.peritoneum - w.transversalis).toBeGreaterThan(1.8);
      expect(wallPlaneGap(p0, 0, w)).toBeGreaterThan(WALL.planeMinMm);
      expect(wallPlaneGap(p1, 1, w)).toBeGreaterThan(WALL.planeMinMm);
    }
    // en la línea media (recto) los planos se han fundido con sus vainas
    for (const u of [-30, 0, 20]) {
      const w = wallDepths(t, u, 0);
      expect(wallPlaneGap(wallPlaneDepth(u, 0, 0, t), 0, w)).toBeLessThan(WALL.planeMinMm);
      expect(wallPlaneGap(wallPlaneDepth(u, 0, 1, t), 1, w)).toBeLessThan(WALL.planeMinMm);
    }
  });

  it('classify: tejidos y caras de piel a peritoneo en el flanco, cada muestra con su capa más cercana', () => {
    const z = -14;
    const u = wallArc(at(FLANK, z, 0), t);
    const w = wallDepths(t, u, z);
    const planes = [wallPlaneDepth(u, z, 0, t), wallPlaneDepth(u, z, 1, t)];
    const expected: [number, Interface, Tissue][] = [
      [w.skin, Interface.SkinFat, Tissue.Fat],
      [w.scarpa, Interface.Scarpa, Tissue.Fat],
      [w.fascia, Interface.DeepFascia, Tissue.Muscle],
      [planes[0], Interface.ObliquePlane, Tissue.Muscle],
      [planes[1], Interface.TransversusPlane, Tissue.Muscle],
      [w.transversalis, Interface.Transversalis, Tissue.Fat],
    ];
    for (const [d, face, tissue] of expected) {
      const c = cls(at(FLANK, z, d + 0.1));
      expect(c.tissue, Interface[face]).toBe(tissue);
      expect(c.interface, Interface[face]).toBe(face);
      expect(c.interfaceDistance, Interface[face]).toBeCloseTo(0.1, 1);
    }
    // dentro de la piel, la cara dermis/grasa; junto a la cara interna, el peritoneo (de un lado)
    expect(cls(at(FLANK, z, 1)).tissue).toBe(Tissue.Skin);
    expect(cls(at(FLANK, z, 1)).interface).toBe(Interface.SkinFat);
    const pe = cls(at(FLANK, z, w.peritoneum - 0.3));
    expect(pe.tissue).toBe(Tissue.Fat);
    expect(pe.interface).toBe(Interface.Peritoneum);
    expect(pe.interfaceDistance).toBeCloseTo(0.3, 5);
    // ninguna muestra de la pared se queda sin cara ni la dibuja fuera de su capa
    for (let d = 0.05; d < w.peritoneum; d += 0.1) {
      const c = cls(at(FLANK, z, d));
      if (c.tissue === Tissue.Bone || c.tissue === Tissue.Cartilage) continue;
      expect(isWallLayerInterface(c.interface) || c.interface === Interface.RibCortex, `${d.toFixed(2)} mm`).toBe(true);
    }
  });

  it('cortical costal: la dibuja el músculo junto a la costilla ósea; el cartílago dibuja su pericondrio', () => {
    // barrido de la pared derecha: muestras de cada una, con su distancia al alcance del eco
    let rib = 0;
    let peri = 0;
    for (let phiDeg = 95; phiDeg <= 250; phiDeg += 5)
      for (let z = -100; z <= 80; z += 1)
        for (let d = 10; d < 34; d += 0.5) {
          const c = cls(at((phiDeg * Math.PI) / 180, z, d));
          if (c.interface === Interface.RibCortex) {
            expect([Tissue.Muscle, Tissue.Fat]).toContain(c.tissue);
            expect(c.interfaceDistance).toBeLessThan(WALL.ribFacePriorityMm);
            rib++;
          }
          if (c.interface === Interface.Perichondrium) {
            expect(c.tissue).toBe(Tissue.Cartilage);
            peri++;
          }
          if (c.tissue === Tissue.Bone) expect(c.interface).toBe(Interface.None);
        }
    expect(rib).toBeGreaterThan(100);
    expect(peri).toBeGreaterThan(100);
    // la prioridad de la cortical cubre el perfil de una cara de un lado con la cota de su gradiente
    expect(WALL.ribFacePriorityMm).toBeGreaterThanOrEqual((IFACE_SHIFT_MM + IFACE_REACH_MM) * IFACE_GRADIENT_MAX);
    // la sección elíptica de la costilla: en su cresta, halfThickness/halfWidth²; el eje, tangente a la piel
    const r0 = scene.ribs[5];
    const phi = Math.PI * 1.04;
    const zc = r0.zAnterior + r0.tilt * (0.5 - 0.5 * Math.sin(phi));
    const crest: Vec3 = [t.a * r0.scale * Math.cos(phi) * 1.02, t.b * r0.scale * Math.sin(phi) * 1.02, zc];
    expect(ribCurvature(crest, r0, t)).toBeCloseTo(r0.halfThickness / r0.halfWidth ** 2, 6);
    const n = torsoNormal(crest, t);
    const tg = ribTangent(crest, r0, t);
    expect(Math.abs(n[0] * tg[0] + n[1] * tg[1])).toBeLessThan(0.1);
  });

  it('cartílago costal solo en el arco anterior (±45°, hasta la línea medioclavicular) y las 8.ª–10.ª acaban en el reborde costal', () => {
    const ribs = scene.ribs;
    // 5.ª–7.ª hasta el esternón; 8.ª–10.ª hasta el reborde costal, cada una más lateral
    expect(ribs.slice(0, 3).map((r) => ribAnteriorEndX(r))).toEqual([15, 15, 15]);
    const ends = ribs.slice(3).map((r) => ribAnteriorEndX(r));
    expect(ends[0]).toBeLessThan(-15);
    expect(ends[1]).toBeLessThan(ends[0] - 30);
    expect(ends[2]).toBeLessThan(-90);
    for (const [i, rib] of ribs.entries()) {
      const zAt = (phi: number) => rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi));
      const inRib = (phi: number) => {
        const q: Vec3 = [0.85 * t.a * Math.cos(phi), 0.85 * t.b * Math.sin(phi), zAt(phi)];
        return sdRib(q, rib, t, scene.spine);
      };
      // lateral (línea axilar media, 175°) y posterior (220°): hueso
      for (const deg of [175, 220]) {
        const r = inRib((deg * Math.PI) / 180);
        expect(r.d, `${i + 5}.ª a ${deg}°`).toBeLessThan(0);
        expect(r.cartilage, `${i + 5}.ª a ${deg}°`).toBe(false);
      }
      // anterior, a 30° de la línea media: cartílago donde la costilla llega
      const a = inRib((120 * Math.PI) / 180);
      if (0.85 * t.a * Math.cos((120 * Math.PI) / 180) <= ribAnteriorEndX(rib))
        expect(a.cartilage && a.d < 0, `${i + 5}.ª a 120°`).toBe(true);
      else expect(a.d, `${i + 5}.ª a 120°: más allá del reborde`).toBe(1e3);
    }
    // la 10.ª, cuyo extremo cae en la línea medioclavicular, conserva su cartílago corto antes del extremo
    const r10 = ribs[5];
    const phiEnd = Math.acos(Math.max(-1, (ribAnteriorEndX(r10) - 5) / (0.85 * t.a)));
    const qEnd: Vec3 = [
      0.85 * t.a * Math.cos(phiEnd),
      0.85 * t.b * Math.sin(phiEnd),
      r10.zAnterior + r10.tilt * (0.5 - 0.5 * Math.sin(phiEnd)),
    ];
    expect(sdRib(qEnd, r10, t, scene.spine).d).toBeLessThan(0);
    expect(sdRib(qEnd, r10, t, scene.spine).cartilage).toBe(true);
    // gemelo GLSL: la misma regla del cartílago y el mismo extremo anterior
    // La regla de extremo ya se comprueba arriba en el clasificador y por la equivalencia TS/GPU.
    expect(ANATOMY_GLSL).toContain('float endX = ribEndData(k).x;');
    expect(ribs.every((r) => r.cartilageFromPhi === Math.PI / 4)).toBe(true);
  });

  it('la grasa subcutánea no corta las costillas y la búsqueda de costillas empieza donde una puede llegar', () => {
    // antes la grasa se clasificaba antes que las costillas: su cresta, donde asoma en la grasa (el arco
    // anterior, y con la fascia ondulada también el lateral), quedaba cortada por la grasa
    let inFat = 0;
    for (const rib of scene.ribs)
      for (let phiDeg = 95; phiDeg <= 250; phiDeg += 2.5)
        for (let dz = -rib.halfWidth; dz <= rib.halfWidth; dz += 0.5)
          for (let d = t.skinMm; d < 34; d += 0.25) {
            const phi = (phiDeg * Math.PI) / 180;
            const z = rib.zAnterior + rib.tilt * (0.5 - 0.5 * Math.sin(phi)) + dz;
            const p = at(phi, z, d);
            if (sdRib(p, rib, t, scene.spine).d > -0.05) continue;
            const c = cls(p);
            expect([Tissue.Bone, Tissue.Cartilage], `${phiDeg}°, z ${z.toFixed(1)}, ${d} mm: ${Tissue[c.tissue]}`).toContain(c.tissue);
            if (d < wallDepths(t, wallArc(p, t), z).fascia) inFat++;
          }
    expect(inFat).toBeGreaterThan(50);
    // conservadora: ningún punto más somero que ribSearchDepth está dentro de una costilla
    const depth0 = ribSearchDepth(t, scene.ribs[0].scale);
    expect(depth0).toBeGreaterThan(t.skinMm);
    for (let phiDeg = 90; phiDeg <= 270; phiDeg += 1)
      for (let z = -120; z <= 90; z += 1)
        for (let d = 0; d < depth0; d += 0.5)
          for (const rib of scene.ribs) expect(sdRib(at((phiDeg * Math.PI) / 180, z, d), rib, t, scene.spine).d).toBeGreaterThan(0);
  });

  it('faceGradient de las caras de la pared: la normal de la piel inclinada por el relieve de la capa y |∇| bajo la cota', () => {
    let checked = 0;
    // la piel no ondula: su normal es la de la piel y |∇| ≤ 1,1 (la métrica radial de las capas)
    const skin = scene.faceGradient(at(FLANK, -14, 2.1), BASELINE_CALIBER)!;
    const n0 = torsoNormal(at(FLANK, -14, 2.1), t);
    expect(Math.abs(skin.normal[0] * n0[0] + skin.normal[1] * n0[1] + skin.normal[2] * n0[2])).toBeGreaterThan(0.99);
    expect(skin.norm).toBeGreaterThan(0.99);
    expect(skin.norm).toBeLessThan(1.1);
    // las caras internas (decisión 88): el gradiente con la pendiente de la capa (`wallFaceGradient`, tres evaluaciones,
    // el de `faceGradient` y el de la copia de la serie) es el de la distancia de la capa por diferencias centrales
    // (seis), en dirección y en norma
    for (const face of [Interface.Scarpa, Interface.DeepFascia, Interface.ObliquePlane, Interface.TransversusPlane])
      for (const z of [-40, -14, 12]) {
        const u = wallArc(at(FLANK, z, 0), t);
        const m = at(FLANK, z, wallFaceDepth(u, z, face, t) + 0.1);
        if (cls(m).interface !== face) continue;
        const g = scene.faceGradient(m, BASELINE_CALIBER)!;
        const h = 1e-3;
        const a = [0, 1, 2].map((k) => {
          const p: Vec3 = [...m];
          const q: Vec3 = [...m];
          p[k] += h;
          q[k] -= h;
          return (wallFaceSd(p, face, t) - wallFaceSd(q, face, t)) / (2 * h);
        }) as Vec3;
        const la = Math.hypot(...a);
        const tag = `${Interface[face]} z ${z}`;
        expect(Math.abs(g.normal[0] * a[0] + g.normal[1] * a[1] + g.normal[2] * a[2]) / la, tag).toBeGreaterThan(0.999);
        expect(Math.abs(g.norm / la - 1), tag).toBeLessThan(0.01);
        expect(g.norm).toBeLessThan(IFACE_GRADIENT_MAX);
        checked++;
      }
    expect(checked).toBeGreaterThanOrEqual(8);
    // las caras de pared y de costilla no tienen geometría de faceSdf (se tratan aparte)
    for (const f of [...WALL_FACES, Interface.RibCortex, Interface.Perichondrium]) expect(faceGeometryOf(f)).toBeNull();
  });
});

describe('costillas (decisión 88)', () => {
  it('cada costilla con su sección, aplanada y en los rangos anatómicos; el hueso no tiene moteado propio', () => {
    const sections = scene.ribs.map((r) => `${r.halfWidth}/${r.halfThickness}`);
    expect(new Set(sections).size).toBe(scene.ribs.length);
    for (const r of scene.ribs) {
      // altura de 10–15 mm, espesor de 5–7 mm: más alta que gruesa
      expect(2 * r.halfWidth).toBeGreaterThanOrEqual(9.5);
      expect(2 * r.halfWidth).toBeLessThanOrEqual(15);
      expect(2 * r.halfThickness).toBeGreaterThanOrEqual(5);
      expect(2 * r.halfThickness).toBeLessThanOrEqual(7.2);
      expect(r.halfWidth).toBeGreaterThan(r.halfThickness);
      // la búsqueda de costillas sigue siendo conservadora con la más gruesa (≤ 4,2 mm en la métrica radial)
      expect(r.halfThickness / r.scale).toBeLessThan(WALL.ribSearchMarginMm / 1.9);
    }
    // el eco de una costilla es su cortical (la cara del tejido blando de delante); el hueso no dibuja moteado
    expect(TISSUES[Tissue.Bone].backscatter).toBe(0);
    // la vértebra, sin cara de cortical, conserva la banda de su superficie
    expect(TISSUES[Tissue.Vertebra].backscatter).toBeGreaterThan(0);
  });
});

describe('relieve de las capas de la pared (decisión 88)', () => {
  /** Inclinación (°) de la cara `face` sobre la piel y |∇| de su distancia en (φ, z), con el gradiente numérico. */
  const tilt = (sc: AnatomyScene, face: Interface, phi: number, z: number): [number, number] => {
    const tt = sc.torso;
    const skin = torsoSkinPoint(phi, z, tt);
    const n = torsoNormal(skin, tt);
    const d = wallFaceDepth(wallArc(skin, tt), z, face, tt);
    const m: Vec3 = [skin[0] - n[0] * d, skin[1] - n[1] * d, z];
    const h = 0.02;
    const g = [0, 1, 2].map((k) => {
      const a: Vec3 = [...m];
      const b: Vec3 = [...m];
      a[k] += h;
      b[k] -= h;
      return (wallFaceSd(a, face, tt) - wallFaceSd(b, face, tt)) / (2 * h);
    });
    const gn = Math.hypot(...g);
    return [(Math.acos(Math.min(1, Math.abs(g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / gn)) * 180) / Math.PI, gn];
  };
  const inner = [Interface.Scarpa, Interface.DeepFascia, Interface.ObliquePlane, Interface.TransversusPlane];

  it('las caras internas se inclinan sobre la piel 6–9° de mediana (≤ 23° en el 1 % más inclinado) y |∇| queda bajo la cota de la salida barata en todos los casos', () => {
    for (const c of CASES) {
      const sc = new AnatomyScene(c);
      for (const face of [...inner, Interface.Transversalis]) {
        const ang: number[] = [];
        let maxNorm = 0;
        for (let phiDeg = 0; phiDeg < 360; phiDeg += 2.5)
          for (let z = -150; z <= 100; z += 2.5) {
            const [a, gn] = tilt(sc, face, (phiDeg * Math.PI) / 180, z);
            ang.push(a);
            maxNorm = Math.max(maxNorm, gn);
          }
        ang.sort((x, y) => x - y);
        const msg = `${c.id} ${Interface[face]}`;
        expect(maxNorm, msg).toBeLessThan(IFACE_GRADIENT_MAX);
        if (face === Interface.Transversalis) continue;
        expect(ang[ang.length >> 1], msg).toBeGreaterThan(5);
        expect(ang[ang.length >> 1], msg).toBeLessThan(11);
        expect(ang[Math.floor(ang.length * 0.99)], msg).toBeLessThan(28);
      }
    }
  });

  it('no son curvas de nivel: a lo largo del flanco la fascia sube y baja ≥ 2 mm y la separación entre caras vecinas cambia', () => {
    const u0 = wallArc(at(FLANK, 0, 0), t);
    for (const z of [-40, -8, 20]) {
      const fascia: number[] = [];
      const gap: number[] = [];
      for (let du = -30; du <= 30; du += 1) {
        const w = wallDepths(t, u0 + du, z);
        fascia.push(w.fascia);
        gap.push(wallPlaneDepth(u0 + du, z, 0, t, w) - w.fascia);
        // la piel y el peritoneo no ondulan: el espesor de la pared no cambia
        expect(w.skin).toBe(t.skinMm);
        expect(w.peritoneum).toBe(t.skinMm + t.fatMm + t.muscleMm);
      }
      expect(Math.max(...fascia) - Math.min(...fascia), `z ${z}`).toBeGreaterThan(2);
      const mean = gap.reduce((a, b) => a + b, 0) / gap.length;
      const sd = Math.sqrt(gap.reduce((a, b) => a + (b - mean) ** 2, 0) / gap.length);
      expect(sd / mean, `z ${z}`).toBeGreaterThan(0.1);
    }
  });

  it('el relieve lento de la grasa tiene un tope: ±11 % hasta 18 mm de grasa, ±2 mm con más (|∇| acotado)', () => {
    const u0 = wallArc(at(FLANK, 0, 0), t);
    for (const fat of [14, 18, 30]) {
      const th = { ...t, fatMm: fat };
      let mx = 0;
      for (let du = -300; du <= 300; du += 0.5)
        for (const z of [-60, -20, 20]) mx = Math.max(mx, Math.abs(wallFatMm(th, u0 + du, z) - fat));
      const cap = Math.min(WALL.fatSwell * fat, WALL.fatSwellMaxMm);
      expect(mx, `${fat} mm`).toBeLessThanOrEqual(cap + 1e-9);
      expect(mx, `${fat} mm`).toBeGreaterThan(0.7 * cap);
    }
  });

  it('dos planos a menos de planeMinMm se funden: el profundo deja de dibujar su cara', () => {
    // con el adulto de referencia los planos no bajan de ~1,6 mm; con un músculo fino el reparto los junta a tramos
    const thin = { ...t, muscleMm: 5.5 };
    const u0 = wallArc(at(FLANK, 0, 0), t);
    let fused = 0;
    let apart = 0;
    for (let du = -100; du <= 100; du += 0.5)
      for (const z of [-60, -20, 20]) {
        const w = wallDepths(thin, u0 + du, z);
        const p0 = wallPlaneDepth(u0 + du, z, 0, thin, w);
        const p1 = wallPlaneDepth(u0 + du, z, 1, thin, w);
        if (wallPlaneGap(p0, 0, w) < WALL.planeMinMm || wallPlaneGap(p1, 1, w) < WALL.planeMinMm) continue;
        const [face] = wallFace(p1, u0 + du, z, 1e3, thin);
        if (p1 - p0 < WALL.planeMinMm) {
          fused++;
          expect(face).not.toBe(Interface.TransversusPlane);
        } else if (Math.abs(p1 - p0) > 2) {
          apart++;
          expect(face).toBe(Interface.TransversusPlane);
        }
      }
    expect(fused).toBeGreaterThan(10);
    expect(apart).toBeGreaterThan(10);
  });

  it('las derivadas del relieve: ∇u analítico y la pendiente de cada cara, como las numéricas', () => {
    for (const p of [at(FLANK, -14, 5), at(Math.PI * 0.56, -20, 12), at(Math.PI * 0.88, 8, 27), at(Math.PI * 1.3, 30, 20)] as Vec3[]) {
      const g = wallArcGradient(p, t);
      const h = 1e-4;
      for (let k = 0; k < 2; k++) {
        const a: Vec3 = [...p];
        const b: Vec3 = [...p];
        a[k] += h;
        b[k] -= h;
        expect(g[k]).toBeCloseTo((wallArc(a, t) - wallArc(b, t)) / (2 * h), 5);
      }
      expect(g[2]).toBe(0);
      const u = wallArc(p, t);
      for (const face of inner) {
        const [fu, fz] = wallFaceSlope(u, p[2], face, t);
        const k = 1e-3;
        expect(fu).toBeCloseTo((wallFaceDepth(u + k, p[2], face, t) - wallFaceDepth(u - k, p[2], face, t)) / (2 * k), 1);
        expect(fz).toBeCloseTo((wallFaceDepth(u, p[2] + k, face, t) - wallFaceDepth(u, p[2] - k, face, t)) / (2 * k), 1);
      }
    }
  });

  it('la GLSL: un relieve por cara con los términos de la tabla, la fascia con el espesor de grasa del relieve lento', () => {
    for (let k = 0; k < 5; k++) expect(WALL_GLSL).toContain(`float wallWave${k}(float u, float z, float iP) { return `);
    for (let k = 0; k < 4; k++) expect(WALL_GLSL).toContain(`float wallSwell${k}(float u, float z, float iP) { return `);
    // cada término, con su armónico entero del perímetro (sin costura; el mismo en TS y en GLSL, sin redondeo en la GPU)
    // o sin componente en u
    for (const terms of [...WALL_WAVE_TERMS, ...WALL_SWELL_TERMS])
      for (const r of terms) {
        expect(Number.isInteger(r.harmonic)).toBe(true);
        expect(WALL_GLSL).toContain(`${r.kz.toFixed(6)} * z + ${r.phase.toFixed(6)})`);
        if (r.harmonic !== 0) expect(WALL_GLSL).toContain(`${r.harmonic.toFixed(1)} * iP * u + `);
      }
    expect(WALL_GLSL).toContain('float fat = uWall.y + min(WALL_FAT_SWELL * uWall.y, WALL_FAT_SWELL_MAX_MM) * wallSwell3(u, z, iP);');
    expect(WALL_GLSL).toContain(`#define WALL_FAT_SWELL ${WALL.fatSwell.toFixed(4)}`);
    expect(WALL_GLSL).toContain(`#define WALL_FAT_SWELL_MAX_MM ${WALL.fatSwellMaxMm.toFixed(4)}`);
    // la longitud de onda a lo largo de u de cada término, P/|n|: de 6,8 a 168 mm, ninguna de media vuelta o más
    const P = wallPerimeter(t);
    const lambdasU = WALL_WAVE_TERMS.flat()
      .concat(WALL_SWELL_TERMS.flat())
      .filter((r) => r.harmonic !== 0)
      .map((r) => P / Math.abs(r.harmonic));
    expect(Math.min(...lambdasU)).toBeGreaterThan(6);
    expect(Math.max(...lambdasU)).toBeLessThan(P / 2);
  });
});

describe('caras nuevas en la tabla de la decisión 57', () => {
  it('cada cara de la pared y de la costilla tiene su fila, su nombre GLSL, su fuente y un solo tipo de dueño', () => {
    // tras la pleura parietal de la decisión 61 (12): nueve caras de la pared y las costillas, 13–21; después, el pericardio
    // (decisión 85)
    expect(INTERFACE_COUNT).toBe(25); // dos interfaces intestinales, sin cambiar las caras de pared
    expect(Interface.SkinFat).toBe(Interface.PleuraWall + 1);
    expect(Object.keys(INTERFACES)).toHaveLength(INTERFACE_COUNT);
    for (const f of [...WALL_FACES, Interface.RibCortex, Interface.Perichondrium]) {
      expect(INTERFACE_SOURCES[f].length, Interface[f]).toBeGreaterThan(20);
      expect(interfaceReflectivity(f), Interface[f]).toBeGreaterThan(0.02);
      expect(ANATOMY_GLSL, Interface[f]).toContain(`#define ${INTERFACE_GLSL_NAME[f]} ${f}`);
    }
    for (const f of WALL_FACES) expect(isWallLayerInterface(f)).toBe(true);
    expect(FIRST_WALL_INTERFACE).toBe(Interface.SkinFat);
    expect(LAST_WALL_INTERFACE).toBe(Interface.Peritoneum);
    // de un lado: el peritoneo (la grasa preperitoneal), la cortical (el tejido blando de fuera), el pericondrio
    for (const f of [Interface.Peritoneum, Interface.RibCortex, Interface.Perichondrium]) expect(INTERFACES[f].twoSided).toBe(false);
    for (const f of WALL_FACES.filter((x) => x !== Interface.Peritoneum)) expect(INTERFACES[f].twoSided).toBe(true);
    // Fresnel de los tejidos: dermis/grasa 0,146, fascia grasa/músculo 0,138, hueso 0,59
    expect(interfaceReflectivity(Interface.SkinFat)).toBeCloseTo(0.146, 2);
    expect(interfaceReflectivity(Interface.DeepFascia)).toBeCloseTo(0.138, 2);
    expect(interfaceReflectivity(Interface.RibCortex)).toBeCloseTo(0.59, 2);
    // la coherencia de curvatura: tubos y costillas
    expect(hasCurvatureCoherence(Interface.RibCortex)).toBe(true);
    expect(hasCurvatureCoherence(Interface.Perichondrium)).toBe(true);
    expect(hasCurvatureCoherence(Interface.DeepFascia)).toBe(false);
    expect(isRibInterface(Interface.RibCortex)).toBe(true);
  });
});

describe('cortical costal: solo la cara que mira a la sonda (decisión 62)', () => {
  // Capturas con GPU (25-09-2026): cada costilla del flanco dibujaba un anillo entero (la cara anterior y la
  // posterior). La cara posterior está a la sombra del hueso: su normal exterior apunta lejos de la sonda y solo se
  // la alcanza a través del hueso; la transmisión con apertura (penumbra, decisión 54) y los caminos dirigidos (58)
  // la iluminaban a medias en los bordes de la costilla, y el eco (con |cosθ|) la dibujaba como a la anterior. Con
  // SwiftShader, el flanco con y sin la regla: sin ella, los anillos inferiores; con ella, solo el arco anterior.
  it('la cara posterior no da eco (en la mirada 0 ni en las dirigidas); sin la regla, casi tanto como la anterior', () => {
    const sp = START_POINTS.find((p) => p.id === 'flank')!;
    const fr = probeFrame({ phi: sp.phi, z: sp.z, lift: 0, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: sp.tilt ?? 0 }, t, CONVEX_C35);
    const k0 = (2 * Math.PI) / (1540 / (CONVEX_C35_PROFILE.bEffectiveMHz * 1000));
    const R = CONVEX_C35.curvatureRadius;
    const L = CONVEX_C35.lines;
    const th = (u: number) => -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * (u + 0.5)) / L;
    let front = 0;
    let backUnlit = 0;
    let backLit = 0;
    let backSamples = 0;
    for (const theta of [0, (7 * Math.PI) / 180, (-7 * Math.PI) / 180])
      for (let u = 0; u < L; u += 2)
        for (let r = 12; r < 45; r += 0.05) {
          const m = pointOnLine(fr, CONVEX_C35, th(u), r);
          const c = cls(m);
          if (c.interface !== Interface.RibCortex) continue;
          // el camino de la mirada θ que pasa por la muestra (su dirección, `steeredSample`)
          const dir = lineDirection(fr, th(u) + Math.asin((R * Math.sin(theta)) / (R + r)));
          const fg = scene.faceGradient(m, BASELINE_CALIBER)!;
          const dot = fg.normal[0] * dir[0] + fg.normal[1] * dir[1] + fg.normal[2] * dir[2];
          const cosI = Math.abs(dot);
          const e = interfaceEchoField(c.interface, cosI, 1, faceDelta(c.interfaceDistance, fg.norm, cosI), k0);
          if (dot <= 0) front = Math.max(front, e);
          else {
            backSamples++;
            backUnlit = Math.max(backUnlit, e);
            if (faceLitFromProbe(c.interface, fg.normal, dir)) backLit = Math.max(backLit, e);
          }
        }
    expect(backSamples).toBeGreaterThan(100);
    expect(front).toBeGreaterThan(0);
    // el eco de la cara posterior con |cosθ| (sin la regla) llega a menos de 3 dB del de la anterior
    expect(20 * Math.log10(backUnlit / front)).toBeGreaterThan(-3);
    // con la regla, nada (≥ 30 dB bajo la anterior, sea cual sea la transmisión)
    expect(backLit).toBe(0);
    // gemelo GLSL de la regla, en el eco de interfaz de los dos programas de B
    expect(INTERFACE_ECHO_GLSL).toContain('if (c.iface == IF_RIB && dot(fg.xyz, dir) > 0.0) return vec2(0.0);');
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) expect(src).toContain(INTERFACE_ECHO_GLSL);
    // el cartílago transmite: su cara profunda sí se ve
    expect(faceLitFromProbe(Interface.Perichondrium, [0, 0, 1], [0, 0, 1])).toBe(true);
    expect(faceLitFromProbe(Interface.RibCortex, [0, 0, 1], [0, 0, 1])).toBe(false);
    expect(faceLitFromProbe(Interface.RibCortex, [0, 0, -1], [0, 0, 1])).toBe(true);
  });
});

describe('eco de cara plana de las copias de la pared (serie de la pleura, decisión 61)', () => {
  it('el gradiente analítico de la profundidad radial es el numérico', () => {
    for (const p of [at(FLANK, -14, 5), at(Math.PI * 0.56, -20, 12), at(Math.PI * 0.88, 8, 27), at(Math.PI * 1.3, 30, 20)] as Vec3[]) {
      const g = torsoDepthGradient(p, t);
      const h = 1e-4;
      for (let k = 0; k < 3; k++) {
        const a: Vec3 = [...p];
        const b: Vec3 = [...p];
        a[k] += h;
        b[k] -= h;
        expect(g[k]).toBeCloseTo((torsoDepth(a, t) - torsoDepth(b, t)) / (2 * h), 6);
      }
    }
  });

  it('wallFaceEchoFlat da el eco de interfaceEcho (con faceGradient) a ±1,5 dB por cara, sin relieve a ±0,05', () => {
    // la energía del eco de cada cruce de cara a lo largo de líneas normales y oblicuas (hasta 20°): el eco
    // completo, con la normal y la norma de la cara (las de la GPU fuera de bucles, con la pendiente de su capa), frente
    // al de cara plana (normal y norma de la profundidad radial), que va en el bucle de la serie. Con el relieve de la
    // decisión 88 las caras internas se inclinan 6–9° de mediana: ≤ 1,3 dB (antes ≤ 0,5)
    const K0 = (2 * Math.PI) / (1540 / 2500);
    const worst = new Map<Interface, number>();
    for (const [phi, z, tiltDeg] of [
      [Math.PI * 0.56, -20, 0],
      [FLANK, -14, 0],
      [FLANK, -14, 15],
      [Math.PI * 0.88, 8, 10],
      [Math.PI * 0.7, -30, 20],
    ] as const) {
      const skin = torsoSkinPoint(phi, z, t);
      const n = torsoNormal(skin, t);
      const tl = (tiltDeg * Math.PI) / 180;
      const dir: Vec3 = [-n[0] * Math.cos(tl), -n[1] * Math.cos(tl), Math.sin(tl)];
      const acc = new Map<Interface, { flat: number; full: number }>();
      for (let s = 0.01; s < 32; s += 0.01) {
        const m: Vec3 = [skin[0] + dir[0] * s, skin[1] + dir[1] * s, skin[2] + dir[2] * s];
        const c = cls(m);
        if (!isWallLayerInterface(c.interface)) continue;
        const fg = scene.faceGradient(m, BASELINE_CALIBER)!;
        const cosI = Math.abs(fg.normal[0] * dir[0] + fg.normal[1] * dir[1] + fg.normal[2] * dir[2]);
        const full = interfaceEchoField(
          c.interface,
          cosI,
          wallFaceGain(m, c.interface, t),
          faceDelta(c.interfaceDistance, fg.norm, cosI),
          K0,
        );
        const flat = wallFaceEchoFlat(c.interface, c.interfaceDistance, m, dir, t, K0);
        const e = acc.get(c.interface) ?? { flat: 0, full: 0 };
        acc.set(c.interface, { flat: e.flat + flat * flat, full: e.full + full * full });
      }
      for (const [f, e] of acc) if (e.full > 0) worst.set(f, Math.max(worst.get(f) ?? 0, Math.abs(10 * Math.log10(e.flat / e.full))));
    }
    // todas las caras vistas (el recto no tiene planos: los dan el flanco y las oblicuas)
    expect([...worst.keys()].sort()).toEqual([...WALL_FACES].sort());
    for (const [f, db] of worst) expect(db, Interface[f]).toBeLessThan(1.5);
    expect(worst.get(Interface.SkinFat)!).toBeLessThan(0.05);
    expect(worst.get(Interface.Peritoneum)!).toBeLessThan(0.05);
    // sin la cortical ni el pericondrio (cilindros: no son planos paralelos a la piel)
    for (const f of [Interface.RibCortex, Interface.Perichondrium, Interface.LiverCapsule])
      expect(wallFaceEchoFlat(f, 0.3, at(FLANK, -14, 10), [0, 1, 0], t, K0)).toBe(0);
  });

  it('la GLSL: el mismo gradiente y el eco de cara plana en la pared que copia la serie, sin faceGradient', () => {
    // la normal plana de la copia es la profundidad radial de la anatomía (torsoDepthGrad, que también usa el gradiente
    // de las caras con la pendiente de su capa, fuera de bucles)
    expect(WALL_GLSL).toContain('vec2 g = p.xy / r * (1.0 - 1.0 / rho) + r / (rho * rho * rho) * p.xy / (uTorso.xy * uTorso.xy);');
    expect(WALL_GLSL).toContain('return -(torsoDepthGrad(m) + sl.x * wallArcGradient(m) + vec3(0.0, 0.0, sl.y));');
    expect(WALL_FACE_ECHO_GLSL).toContain('vec3 g = warpNormal(w, torsoDepthGrad(m));');
    expect(WALL_FACE_ECHO_GLSL).toContain('return interfaceProfileEcho(c.iface, cosI, wallFaceGain(m, c.iface), c.ifd / (gl * cosI));');
    expect(WALL_FACE_ECHO_GLSL.replace(/\/\/.*$/gm, '')).not.toContain('faceGradient');
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(src).toContain(WALL_FACE_ECHO_GLSL);
      expect(src.indexOf(WALL_FACE_ECHO_GLSL)).toBeGreaterThan(src.indexOf(INTERFACE_ECHO_GLSL));
      expect(src).toContain('return field + vec2(WALL_COPY_FACE_GAIN * wallFaceEchoFlat(c, m, dir, w), 0.0);');
    }
  });
});

describe('gemelo GLSL (organs/wall.ts y wallTexture.ts)', () => {
  it('la anatomía incluye el módulo de la pared, con las constantes interpoladas', () => {
    expect(ORGAN_MODULES.map((o) => o.id)).toContain('wall');
    expect(ANATOMY_GLSL).toContain(WALL_GLSL);
    expect(WALL_GLSL).toContain(`#define WALL_SCARPA_FRACTION ${WALL.scarpaFraction.toFixed(4)}`);
    expect(WALL_GLSL).toContain(`#define WALL_RIB_PRIORITY_MM ${WALL.ribFacePriorityMm.toFixed(4)}`);
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    // classify: capas onduladas, la cortical de la costilla ósea más cercana y el pericondrio del cartílago
    expect(glsl).toContain('vec4 wd = wallDepths(u, m.z);');
    expect(glsl).toContain('if (!cart && rd < ribD) { ribD = rd; ribI = i; }');
    expect(glsl).toContain('if (cart) { c.iface = IF_PERICHONDRIUM; c.ifd = -rd;');
    expect(glsl).toContain('c.tissue = d < wd.y ? T_FAT : (d < wd.z ? T_MUSCLE : T_FAT);');
    // en classifyWall (el prefijo de la pared de classify, decisión 61): las costillas antes de la grasa
    // subcutánea donde una puede llegar (la grasa no las corta), y las coordenadas de la pared solo dentro de
    // ella (no en cada punto del tronco); con la muestra fuera de la pared, classifyWith sigue
    const cls = glsl.slice(glsl.indexOf('bool classifyWall(vec3 m, out Cls c, out float depth, out vec3 tn) {'));
    expect(glsl.indexOf('Cls classifyWith(vec3 m, bool withCurtain) {')).toBeGreaterThan(glsl.indexOf('bool classifyWall('));
    expect(cls).toContain('return true; } return false; }');
    const ribs = cls.indexOf('if (d >= ribSearchDepth()) {');
    const inWall = cls.indexOf('if (d < wall) { // coordenadas de la pared solo dentro de ella');
    expect(ribs).toBeGreaterThan(0);
    expect(inWall).toBeGreaterThan(ribs);
    expect(cls.indexOf('float u = wallArc(m);')).toBeGreaterThan(inWall);
    expect(cls.indexOf('vec4 wd = wallDepths(u, m.z);')).toBeGreaterThan(inWall);
    // faceGradient: la distancia de la capa y la de la costilla más cercana
    expect(glsl).toContain('} else if (c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL) {');
    expect(glsl).toContain('int k = nearestRib(m);');
  });

  it('la pasada B aplica la textura solo a la grasa y al músculo, y el eco de las caras de pared y costilla', () => {
    expect(FRAG_RAWFIELD).toContain(WALL_TEXTURE_GLSL);
    // la dirección del haz de la mirada 0 es la radial desde el centro de curvatura en el punto del MUNDO (con la
    // compresión de la sonda, decisión 63, m ya no es p en la pared) y la lámina va al mundo por la jacobiana
    expect(FRAG_RAWFIELD).toContain('if (tissue == T_FAT || tissue == T_MUSCLE) het *= wallTexture(m, tissue, dir, w);');
    expect(FRAG_RAWFIELD).toContain('vec2 f0 = fieldFor(m, se, c.tissue, normalize(p - uCurvC), w);');
    expect(FRAG_RAWFIELD_STEERED).toContain(
      'if (tissue == T_FAT || tissue == T_MUSCLE) het *= wallTexture(m, tissue, normalize(b0 + g / lookK2), w);',
    );
    expect(FRAG_RAWFIELD_STEERED).toContain('vec2 f0 = fieldForPh(m, se, c.tissue, ph0, g, normalize(p - uCurvC), w);');
    // la textura va antes del eco de interfaz (que usa wallFaceGain) en los dos programas
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) expect(src.indexOf('float wallFaceGain(')).toBeGreaterThan(0);
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED])
      expect(src.indexOf('float wallFaceGain(')).toBeLessThan(src.indexOf('vec2 interfaceEcho('));
    const echo = INTERFACE_ECHO_GLSL.replace(/\s+/g, ' ');
    expect(echo).toContain(
      'c.iface <= IF_LAST_TUBE || c.iface == IF_RIB || c.iface == IF_PERICHONDRIUM || c.iface == IF_BOWEL_LUMEN || c.iface == IF_BOWEL_SEROSA ? tubeCurvature(',
    );
    // la variación anclada de la pared multiplica la especular de la faceta y la difusa (decisión 65)
    expect(echo).toContain('float gain = c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL ? wallFaceGain(m, c.iface) : 1.0;');
    expect(FRAG_RAWFIELD).toContain(`uIface[${INTERFACE_COUNT}]`);
    // tablas del GLSL con el tamaño interpolado
    expect(WALL_TEXTURE_GLSL).toContain(`const float WT_FACE_VAR[${WALL_TEXTURE.faceVariation.length}]`);
    expect(WALL_TEXTURE.faceVariation.length).toBe(LAST_WALL_INTERFACE - FIRST_WALL_INTERFACE + 1);
    // los tejidos de la decisión 81 (psoas, cuadrado lumbar, grasa retroperitoneal) y de la 85 (miocardio y mediastino) van al
    // final: no mueven índices
    expect(TISSUE_COUNT).toBe(33); // grasa mesentérica añadida sin renumerar tejidos previos
  });
});

describe('textura de la pared (wallTexture.ts)', () => {
  const dirIn = (m: Vec3): Vec3 => {
    const n = torsoNormal(m, t);
    return [-n[0], -n[1], -n[2]];
  };

  it('vale 1 en cualquier tejido que no sea la grasa o el músculo de la pared (hígado, riñón y vasos no cambian)', () => {
    for (const tissue of [Tissue.Liver, Tissue.RenalCortex, Tissue.RenalSinus, Tissue.Blood, Tissue.Skin, Tissue.Bone, Tissue.PerirenalFat])
      for (let i = 0; i < 50; i++) {
        const m: Vec3 = [-150 + 3.7 * i, -60 + 2.3 * i, -90 + 1.9 * i];
        expect(wallTexture(m, tissue, [0, 1, 0], t)).toBe(1);
      }
    // y el eco solo cambia en las caras de la pared
    for (const f of [Interface.LiverCapsule, Interface.IvcLumen, Interface.RibCortex]) expect(wallFaceGain(at(FLANK, 0, 10), f, t)).toBe(1);
  });

  it('septos de la grasa: lóbulos de 5–10 mm a lo largo de la piel con techos casi paralelos a ella, finos y especulares', () => {
    let n = 0;
    let onSeptum = 0;
    let horizontal = 0;
    const runs: number[] = [];
    let run = 0;
    const z = -30;
    for (let u = -150; u < 150; u += 0.05) {
      // una línea a lo largo de la piel a 8 mm de hondo (grasa): tramos entre paredes de columna
      const phi = Math.PI / 2 - u / 135;
      const m = at(phi, z, 8.3);
      const s = fatSeptum(m, t);
      n++;
      if (s[3] > 0.5) {
        onSeptum++;
        const nn = torsoNormal(m, t);
        if (Math.abs(s[0] * nn[0] + s[1] * nn[1] + s[2] * nn[2]) > 0.9) horizontal++;
        if (run > 0) runs.push(run * 0.05);
        run = 0;
      } else run++;
    }
    // un septo cubre una fracción pequeña (0,2–0,5 mm de espesor): la grasa es sobre todo lóbulo
    expect(onSeptum / n).toBeGreaterThan(0.02);
    expect(onSeptum / n).toBeLessThan(0.3);
    // a lo largo de la piel, los tramos sin septo miden de media lo que un lóbulo (la línea cruza techos y paredes)
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(12);
    expect(horizontal).toBeGreaterThan(0);
    // especular: el mismo septo de frente brilla más que visto a 60°
    expect(wallOrientation([0, 0, 1], [0, 0, 1])).toBe(1);
    expect(wallOrientation([0, 0, 1], [Math.sin(1.05), 0, Math.cos(1.05)])).toBeLessThan(0.3);
  });

  it('estrías del músculo: cada ~2,2 mm en profundidad, casi paralelas a la piel y en tramos finitos', () => {
    const peaks: number[] = [];
    let covered = 0;
    let total = 0;
    for (let z = -80; z <= 20; z += 5) {
      let prev = 0;
      let rising = false;
      const u0 = wallArc(at(FLANK, z, 0), t);
      const w = wallDepths(t, u0, z);
      for (let d = w.fascia + 0.3; d < w.transversalis - 0.3; d += 0.02) {
        const s = muscleStriation(at(FLANK, z, d), t);
        const wv = s[3];
        if (wv < prev && rising && prev > 0.3) peaks.push(d);
        rising = wv > prev;
        prev = wv;
        total++;
        if (wv > 0.3) covered++;
      }
    }
    expect(peaks.length).toBeGreaterThan(10);
    // la máscara de tramos deja fuera parte de las estrías; las que hay ocupan una fracción pequeña del músculo
    expect(covered / total).toBeGreaterThan(0.02);
    expect(covered / total).toBeLessThan(0.3);
    // pendiente ≤ 15° (peniforme): la normal de la estría se aparta ≤ 15° de la de la piel
    for (let z = -60; z <= 20; z += 10) {
      const m = at(FLANK, z, t.skinMm + t.fatMm + 3);
      const s = muscleStriation(m, t);
      const n = torsoNormal(m, t);
      expect(Math.abs(s[0] * n[0] + s[1] * n[1] + s[2] * n[2])).toBeGreaterThan(Math.cos((15 * Math.PI) / 180));
    }
  });

  it('anclada: la textura en un punto material no depende de la sonda (solo del haz por su brillo especular)', () => {
    for (let i = 0; i < 200; i++) {
      const m = at(FLANK + 0.003 * i, -40 + 0.37 * i, 3 + ((i * 0.131) % 22));
      const c = cls(m);
      const g1 = wallTexture(m, c.tissue, dirIn(m), t);
      const g2 = wallTexture([...m] as Vec3, c.tissue, dirIn(m), t);
      expect(g2).toBe(g1);
    }
  });
});
