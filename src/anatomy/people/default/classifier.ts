/** @twin clasificacion */
import { type Vec3 } from '../../../core/vec3';
import { EMPTY_ATLAS } from '../../emptyAtlas';
import { Interface, MORISON_CONTACT_MM } from '../../interfaces';
import { abdomenQuery } from '../../organs/abdomen';
import { BOWEL_FIELD_REACH_MM, bowelGasSdf, bowelQuery } from '../../organs/bowel';
import { gallbladderSdf } from '../../organs/gallbladder';
import { heartFloor, ivcAtrium, thorax } from '../../organs/heart';
import {
  PERIRENAL,
  RENAL_CAPSULE_MM,
  RENAL_FASCIA_MM,
  hilumChannelSdf,
  kidneyLocal,
  perirenalOuterSdf,
  perirenalThicknessMm,
  type KidneyRegion,
} from '../../organs/kidney';
import { retroperitoneum } from '../../organs/retroperitoneum';
import { withParavertebral } from './paravertebral';
import { STERNUM, sternumSd } from '../../organs/sternum';
import { ribSearchDepth, wallArc, wallDepths, wallFace, type WallDepths } from '../../organs/wall';
import { kidneyQuery } from '../../people/default/kidneyInterior';
import type { S0028Ownership } from '../../people/s0028/solids';
import { ribDistanceLowerBound, sdDiaphragmSlope, sdRib } from '../../primitives';
import type { AnatomyScene, Classification, VesselCaliber } from '../../scene';
import { NONE } from '../../scene';
import { BOWEL_BD_CAP_MM, DIAPHRAGM_THICKNESS_MM, Tissue } from '../../tissues';
export function classifyWall(
  scene: AnatomyScene,
  m: Vec3,
  d: number,
): { final: true; cls: Classification } | { final: false; wallMm: number; solids?: S0028Ownership } {
  const torso = scene.torso;
  const skin = torso.skinMm;
  const wall = skin + torso.fatMm + torso.muscleMm;
  // la cara de la capa más cercana; la distancia a la frontera cuenta la costilla más cercana (|∇| ≤ 1,1)
  const layer = (
    tissue: Tissue,
    bd: number,
    u: number,
    ribD: number,
    ribAny: number,
    w?: WallDepths,
  ): { final: true; cls: Classification } => {
    const [face, dist] = wallFace(d, u, m[2], ribD, torso, w);
    const boundaryDistance = Math.min(bd, ribAny / 1.1);
    return { final: true, cls: { ...NONE, tissue, boundaryDistance, interface: face, interfaceDistance: dist } };
  };
  if (d < skin) return layer(Tissue.Skin, skin - d, 0, 1e3, 1e3);
  // Costillas, antes de la grasa subcutánea donde una puede llegar (la grasa no las corta): dentro de la
  // pared o justo por debajo; la ósea más cercana da la cortical, el cartílago su pericondrio
  let ribD = 1e3;
  let ribAny = 1e3;
  if (scene.hasAbdominalAtlas && scene.person?.assets.buffers.thoracic) {
    const q = (scene.person?.cpu.atlas ?? EMPTY_ATLAS).thoracicValue(m),
      material = (scene.person?.cpu.atlas ?? EMPTY_ATLAS).thoracicMaterial(q.label);
    ribAny = q.d;
    ribD = material === 'cartilage' ? 1e3 : q.d;
    if (q.d < 0)
      return {
        final: true,
        cls: {
          ...NONE,
          tissue: material === 'cartilage' ? Tissue.Cartilage : material === 'vertebra' ? Tissue.Vertebra : Tissue.Bone,
          boundaryDistance: -q.d,
          ...(material === 'cartilage' ? { interface: Interface.Perichondrium, interfaceDistance: -q.d } : {}),
        },
      };
  } else if (d >= ribSearchDepth(torso, scene.ribs[0]?.scale ?? 1)) {
    const sternumD = sternumSd(m, torso);
    if (sternumD < 0) {
      const cartilage = m[2] < STERNUM.zJunctionMm;
      return {
        final: true,
        cls: {
          ...NONE,
          tissue: cartilage ? Tissue.Cartilage : Tissue.Bone,
          boundaryDistance: -sternumD,
          ...(cartilage ? { interface: Interface.Perichondrium, interfaceDistance: -sternumD } : {}),
        },
      };
    }
    ribAny = sternumD;
    if (m[2] >= STERNUM.zJunctionMm) ribD = sternumD;
    for (const rib of scene.ribs) {
      if (!rib.sourceCartilage && ribDistanceLowerBound(m, rib) > Math.max(ribAny, ribD) + 0.01) continue;
      const r = sdRib(m, rib, torso, scene.spine);
      if (r.d < 0) {
        const tissue = r.cartilage ? Tissue.Cartilage : Tissue.Bone;
        const face = r.cartilage ? { interface: Interface.Perichondrium, interfaceDistance: -r.d } : {};
        return { final: true, cls: { ...NONE, tissue, boundaryDistance: -r.d, ...face } };
      }
      ribAny = Math.min(ribAny, r.d);
      if (!r.cartilage) ribD = Math.min(ribD, r.d);
    }
  }
  if (d >= wall) return { final: false, wallMm: wall };
  // las coordenadas de la pared solo dentro de ella: fascia profunda y transversalis onduladas en (u, z)
  const u = wallArc(m, torso);
  const w = wallDepths(torso, u, m[2]);
  if (d < w.fascia) return layer(Tissue.Fat, Math.min(d - skin, w.fascia - d), u, ribD, ribAny, w);
  if (d < w.transversalis) return layer(Tissue.Muscle, Math.min(d - w.fascia, w.transversalis - d), u, ribD, ribAny, w);
  // grasa preperitoneal (extraperitoneal) entre la transversalis y el peritoneo parietal
  return layer(Tissue.Fat, Math.min(d - w.transversalis, wall - d), u, ribD, ribAny, w);
}
/** @twin clasificacion */
export function classifyInside(
  scene: AnatomyScene,
  m: Vec3,
  caliber: VesselCaliber,
  withCurtain: boolean,
  depth: number,
  wallMm: number,
  spineDistance: number,
  _solids?: S0028Ownership,
): Classification {
  const curtain = withCurtain ? scene.classifyLungCurtain(m, -depth - wallMm, caliber.diaphragmCaudalMm) : null;
  if (curtain) return curtain;
  const tube = scene.classifyTubes(m, caliber);
  if (tube && tube.interface !== Interface.IvcLumen) return tube;
  const [dDome, slope] = sdDiaphragmSlope(m, scene.diaphragm, scene.torso);
  const floor = heartFloor(dDome, slope);
  // la VCI que entra en la aurícula derecha (decisión 85): dentro de ella no hay pared que dibujar (antes daba un eco de
  // pared brillante y seguía como un anillo dentro de la cavidad): su pared es sangre de la aurícula y su luz conserva el
  // flujo sin cara; fuera de la aurícula, por encima de su suelo, no hay VCI (gana el corazón)
  const ivc = tube?.interface === Interface.IvcLumen ? ivcAtrium(m, floor, scene.person?.cpu) : null;
  if (tube && ivc && ivc.cavity < 0) {
    if (tube.tissue === Tissue.Blood)
      return {
        ...tube,
        boundaryDistance: Math.min(tube.boundaryDistance, -ivc.cavity),
        interface: Interface.None,
        interfaceDistance: NONE.interfaceDistance,
      };
    return { ...NONE, tissue: Tissue.Blood, boundaryDistance: -ivc.cavity };
  }
  if (tube && !ivc?.outside) return ivc ? { ...tube, boundaryDistance: Math.min(tube.boundaryDistance, ivc.cut) } : tube;
  if (dDome < 0) {
    // tórax (decisión 85): el corazón en su saco, el mediastino o el pulmón; la capa del pericardio dibuja su cara
    const t = thorax(m, dDome, floor, scene.person?.cpu);
    const face = t.ifd < NONE.interfaceDistance ? { interface: Interface.Pericardium, interfaceDistance: t.ifd } : {};
    // su distancia a la frontera cuenta también la columna y la pared (como el retroperitoneo)
    const bd = Math.min(t.bd, spineDistance, -depth - wallMm);
    return { ...NONE, tissue: t.tissue, boundaryDistance: bd, ...face };
  }
  if (dDome < DIAPHRAGM_THICKNESS_MM) {
    // la mitad abdominal dibuja la cara hepática; la pleural la dibuja el espejo exacto de la pasada A
    return scene.classifyDiaphragm(dDome);
  }
  const dGb = gallbladderSdf(m, scene.gallbladder);
  if (dGb < 0)
    return { ...NONE, tissue: Tissue.Fluid, boundaryDistance: -dGb, interface: Interface.GallbladderLumen, interfaceDistance: -dGb };
  if (dGb < scene.gallbladderWallMm)
    return {
      ...NONE,
      tissue: Tissue.BileDuctWall,
      boundaryDistance: Math.min(dGb, scene.gallbladderWallMm - dGb),
      interface: Interface.GallbladderLumen,
      interfaceDistance: dGb,
    };
  const kidney = classifyKidneys(scene, m);
  if (kidney.cls) return kidney.cls;
  if (scene.hasAbdominalAtlas) {
    const abdomen = abdomenQuery(m, scene.person?.cpu);
    if (abdomen) return { ...NONE, ...abdomen };
  }
  const liver = scene.classifyLiver(m, dDome, -depth - wallMm, kidney, dGb - scene.gallbladderWallMm);
  if (liver) return liver;
  // Intestino: el «resto». Su distancia a la frontera es la de las interfaces que ganan antes
  // (diafragma, vesícula, hígado, pared, grasa perirrenal, gas; el corazón queda por encima del diafragma); como en el hígado, no
  // cuenta la de los tubos. Con 5 mm fijos el gate volumétrico daba por interior un punto pegado
  // al diafragma que float32 clasificaba al otro lado (CI de #39: Bowel→Diaphragm, 1 de 44 826).
  let bd = Math.min(BOWEL_BD_CAP_MM, dDome - DIAPHRAGM_THICKNESS_MM, dGb - scene.gallbladderWallMm, scene.liverBaseSdf(m), -depth - wallMm);
  for (const k of [scene.kidneyRight, scene.kidneyLeft]) bd = Math.min(bd, perirenalOuterSdf(kidneyLocal(m, k), k));
  // detrás del peritoneo parietal posterior, el retroperitoneo (decisión 81): psoas, cuadrado lumbar, masa paravertebral y grasa; delante, el
  // intestino. Su distancia a la frontera cuenta también la columna, que se clasifica antes (el psoas la bordea)

  const retroPoint: Vec3 = [m[0], m[1] - scene.spineReferenceOffset, m[2]];
  const insideWall = -depth - wallMm;
  const retro = retroperitoneum(retroPoint, insideWall, kidney.dPeriMm, scene.hasAbdominalAtlas ? m : retroPoint, scene.person?.cpu);
  // la masa paravertebral (decisión 328), solo con el atlas
  const [tissue, dRetro] = scene.hasAbdominalAtlas ? withParavertebral(retro, m, insideWall, kidney.dPeriMm, scene.person?.cpu) : retro;
  bd = Math.max(0, Math.min(bd, dRetro, spineDistance));
  if (tissue !== Tissue.Bowel) return { ...NONE, tissue, boundaryDistance: bd };
  if (scene.hasAbdominalAtlas) {
    const gut = (scene.person?.cpu.atlas ?? EMPTY_ATLAS).abdominalAtlasValue(m, 1);
    const mesentery = gut.label === 3 && gut.d < 16 && gut.d < scene.liverBaseSdf(m);
    return { ...NONE, tissue: mesentery ? Tissue.MesentericFat : Tissue.UnsegmentedSoftTissue, boundaryDistance: Math.min(bd, 1) };
  }
  const q = bowelQuery(m, scene.bowelRadii),
    dl = q.lumen;
  if (q.d >= BOWEL_FIELD_REACH_MM) return { ...NONE, tissue: Tissue.MesentericFat, boundaryDistance: Math.min(bd, q.d / 2) };
  const iface = Math.abs(q.d) < Math.abs(dl) ? Interface.BowelSerosa : Interface.BowelLumen;
  const face = {
    interface: iface,
    interfaceDistance: Math.abs(iface === Interface.BowelSerosa ? q.d : dl),
    boundaryNormal: iface === Interface.BowelSerosa ? q.normal : q.lumenNormal,
  };
  if (q.d >= 0) return { ...NONE, ...face, tissue: Tissue.MesentericFat, boundaryDistance: Math.min(bd, q.d / 2) };
  if (dl >= 0) return { ...NONE, ...face, tissue: Tissue.Bowel, boundaryDistance: Math.min(bd, -q.d / 2, dl / 2) };
  const dg = bowelGasSdf(m, dl);
  return {
    ...NONE,
    ...(dg < 0 ? {} : face),
    tissue: dg < 0 ? Tissue.BowelGas : Tissue.Fluid,
    boundaryDistance: Math.min(bd, -dl / 2, Math.abs(dg) / 2),
  };
}
export function classifyKidneys(scene: AnatomyScene, m: Vec3): { cls: Classification | null; dPeriMm: number; periThin: boolean } {
  let dPeriMm = 1e3;
  let periThin = false;
  for (const k of [scene.kidneyRight, scene.kidneyLeft]) {
    const dc = Math.hypot(m[0] - k.center[0], m[1] - k.center[1], m[2] - k.center[2]);
    if (dc > k.radii[0] + PERIRENAL.maxMm + 2) continue;
    const kh = kidneyQuery(m, k);
    const fat = perirenalThicknessMm(kidneyLocal(m, k), k);
    const dFat = scene.hasAbdominalAtlas ? perirenalOuterSdf(kidneyLocal(m, k), k) : kh.dOuter - fat;
    if (dFat < dPeriMm) {
      dPeriMm = dFat;
      periThin = fat <= PERIRENAL.faceMaxMm;
    }
    if (kh.dOuter < 0) {
      // cápsula fibrosa: línea brillante que separa la corteza de la grasa perirrenal, salvo en la boca del hilio: dentro
      // del canal del seno su grasa sigue en la perirrenal (decisión 87: antes la cápsula la cruzaba). El mismo canal
      // decide la cara de la grasa de fuera, así que las dos mitades de la cara cambian de dueño en el mismo sitio, y la
      // distancia a la frontera lo cuenta
      // `inner` cambia más deprisa que la distancia: fuera de la pelvis y del seno, la peor razón medida es 0,85. Es una medida en material, no una cota (decisión 305)
      const inner = kh.inner * 0.75;
      let bd = Math.min(inner, -kh.dOuter - RENAL_CAPSULE_MM);
      if (-kh.dOuter < RENAL_CAPSULE_MM) {
        const hc = hilumChannelSdf(kidneyLocal(m, k), k);
        if (hc > 0) {
          const cls: Classification = {
            ...NONE,
            tissue: Tissue.RenalCapsule,
            boundaryDistance: Math.min(-kh.dOuter, RENAL_CAPSULE_MM + kh.dOuter, inner, hc),
            interface: Interface.RenalCapsule,
            interfaceDistance: -kh.dOuter,
          };
          return { cls, dPeriMm, periThin };
        }
        bd = Math.min(inner, -hc);
      }
      return { cls: { ...NONE, tissue: KIDNEY_TISSUE[kh.region], boundaryDistance: bd }, dPeriMm, periThin };
    }
    // Grasa perirrenal (fascia de Gerota) de grosor variable (decisión 68) hasta la impresión renal del hígado: en
    // el receso de Morison la cápsula hepática apoya directamente sobre ella, sin hueco.
    if (dFat < 0) {
      // la mitad externa de la grasa gruesa dibuja la cara de Morison, solo si apoya el hígado (la impresión renal solapa
      // la grasa y la cápsula hepática le cede la cara, `MORISON_CONTACT_MM`); si no, se funde sin línea con la grasa
      // retroperitoneal (antes la gruesa nunca la dibujaba y el 62 % del contacto hígado–grasa quedaba sin línea). La
      // mitad interna, y toda la fina (decisión 81), la de la cápsula renal: las dos caras de la fina, a 1–2,5 mm, eran dos
      // líneas paralelas (frente al hígado, la grasa retroperitoneal o el intestino); ahora son una, y en Morison la
      // cápsula hepática le sigue cediendo la suya
      // Frente a la boca del hilio (el canal del seno) no hay cápsula que dibujar: grasa con grasa (decisión 87); la
      // distancia a la frontera cuenta el cambio de dueño de la cara
      const thickness = scene.hasAbdominalAtlas ? kh.dOuter - dFat : fat;
      const outerFace = kh.dOuter > 0.5 * thickness && thickness > PERIRENAL.faceMaxMm;
      const ifd = outerFace ? -dFat : kh.dOuter;
      const hc = hilumChannelSdf(kidneyLocal(m, k), k);
      const envelope = scene.hasAbdominalAtlas;
      const face = outerFace ? envelope || scene.liverSdf(m) <= ifd + MORISON_CONTACT_MM : hc > 0;
      const cls: Classification = {
        ...NONE,
        tissue: envelope && -dFat < RENAL_FASCIA_MM ? Tissue.SoftCapsule : Tissue.PerirenalFat,
        boundaryDistance: Math.min(kh.dOuter, -dFat, Math.abs(hc), envelope ? Math.abs(dFat + RENAL_FASCIA_MM) : Infinity),
        interface: face
          ? outerFace
            ? envelope
              ? Interface.RenalFascia
              : Interface.PerirenalFat
            : Interface.RenalCapsule
          : Interface.None,
        interfaceDistance: face ? ifd : NONE.interfaceDistance,
      };
      return { cls, dPeriMm, periThin };
    }
  }
  return { cls: null, dPeriMm, periThin };
}
const KIDNEY_TISSUE: Readonly<Record<KidneyRegion, Tissue>> = {
  pelvis: Tissue.RenalPelvis,
  sinus: Tissue.RenalSinus,
  medulla: Tissue.RenalMedulla,
  arcuate: Tissue.ArteryWall,
  cortex: Tissue.RenalCortex,
};
