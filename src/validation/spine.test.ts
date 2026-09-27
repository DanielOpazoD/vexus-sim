import { describe, expect, it } from 'vitest';
import { uncompress } from '../anatomy/compression';
import { ANATOMY_GLSL } from '../anatomy/gpu/anatomy.glsl';
import {
  INTERFACES,
  INTERFACE_GLSL_NAME,
  Interface,
  SPINE_FACE_MM,
  hasCurvatureCoherence,
  interfaceReflectivity,
  isBoneCortex,
} from '../anatomy/interfaces';
import {
  SPINE_SHAPE,
  sdSpine,
  sdSpineDisc,
  spineArchSd,
  spineBodySd,
  spineDistances,
  spineEllipseSd,
  spineFaceCurvature,
  spineSlabSd,
} from '../anatomy/primitives';
import { AnatomyScene, BASELINE_CALIBER } from '../anatomy/scene';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { START_POINTS } from '../app/startPoints';
import { NORMAL_ADULT } from '../cases';
import type { Vec3 } from '../core/vec3';
import { probeContact } from '../probe/contact';
import { CONVEX_C35, lineDirection, pointOnLine, type ProbePose } from '../probe/probe';
import {
  IFACE_GRADIENT_MAX,
  IFACE_REACH_MM,
  IFACE_SHIFT_MM,
  INTERFACE_ECHO_GLSL,
  boneDiffuseWindow,
  faceDelta,
  faceLitFromProbe,
  interfaceEchoField,
} from '../ultrasound/interfaceEcho';
import { CONVEX_C35_PROFILE } from '../ultrasound/transducerProfile';

/**
 * Columna con cortical y discos (decisión 92). La ronda 5 del juez ciego vio en la subxifoidea, bajo y a la derecha de la
 * VCI, «un arco liso contra una zona negra, sin eco de interfaz ni espejo». No era pulmón: era la sombra del cuerpo
 * vertebral, un cilindro de 34 mm sin cortical (`vertebra-no-cortex`), que el haz tocaba a 44–50° y cuyo borde solo
 * dibujaba la banda de su propio moteado. Estas pruebas fallan con la columna de antes.
 */
const scene = new AnatomyScene(NORMAL_ADULT);
const sp = scene.spine;
const cls = (m: Vec3) => scene.classify(m, BASELINE_CALIBER);
const k0 = (2 * Math.PI) / (1540 / (CONVEX_C35_PROFILE.bEffectiveMHz * 1000));
const deg = (rad: number) => (rad * 180) / Math.PI;

