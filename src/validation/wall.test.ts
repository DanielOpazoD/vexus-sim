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
  preperitonealMm,
  ribSearchDepth,
  ribCurvature,
  ribTangent,
  wallArc,
  wallDepths,
  wallPerimeter,
  wallPlaneDepth,
  wallPlaneGap,
  wallWave,
} from '../anatomy/organs/wall';
import {
  RIB_ANTERIOR_END,
  ribAnteriorEndX,
  sdRib,
  torsoDepth,
  torsoDepthGradient,
  torsoNormal,
  torsoSkinPoint,
} from '../anatomy/primitives';
import { AnatomyScene, BASELINE_CALIBER, faceGeometryOf } from '../anatomy/scene';
import { TISSUE_COUNT, Tissue } from '../anatomy/tissues';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import {
  IFACE_GRADIENT_MAX,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  INTERFACE_ECHO_GLSL,
  faceDelta,
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
    expect(Array.from(uWall.value(scene, { sample: null as never, tubeCount: 0 }))).toEqual([
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
      for (const z of [-80, 0, 35]) expect(Math.abs(wallWave(P / 2, z, k, t) - wallWave(-P / 2, z, k, t))).toBeLessThan(1e-9);
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
    // gemelo GLSL: la misma regla del cartílago y el mismo extremo anterior
    expect(ANATOMY_GLSL).toContain('cartilage = abs(phi - 1.5707963) < 1.5707963 - uRibParams.y;');
    expect(ANATOMY_GLSL).toContain(
      `if (p.x > min(${RIB_ANTERIOR_END.xMm.toFixed(4)}, ${RIB_ANTERIOR_END.xMm.toFixed(4)} + ${RIB_ANTERIOR_END.marginSlope.toFixed(4)} * rib.x)) return 1e3;`,
    );
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

  it('faceGradient de las caras de la pared: la normal de la piel y |∇| ≤ 1,1 (la métrica radial de las capas)', () => {
    for (const d of [2.1, t.skinMm + t.fatMm - 0.2]) {
      const m = at(FLANK, -14, d);
      const g = scene.faceGradient(m, BASELINE_CALIBER)!;
      const n = torsoNormal(m, t);
      expect(Math.abs(g.normal[0] * n[0] + g.normal[1] * n[1] + g.normal[2] * n[2])).toBeGreaterThan(0.99);
      expect(g.norm).toBeGreaterThan(0.99);
      expect(g.norm).toBeLessThan(1.1);
    }
    // las caras de pared y de costilla no tienen geometría de faceSdf (se tratan aparte)
    for (const f of [...WALL_FACES, Interface.RibCortex, Interface.Perichondrium]) expect(faceGeometryOf(f)).toBeNull();
  });
});

describe('caras nuevas en la tabla de la decisión 57', () => {
  it('cada cara de la pared y de la costilla tiene su fila, su nombre GLSL, su fuente y un solo tipo de dueño', () => {
    // tras la pleura parietal de la decisión 61 (12): nueve caras de la pared y las costillas, 13–21
    expect(INTERFACE_COUNT).toBe(22);
    expect(Interface.SkinFat).toBe(Interface.PleuraWall + 1);
    expect(Object.keys(INTERFACES)).toHaveLength(INTERFACE_COUNT);
    for (const f of [...WALL_FACES, Interface.RibCortex, Interface.Perichondrium]) {
      const p = INTERFACES[f];
      expect(p.source.length, Interface[f]).toBeGreaterThan(20);
      expect(interfaceReflectivity(f), Interface[f]).toBeGreaterThan(0.05);
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

  it('wallFaceEchoFlat da el eco de interfaceEcho (con faceGradient) a ±0,5 dB por cara, sin la ondulación a ±0,05', () => {
    // la energía del eco de cada cruce de cara a lo largo de líneas normales y oblicuas (hasta 20°): el eco
    // completo, con la normal y la norma numéricas de la cara (las de la GPU fuera de bucles), frente al de
    // cara plana (normal y norma de la profundidad radial), que va en el bucle de la serie
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
    for (const [f, db] of worst) expect(db, Interface[f]).toBeLessThan(0.5);
    expect(worst.get(Interface.SkinFat)!).toBeLessThan(0.05);
    expect(worst.get(Interface.Peritoneum)!).toBeLessThan(0.05);
    // sin la cortical ni el pericondrio (cilindros: no son planos paralelos a la piel)
    for (const f of [Interface.RibCortex, Interface.Perichondrium, Interface.LiverCapsule])
      expect(wallFaceEchoFlat(f, 0.3, at(FLANK, -14, 10), [0, 1, 0], t, K0)).toBe(0);
  });

  it('la GLSL: el mismo gradiente y el eco de cara plana en la pared que copia la serie, sin faceGradient', () => {
    expect(WALL_FACE_ECHO_GLSL).toContain(
      'vec2 g = p.xy / r * (1.0 - 1.0 / rho) + r / (rho * rho * rho) * p.xy / (uTorso.xy * uTorso.xy);',
    );
    expect(WALL_FACE_ECHO_GLSL).toContain('return interfaceProfileEcho(c.iface, cosI, wallFaceGain(m, c.iface), c.ifd / (gl * cosI));');
    expect(WALL_FACE_ECHO_GLSL.replace(/\/\/.*$/gm, '')).not.toContain('faceGradient');
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED]) {
      expect(src).toContain(WALL_FACE_ECHO_GLSL);
      expect(src.indexOf(WALL_FACE_ECHO_GLSL)).toBeGreaterThan(src.indexOf(INTERFACE_ECHO_GLSL));
      expect(src).toContain('return field + vec2(WALL_COPY_FACE_GAIN * wallFaceEchoFlat(c, m, dir), 0.0);');
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
    expect(FRAG_RAWFIELD).toContain('if (tissue == T_FAT || tissue == T_MUSCLE) het *= wallTexture(m, tissue, normalize(m - uCurvC));');
    expect(FRAG_RAWFIELD_STEERED).toContain(
      'if (tissue == T_FAT || tissue == T_MUSCLE) het *= wallTexture(m, tissue, normalize(normalize(m - uCurvC) + g / uSteer.w));',
    );
    // la textura va antes del eco de interfaz (que usa wallFaceGain) en los dos programas
    for (const src of [FRAG_RAWFIELD, FRAG_RAWFIELD_STEERED])
      expect(src.indexOf('float wallFaceGain(')).toBeLessThan(src.indexOf('float interfaceEcho('));
    const echo = INTERFACE_ECHO_GLSL.replace(/\s+/g, ' ');
    expect(echo).toContain('c.iface <= IF_LAST_TUBE || c.iface == IF_RIB || c.iface == IF_PERICHONDRIUM ? tubeCurvature(');
    expect(echo).toContain('if (c.iface >= IF_FIRST_WALL && c.iface <= IF_LAST_WALL) curv *= wallFaceGain(m, c.iface);');
    expect(FRAG_RAWFIELD).toContain(`uIface[${INTERFACE_COUNT}]`);
    // tablas del GLSL con el tamaño interpolado
    expect(WALL_TEXTURE_GLSL).toContain(`const float WT_FACE_VAR[${WALL_TEXTURE.faceVariation.length}]`);
    expect(WALL_TEXTURE.faceVariation.length).toBe(LAST_WALL_INTERFACE - FIRST_WALL_INTERFACE + 1);
    expect(TISSUE_COUNT).toBe(27);
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
