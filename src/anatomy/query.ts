import type { Vec3 } from '../core/vec3';
import type { PhysiologySample } from '../physiology/engine';
import type { VesselId } from '../physiology/vessels';
import { RespiratoryDeformation } from './deformation';
import { type AnatomyScene, type Classification, type VesselCaliber } from './scene';

/**
 * Consulta anatómica en coordenadas del MUNDO: aplica la deformación
 * respiratoria, clasifica el tejido y devuelve el campo de velocidades
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
    const caliber: VesselCaliber = {
      radiusScale: (id: VesselId) => {
        if (id.startsWith('ivc')) return ivcLatScale;
        if (id.startsWith('hv')) return s.hvRadiusScale;
        if (id.startsWith('pv')) return s.pvRadiusScale;
        return 1;
      },
      ivcApScale: s.ivc.dApMm / s.ivc.dLatMm,
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
}
