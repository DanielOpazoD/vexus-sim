import { bowelRadii } from './organs/bowel';
import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import { VESSEL_META, type VesselId } from '../physiology/vessels';
import type { ProbeCompression } from './compression';
import { RespiratoryDeformation } from './deformation';
import { type AnatomyScene, type Classification, type FaceGeometry, type VesselCaliber } from './scene';

/**
 * Consulta anatómica en coordenadas del MUNDO: deshace la compresión de la sonda
 * (decisión 63) y la deformación respiratoria, clasifica el tejido y devuelve el campo de velocidades
 * (sangre relativa al vaso + movimiento global del vaso), tal como exige la
 * invariante Doppler 10.1: v_rel = u·t̂ + v_vaso − v_sonda.
 */
export interface WorldQuery extends Classification {
  material: Vec3;
  /** Velocidad de la sangre en el punto (mm/s, mundo), null fuera de un vaso. */
  bloodVelocity: Vec3 | null;
  /**
   * Base de flujo: tangente × (A_ref/A_local) × perfil(ρ). La velocidad en
   * cualquier instante es flowBasis · u_ref(t) del vaso; permite actualizar
   * dispersores sin reclasificar la geometría en cada tick.
   */
  flowBasis: Vec3 | null;
  /** Velocidad del tejido/vaso por respiración (mm/s, mundo). */
  tissueVelocity: Vec3;
}

export class AnatomyQuery {
  readonly deformation: RespiratoryDeformation;

  constructor(readonly scene: AnatomyScene) {
    this.deformation = new RespiratoryDeformation(scene);
  }

  /**
   * Contacto de la sonda del cuadro (decisión 63): la compresión que ven todas las consultas del mundo (la
   * misma que sube la GPU). null: el tronco rígido (sin sonda).
   */
  setProbeCompression(k: ProbeCompression | null): void {
    this.deformation.compression = k;
    this.scene.bowelRadii = bowelRadii(k);
  }

  get probeCompression(): ProbeCompression | null {
    return this.deformation.compression;
  }

  private lastSample: PhysiologySample | null = null;
  private lastCaliber: VesselCaliber | null = null;

  /**
   * Escalas de calibre para una muestra. Memorizado por identidad de la muestra:
   * `PhysiologySample` es inmutable por paso y esta función se llama decenas de
   * miles de veces por segundo (corte, puerta, dispersores).
   */
  caliberFor(s: PhysiologySample): VesselCaliber {
    if (s === this.lastSample && this.lastCaliber) return this.lastCaliber;
    const ivcRefLat = this.scene.vesselById.get('ivcSupra')!.refRadius;
    const ivcLatScale = s.ivc.dLatMm / 2 / ivcRefLat;
    const supra = s.ivcSupra ?? s.ivc;
    const caliber: VesselCaliber = {
      radiusScale: (id: VesselId) => {
        switch (VESSEL_META[id].caliber) {
          case 'ivc':
            return id === 'ivcSupra' ? supra.dLatMm / 2 / ivcRefLat : ivcLatScale;
          case 'hepaticVein':
            return s.hvRadiusScale;
          case 'portal':
            return s.pvRadiusScale;
          case 'fixed':
            return 1;
        }
      },
      ivcApScale: s.ivc.dApMm / s.ivc.dLatMm,
      ivcSupraApScale: supra.dApMm / supra.dLatMm,
      diaphragmCaudalMm: s.resp.diaphragmCaudalMm,
    };
    this.lastSample = s;
    this.lastCaliber = caliber;
    return caliber;
  }

  classifyWorld(p: Vec3, s: PhysiologySample): WorldQuery {
    const m = this.deformation.toMaterial(p, s.resp);
    const c = this.scene.classify(m, this.caliberFor(s));
    const tissueVelocity = this.deformation.tissueVelocity(m, s.resp);
    let bloodVelocity: Vec3 | null = null;
    let flowBasis: Vec3 | null = null;
    if (c.vessel && c.vesselHit) {
      const def = this.scene.vesselById.get(c.vessel)!;
      const uRef = s.velocities[c.vessel];
      // Velocidad media uniforme a lo largo del vaso (decisión 6): las venas
      // colectoras reciben tributarias y las ramas portales se dividen, de modo
      // que el caudal local escala con el área local; aplicar Q=cte en un tubo
      // afilado dispararía la velocidad periférica. Solo se aplica el perfil radial.
      const n = def.profileN;
      const rho = Math.min(1, c.vesselHit.rho);
      const k = ((n + 2) / n) * (1 - Math.pow(rho, n)) * c.flowFactor;
      const t = c.vesselHit.tangent;
      flowBasis = [t[0] * k, t[1] * k, t[2] * k];
      bloodVelocity = [flowBasis[0] * uRef, flowBasis[1] * uRef, flowBasis[2] * uRef];
    }
    return { ...c, material: m, bloodVelocity, flowBasis, tissueVelocity };
  }

  /**
   * Distancia con signo a una cara geométrica (`AnatomyScene.faceSdf`) en un punto del MUNDO, con la
   * deformación respiratoria y el calibre del instante. Banco de fidelidad y pruebas.
   */
  faceSdfWorld(p: Vec3, s: PhysiologySample, face: FaceGeometry): number | null {
    return this.scene.faceSdf(this.deformation.toMaterial(p, s.resp), this.caliberFor(s), face);
  }
}