describe('columna: cuerpos elípticos con discos (decisión 92)', () => {
  it('cuerpo de 40 × 29 mm, la misma área que el círculo de radio r (el peso respiratorio no cambia), cuerpos de 24 mm y discos de 7', () => {
    const { levelMm, bodyMm, z0Mm } = SPINE_SHAPE;
    // ancho y fondo del cuerpo en el centro de uno (z0: el plano de la transversa epigástrica lo corta por la mitad)
    let xMin = 0;
    let xMax = 0;
    for (let x = -30; x <= 30; x += 0.01)
      if (spineBodySd([sp.x0 + x, sp.y0, z0Mm], sp) < 0) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
      }
    let yMin = 0;
    let yMax = 0;
    for (let y = -30; y <= 30; y += 0.01)
      if (spineBodySd([sp.x0, sp.y0 + y, z0Mm], sp) < 0) {
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    const width = xMax - xMin;
    const depth = yMax - yMin;
    // Panjabi 1991/1992: platillos de T11–L1 de 37–42 mm de ancho y 29–33 de fondo; antes, un círculo de 34 × 34
    expect(width).toBeGreaterThan(37);
    expect(width).toBeLessThan(42);
    expect(depth).toBeGreaterThan(28.5);
    expect(depth).toBeLessThan(33);
    expect(width / depth).toBeGreaterThan(1.25);
    expect((Math.PI * width * depth) / 4).toBeCloseTo(Math.PI * sp.r * sp.r, -1);
    // el plano de la transversa epigástrica (z −20) corta un cuerpo por la mitad
    const epigastric = START_POINTS.find((s) => s.id === 'epigastric')!;
    expect(spineSlabSd(epigastric.z)).toBeCloseTo(-bodyMm / 2, 6);
    // a lo largo del eje: cuerpos de hueso de bodyMm y discos de cartílago de levelMm − bodyMm, de 22–25 y 5–8 mm
    const runs: { tissue: Tissue; len: number }[] = [];
    for (let z = z0Mm - 2 * levelMm; z <= z0Mm + 2 * levelMm; z += 0.05) {
      const t = cls([sp.x0, sp.y0, z]).tissue;
      if (runs.length && runs[runs.length - 1].tissue === t) runs[runs.length - 1].len += 0.05;
      else runs.push({ tissue: t, len: 0.05 });
    }
    const inner = runs.slice(1, -1);
    expect(inner.map((r) => r.tissue)).toEqual([
      Tissue.Cartilage,
      Tissue.Vertebra,
      Tissue.Cartilage,
      Tissue.Vertebra,
      Tissue.Cartilage,
      Tissue.Vertebra,
      Tissue.Cartilage,
    ]);
    for (const r of inner) {
      const [lo, hi] = r.tissue === Tissue.Vertebra ? [22, 25] : [5, 8];
      expect(r.len, JSON.stringify(r)).toBeGreaterThan(lo);
      expect(r.len, JSON.stringify(r)).toBeLessThan(hi);
    }
    // cuerpos y discos llenan el cilindro, también junto al borde redondeado del platillo (con el corte recto del disco quedaba
    // un surco de hasta 0,375 mm con el tejido vecino: pulmón junto a T11–T12)
    const a = sp.r * SPINE_SHAPE.aspect;
    const b = sp.r / SPINE_SHAPE.aspect;
    let rim = 0;
    for (let k = -3; k <= 3; k++)
      for (const edge of [-1, 1])
        for (let dz = -1.5; dz <= 1.5; dz += 0.1)
          for (let t = 0; t < 2 * Math.PI; t += 0.1)
            for (const f of [0.97, 0.99, 0.999]) {
              const m: Vec3 = [sp.x0 + f * a * Math.cos(t), sp.y0 + f * b * Math.sin(t), z0Mm + k * levelMm + edge * (bodyMm / 2) + dz];
              if (spineArchSd(m, sp) < 0) continue;
              rim++;
              expect([Tissue.Vertebra, Tissue.Cartilage], `${m.map((x) => x.toFixed(2)).join(', ')}`).toContain(cls(m).tissue);
            }
    expect(rim).toBeGreaterThan(10_000);
    // el hueso es la unión de los cuerpos (borde del platillo redondeado) y el arco; el disco, el cilindro entre dos cuerpos
    for (const m of [
      [0, -46, z0Mm],
      [15, -50, z0Mm + levelMm / 2],
      [30, -70, z0Mm + levelMm / 2],
    ] as Vec3[]) {
      expect(sdSpine(m, sp)).toBeCloseTo(Math.min(spineBodySd(m, sp), spineArchSd(m, sp)), 12);
      expect(sdSpineDisc(m, sp)).toBeCloseTo(Math.max(spineEllipseSd(m, sp), -spineBodySd(m, sp)), 12);
    }
  });

  it('classify: hueso sin moteado propio, disco de cartílago, la cortical la dibuja el tejido de fuera de un cuerpo y el arco no', () => {
    const z0 = SPINE_SHAPE.z0Mm;
    const ry = sp.r / SPINE_SHAPE.aspect;
    expect(cls([0, -46, z0]).tissue).toBe(Tissue.Vertebra);
    expect(TISSUES[Tissue.Vertebra].backscatter).toBe(0);
    const disc = cls([0, -46, z0 + SPINE_SHAPE.levelMm / 2]);
    expect(disc.tissue).toBe(Tissue.Cartilage);
    expect(disc.boundaryDistance).toBeLessThanOrEqual((SPINE_SHAPE.levelMm - SPINE_SHAPE.bodyMm) / 2 + 1e-9);
    // delante del cuerpo, a 0,1–1,2 mm de su cara: la cortical, con la distancia a la cara del cuerpo
    for (const d of [0.1, 0.5, 1.2]) {
      const m: Vec3 = [0, -46 + ry + d, z0];
      const c = cls(m);
      expect(c.interface, `${d} mm`).toBe(Interface.VertebraCortex);
      expect(c.interfaceDistance).toBeCloseTo(spineBodySd(m, sp), 12);
      expect(c.boundaryDistance).toBeLessThanOrEqual(spineBodySd(m, sp) + 1e-12);
      expect(TISSUES[c.tissue].gas).toBe(false);
    }
    // más allá de SPINE_FACE_MM, no
    expect(cls([0, -46 + ry + SPINE_FACE_MM + 0.1, z0]).interface).not.toBe(Interface.VertebraCortex);
    // el disco junto a un platillo también la dibuja (la cara del platillo)
    const endplate = cls([0, -46, z0 + SPINE_SHAPE.bodyMm / 2 + 0.4]);
    expect(endplate.tissue).toBe(Tissue.Cartilage);
    expect(endplate.interface).toBe(Interface.VertebraCortex);
    // el arco posterior (una caja) no dibuja cara: a 0,5 mm de su cara lateral, fuera del alcance del cuerpo
    const arch: Vec3 = [sp.archHalfWidth + 0.5, 0.5 * (sp.archY0 + sp.archY1), z0];
    expect(spineArchSd(arch, sp)).toBeCloseTo(0.5, 6);
    expect(cls(arch).interface).not.toBe(Interface.VertebraCortex);
  });

  it('las reglas de la cara: el gas y el tejido más cerca del arco no la dibujan, la cara más cercana gana y la frontera cuenta el disco', () => {
    // un anillo de muestras a 0,2–1 mm del cilindro de los cuerpos, a lo largo de la columna (tórax y abdomen)
    const a = sp.r * SPINE_SHAPE.aspect;
    const b = sp.r / SPINE_SHAPE.aspect;
    const n = { gas: 0, arch: 0, kept: 0, face: 0 };
    for (let z = -200; z <= 150; z += 1.7)
      for (let t = 0; t < 2 * Math.PI; t += 0.05)
        for (const off of [0.2, 0.6, 1]) {
          const m: Vec3 = [sp.x0 + (a + off) * Math.cos(t), sp.y0 + (b + off) * Math.sin(t), z];
          const d = spineDistances(m, sp);
          if (d.bone <= 0 || d.disc < 0 || d.body >= SPINE_FACE_MM) continue;
          const c = cls(m);
          const tag = `${Tissue[c.tissue]} ${Interface[c.interface]} en (${m.map((x) => x.toFixed(2)).join(', ')}): cuerpo ${d.body}`;
          // la frontera cuenta el hueso, en todas
          expect(c.boundaryDistance, tag).toBeLessThanOrEqual(d.bone + 1e-12);
          if (TISSUES[c.tissue].gas) {
            n.gas++;
            expect(c.interface, tag).not.toBe(Interface.VertebraCortex);
          } else if (d.body > d.bone) {
            // más cerca del arco (una caja sin cara) que del cuerpo
            n.arch++;
            expect(c.interface, tag).not.toBe(Interface.VertebraCortex);
          } else if (c.interface === Interface.VertebraCortex) {
            n.face++;
            expect(c.interfaceDistance, tag).toBe(d.body);
          } else {
            // conserva su cara, más cercana que la del cuerpo (la cápsula hepática, la mitad abdominal del diafragma)
            n.kept++;
            expect(c.interfaceDistance, tag).toBeLessThan(d.body);
          }
        }
    expect(n.gas, JSON.stringify(n)).toBeGreaterThan(100);
    expect(n.arch, JSON.stringify(n)).toBeGreaterThan(100);
    expect(n.kept, JSON.stringify(n)).toBeGreaterThan(20);
    expect(n.face, JSON.stringify(n)).toBeGreaterThan(1000);
    // a 0,5 mm delante de un disco, la frontera está a ≤ 0,5 mm (el disco es otro tejido)
    const beside: Vec3 = [0, -46 + b + 0.5, SPINE_SHAPE.z0Mm + SPINE_SHAPE.levelMm / 2];
    expect(sdSpineDisc(beside, sp)).toBeCloseTo(0.5, 2);
    expect(cls(beside).boundaryDistance).toBeLessThanOrEqual(sdSpineDisc(beside, sp) + 1e-9);
  });

  it('la distancia a la frontera del tejido junto a la columna cuenta el hueso (antes el hígado que recorta no la contaba)', () => {
    // en la subxifoidea el hígado apoya en el costado del cuerpo: a 2 mm de la cara, su frontera está a ≤ 2 mm
    const pose = poseOf('subxiphoid');
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    let checked = 0;
    for (let i = 0; i < 61; i++) {
      const th = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / 60;
      for (let r = 80; r < 175; r += 0.25) {
        const m = uncompress(pointOnLine(contact.frame, CONVEX_C35, th, r), contact);
        const d = sdSpine(m, sp);
        if (d < 1.5 || d > 3) continue;
        const c = cls(m);
        if (c.tissue !== Tissue.Liver) continue;
        checked++;
        expect(c.boundaryDistance, `${i} ${r}`).toBeLessThanOrEqual(d + 1e-9);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('la cara del cuerpo: normal de la elipse en su costado y ±z en los platillos, norma 1 y la curvatura de su sección', () => {
    const a = sp.r * SPINE_SHAPE.aspect;
    const b = sp.r / SPINE_SHAPE.aspect;
    const z0 = SPINE_SHAPE.z0Mm;
    // delante (vértice): la normal +y, κ = b/a²; en el costado (x = a): +x, κ = a/b²
    const front: Vec3 = [0, -46 + b + 0.4, z0];
    const side: Vec3 = [a + 0.4, -46, z0];
    const gf = scene.faceGradient(front, BASELINE_CALIBER)!;
    const gs = scene.faceGradient(side, BASELINE_CALIBER)!;
    expect(gf.normal[1]).toBeGreaterThan(0.9999);
    expect(gs.normal[0]).toBeGreaterThan(0.9999);
    for (const g of [gf, gs]) {
      expect(g.norm).toBeGreaterThan(0.97);
      expect(g.norm).toBeLessThan(1.03);
      expect(g.axis).toEqual([0, 0, 1]);
    }
    expect(gf.curvature).toBeCloseTo(b / (a * a), 3);
    expect(gs.curvature).toBeCloseTo(a / (b * b), 2);
    expect(spineFaceCurvature(front, sp)).toBe(gf.curvature);
    // en el platillo (dentro del disco, junto al cuerpo): ±z y sin curvatura
    const ge = scene.faceGradient([0, -46, z0 + SPINE_SHAPE.bodyMm / 2 + 0.4], BASELINE_CALIBER)!;
    expect(ge.normal[2]).toBeGreaterThan(0.999);
    expect(ge.curvature).toBe(0);
    // una cara de hueso: coherencia de curvatura, iluminada solo desde fuera y la difusa del ángulo crítico
    expect(isBoneCortex(Interface.VertebraCortex)).toBe(true);
    expect(hasCurvatureCoherence(Interface.VertebraCortex)).toBe(true);
    expect(INTERFACES[Interface.VertebraCortex].twoSided).toBe(false);
  });

  it('el eco de la cortical según la incidencia: el de la cortical costal, apagado a 35° y sin la cara de detrás', () => {
    expect(interfaceReflectivity(Interface.VertebraCortex)).toBeCloseTo(interfaceReflectivity(Interface.RibCortex), 3);
    expect(interfaceReflectivity(Interface.VertebraCortex)).toBeCloseTo(0.59, 2);
    const peak = (deg0: number) => {
      const c = Math.cos((deg0 * Math.PI) / 180);
      return interfaceEchoField(Interface.VertebraCortex, c, 1, faceDelta(IFACE_SHIFT_MM, 1, c), k0);
    };
    // de frente, el eco de un hueso (+49 dB sobre el moteado del hígado en la escala de K, sin la curvatura)
    expect(20 * Math.log10(peak(0))).toBeGreaterThan(40);
    // el lóbulo: −10 dB o más a 20° y más de 40 dB bajo el de frente a 35°
    expect(20 * Math.log10(peak(20) / peak(0))).toBeLessThan(-10);
    expect(20 * Math.log10(peak(35) / peak(0))).toBeLessThan(-40);
    // la difusa se apaga en el ángulo crítico (26,9°) y la cara de detrás del cuerpo no se ilumina
    expect(boneDiffuseWindow(Interface.VertebraCortex, Math.cos((28 * Math.PI) / 180))).toBe(0);
    expect(boneDiffuseWindow(Interface.VertebraCortex, 1)).toBeCloseTo(1, 9);
    expect(faceLitFromProbe(Interface.VertebraCortex, [0, 0, 1], [0, 0, 1])).toBe(false);
    expect(faceLitFromProbe(Interface.VertebraCortex, [0, 0, -1], [0, 0, 1])).toBe(true);
  });

  it('subxifoidea (el recorte del juez): la cara de la columna bajo la VCI a < 30° en ≥ 20 líneas y los discos cortan la sombra', () => {
    // la escena de la ronda 5: el hígado apoya en la columna a 12–13 cm; con el círculo de 34 mm el haz tocaba su costado a
    // 44–50° y sin cortical (0 líneas con cara); ahora la cara anterolateral del cuerpo elíptico queda a 24–36°
    const pose = poseOf('subxiphoid');
    const contact = probeContact(pose, CONVEX_C35, scene.torso);
    const nLines = 97;
    let lit = 0;
    let discLines = 0;
    const discGroups: number[] = [];
    for (let i = 0; i < nLines; i++) {
      const th = -CONVEX_C35.halfSector + (2 * CONVEX_C35.halfSector * i) / (nLines - 1);
      const dir = lineDirection(contact.frame, th);
      let before: Tissue | null = null;
      let face: { m: Vec3; ifd: number } | null = null;
      let disc = false;
      for (let r = 60; r < 175; r += 0.1) {
        const m = uncompress(pointOnLine(contact.frame, CONVEX_C35, th, r), contact);
        const c = cls(m);
        const soft = before === Tissue.Liver || before === Tissue.RetroperitonealFat;
        if (c.interface === Interface.VertebraCortex && !face && soft) face = { m, ifd: c.interfaceDistance };
        // la línea que llega a un disco antes que al hueso pasa entre dos sombras
        if (c.tissue === Tissue.Cartilage && sdSpineDisc(m, sp) < 0) {
          disc = true;
          break;
        }
        if (c.tissue === Tissue.Vertebra || TISSUES[c.tissue].gas) break;
        before = c.tissue;
      }
      if (disc) {
        discLines++;
        if (!discGroups.length || discGroups[discGroups.length - 1] !== i - 1) discGroups.push(i);
        discGroups[discGroups.length - 1] = i;
      }
      if (!face) continue;
      const g = scene.faceGradient(face.m, BASELINE_CALIBER)!;
      const cosI = Math.abs(g.normal[0] * dir[0] + g.normal[1] * dir[1] + g.normal[2] * dir[2]);
      if (deg(Math.acos(cosI)) < 30) lit++;
    }
    expect(lit).toBeGreaterThanOrEqual(20);
    // cada disco deja pasar el haz entre dos sombras: ≥ 3 grupos de líneas (un disco cada 31 mm en ~11 cm de columna)
    expect(discLines).toBeGreaterThanOrEqual(8);
    expect(discGroups.length).toBeGreaterThanOrEqual(3);
  });

  it('GLSL: la columna con las constantes de SPINE_SHAPE, la cara tras la clasificación y el eco de la cortical', () => {
    // la cara solo se ve hasta el alcance del perfil de un lado con la cota de |∇| de la salida barata
    expect(SPINE_FACE_MM).toBeGreaterThanOrEqual((IFACE_SHIFT_MM + IFACE_REACH_MM) * IFACE_GRADIENT_MAX);
    const glsl = ANATOMY_GLSL.replace(/\s+/g, ' ');
    expect(glsl).toContain(`#define SPINE_ASPECT ${SPINE_SHAPE.aspect.toFixed(4)}`);
    expect(glsl).toContain(`#define SPINE_LEVEL ${SPINE_SHAPE.levelMm.toFixed(3)}`);
    expect(glsl).toContain(`#define SPINE_BODY ${SPINE_SHAPE.bodyMm.toFixed(3)}`);
    expect(glsl).toContain(`#define SPINE_Z0 ${SPINE_SHAPE.z0Mm.toFixed(3)}`);
    expect(glsl).toContain(`#define SPINE_RIM ${SPINE_SHAPE.rimMm.toFixed(3)}`);
    expect(glsl).toContain(`#define SPINE_FACE_MM ${SPINE_FACE_MM.toFixed(3)}`);
    expect(glsl).toContain(`#define ${INTERFACE_GLSL_NAME[Interface.VertebraCortex]} ${Interface.VertebraCortex}`);
    // los gemelos de primitives.ts: el cilindro elíptico, los cuerpos en z, el disco que llena el cilindro y la curvatura
    expect(glsl).toContain('vec2 spineRadii() { return vec2(uSpine.z * SPINE_ASPECT, uSpine.z / SPINE_ASPECT); }');
    expect(glsl).toContain(
      'return vec2(sdEllipsoidLocal(vec3(m.xy - uSpine.xy, 0.0), vec3(spineRadii(), 1e3)), abs(t - SPINE_LEVEL * floor(t / SPINE_LEVEL + 0.5)) - 0.5 * SPINE_BODY);',
    );
    expect(glsl).toContain('if (d.y > d.x) return 0.0;');
    expect(glsl).toContain('float q = length(vec2(r.x * k.y, r.y * k.x)) / kl; return r.x * r.y / (q * q * q);');
    expect(glsl).toContain('float dDisc = max(sb.x, -dBody);');
    expect(glsl).toContain('float dBody = smoothMax(sb.x, sb.y, SPINE_RIM); float dSpine = min(dBody, spineArchSd(m));');
    expect(glsl).toContain(
      'if (dDisc < 0.0) { c.tissue = T_CARTILAGE; c.bd = -dDisc; } else classifyInside(m, withCurtain, depth, tn, dSpine, c);',
    );
    expect(glsl).toContain(
      'if (c.tissue != T_LUNG && c.tissue != T_BOWELGAS && c.tissue != T_AIR && dBody <= dSpine && dBody < SPINE_FACE_MM && dBody < c.ifd) { c.iface = IF_VERTEBRA; c.ifd = dBody; }',
    );
    // el gradiente de la cara, antes que las ramas por tejido (la cápsula o el diafragma también pueden dibujarla)
    expect(glsl.indexOf('if (c.iface == IF_VERTEBRA) {')).toBeLessThan(glsl.indexOf('} else if (c.tissue == T_CAPSULE) {'));
    const echo = INTERFACE_ECHO_GLSL.replace(/\s+/g, ' ');
    expect(echo).toContain('if (c.iface == IF_VERTEBRA) { c.tangent = vec3(0.0, 0.0, 1.0); c.kc = spineFaceCurvature(m); }');
  });
});

function poseOf(id: string): ProbePose {
  const s = START_POINTS.find((p) => p.id === id)!;
  return { phi: s.phi, z: s.z, lift: 0, yaw: s.yaw, rock: s.rock ?? 0, tilt: s.tilt ?? 0 };
}
