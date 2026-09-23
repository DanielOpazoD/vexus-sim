import { SeededRandom } from '../core/random';
import type { Vec3 } from '../core/vec3';
import { dopplerShiftHz } from '../core/units';
import type { AnatomyQuery } from '../anatomy/query';
import type { PhysiologySample } from '../physiology/engine';
import { TISSUES, Tissue } from '../anatomy/tissues';
import { VESSEL_META, type VesselId } from '../physiology/vessels';

/**
 * Volumen de muestra físico del Doppler pulsado (guía §10; base D.8):
 *
 *   z[n] = Σ_j a_j w_j e^{iφ_j} + z_pared + η ;  φ_j[n+1] − φ_j[n] = 2π f_D,j Δt
 *
 * Dispersores virtuales persistentes en coordenadas MATERIALES dentro de una
 * caja alrededor de la puerta. Los de sangre se advectan con el campo de
 * velocidades; los de tejido siguen la deformación respiratoria. El peso w_j
 * combina la ventana axial de la puerta (convolucionada con el pulso), el
 * ancho lateral y el espesor elevacional del haz; a_j la retrodispersión y
 * la transmisión acumulada. La frecuencia Doppler física usa la velocidad
 * relativa v_rel = v_sangre + v_tejido − v_sonda proyectada sobre el haz.
 *
 * El resultado es una IQ que comparten espectro, color (a través de la misma
 * convención) y audio. Ningún elemento aquí consulta «si el cursor está
 * dentro del vaso».
 */
export interface GateGeometry {
  /** Centro de la puerta en el mundo (mm). */
  center: Vec3;
  /** Dirección unitaria del haz desde la sonda hacia el tejido. */
  beamDir: Vec3;
  /** Vectores unitarios lateral (en plano) y elevacional. */
  lateral: Vec3;
  elevation: Vec3;
  /** Longitud de la puerta (mm) a lo largo del haz. */
  lengthMm: number;
  /** Semianchura lateral y elevacional del haz a esa profundidad (σ, mm). */
  lateralSigmaMm: number;
  elevationSigmaMm: number;
  /** Longitud del pulso Doppler (σ axial, mm). */
  pulseSigmaMm: number;
  /** Dispersión angular de la apertura (σ, rad): ensanchamiento espectral intrínseco. */
  apertureAngleSigmaRad?: number;
  /** Transmisión de amplitud de ida y vuelta hasta la puerta (0–1). */
  transmission: number;
}

export interface GateEquipment {
  prfHz: number;
  f0Hz: number;
  /** Ganancia espectral (factor lineal aplicado a señal y ruido antes del mapeo). */
  gain: number;
}

interface Scatterer {
  /** Posición material (mm). */
  m: Vec3;
  amp: number;
  phase: number;
  /** Ángulo (rad) con que la apertura ve a ESTE dispersor respecto al eje del haz (fijo por dispersor). */
  apAngle: number;
  /** Fasor e^{iφ} y rotación por tick e^{i2πfDΔt} (se recalcula cada SLOW_EVERY ticks). */
  cr: number;
  ci: number;
  rotC: number;
  rotS: number;
  /** Peso del haz/puerta (se recalcula cada SLOW_EVERY ticks). */
  w: number;
  vessel: VesselId | null;
  isBlood: boolean;
  /** Velocidad material (mm/s) de la sangre en su posición (sin tejido). */
  vBlood: Vec3;
  /** Base de flujo (tangente·relación de áreas·perfil): vBlood = flowBasis·u_ref(t). */
  flowBasis: Vec3;
  tissue: Tissue;
}

export interface GateComposition {
  bloodFraction: number;
  /**
   * Peso de haz de la sangre por dispersor (Σ w_sangre / N): cuánta sangre ve de verdad la puerta.
   * Una siembra nueva da la referencia; si la población con historia se va a los bordes de la caja
   * (donde w ≈ 0), la fracción de sangre puede seguir alta y la señal, sin embargo, desaparecer.
   */
  bloodWeight: number;
  arterialFraction: number;
  wallFraction: number;
  vessels: Partial<Record<VesselId, number>>;
}

const N_SCATTERERS = 320;
/** Reclasificación geométrica (vaso, ρ, tangente): cada 96 ticks (≈37 ms a 2,6 kHz). */
const RECLASSIFY_EVERY = 96;
/** Actualización de pesos, salida de caja y frecuencia Doppler: cada 8 ticks (≈3 ms). */
const SLOW_EVERY = 8;
/** Ruido electrónico relativo a la sangre a transmisión 1 ([EXTRAPOLACIÓN PROPIA]). */
const NOISE_STD = 0.0004;

export class SampleVolumeIQ {
  private scatterers: Scatterer[] = [];
  private rng: SeededRandom;
  private tick = 0;
  /**
   * Desplazamiento respiratorio en el centro de la puerta. La posición de un dispersor en el mundo
   * es m + dispNow en la comprobación de salida, en la resiembra y en la composición. Antes la
   * resiembra y la composición usaban el campo exacto de cada punto y la comprobación el del centro:
   * los dispersores recién colocados junto a una cara se veían fuera y se resembraban en bucle,
   * siempre en la cara (parénquima), y la puerta sobre el tronco portal perdía la sangre en la
   * primera inspiración sin recuperarla (0 % frente al 95 % de una siembra nueva).
   */
  private dispNow: Vec3 = [0, 0, 0];
  private gate: GateGeometry | null = null;
  private equipment: GateEquipment = { prfHz: 2500, f0Hz: 2.5e6, gain: 1 };
  private halfAxial = 4;
  private halfLateral = 5;
  private halfElev = 6;
  private composition: GateComposition = { bloodFraction: 0, bloodWeight: 0, arterialFraction: 0, wallFraction: 0, vessels: {} };

  constructor(
    private readonly anatomy: AnatomyQuery,
    seed: number,
  ) {
    this.rng = new SeededRandom(seed ^ 0xd0991e);
  }

  get lastComposition(): GateComposition {
    return this.composition;
  }

  setEquipment(e: Partial<GateEquipment>): void {
    this.equipment = { ...this.equipment, ...e };
  }

  get equipmentState(): GateEquipment {
    return this.equipment;
  }

  /** Cambia la geometría de la puerta; si se movió mucho, resiembra los dispersores. */
  setGate(g: GateGeometry, phys: PhysiologySample): void {
    const moved =
      !this.gate ||
      Math.hypot(g.center[0] - this.gate.center[0], g.center[1] - this.gate.center[1], g.center[2] - this.gate.center[2]) >
        0.5 * this.halfAxial ||
      Math.abs(g.lengthMm - this.gate.lengthMm) > 0.5;
    this.gate = g;
    this.halfAxial = g.lengthMm / 2 + 2.5 * g.pulseSigmaMm;
    this.halfLateral = 2.5 * g.lateralSigmaMm;
    this.halfElev = 2.5 * g.elevationSigmaMm;
    this.dispNow = this.anatomy.deformation.displacement(g.center, phys.resp);
    if (moved || this.scatterers.length === 0) this.reseed(phys);
  }

  private reseed(phys: PhysiologySample): void {
    this.scatterers.length = 0;
    for (let i = 0; i < N_SCATTERERS; i++) this.scatterers.push(this.spawn(phys, null));
    this.updateComposition();
  }

  /** Posición uniforme en la caja, en coordenadas de la puerta. */
  private randomInBox(): [number, number, number] {
    return [
      this.rng.range(-this.halfAxial, this.halfAxial),
      this.rng.range(-this.halfLateral, this.halfLateral),
      this.rng.range(-this.halfElev, this.halfElev),
    ];
  }

  private gateToWorld(c: [number, number, number]): Vec3 {
    const g = this.gate!;
    return [
      g.center[0] + g.beamDir[0] * c[0] + g.lateral[0] * c[1] + g.elevation[0] * c[2],
      g.center[1] + g.beamDir[1] * c[0] + g.lateral[1] * c[1] + g.elevation[1] * c[2],
      g.center[2] + g.beamDir[2] * c[0] + g.lateral[2] * c[1] + g.elevation[2] * c[2],
    ];
  }

  private worldToGate(w: Vec3): [number, number, number] {
    const g = this.gate!;
    const dx = w[0] - g.center[0];
    const dy = w[1] - g.center[1];
    const dz = w[2] - g.center[2];
    return [
      dx * g.beamDir[0] + dy * g.beamDir[1] + dz * g.beamDir[2],
      dx * g.lateral[0] + dy * g.lateral[1] + dz * g.lateral[2],
      dx * g.elevation[0] + dy * g.elevation[1] + dz * g.elevation[2],
    ];
  }

  private makeScatterer(world: Vec3, phys: PhysiologySample): Scatterer {
    const q = this.anatomy.classifyWorld(world, phys);
    const isBlood = q.tissue === Tissue.Blood && q.bloodVelocity !== null;
    const phase = this.rng.float() * 2 * Math.PI;
    const d = this.dispNow;
    return {
      m: [world[0] - d[0], world[1] - d[1], world[2] - d[2]],
      amp: TISSUES[q.tissue].backscatter * (0.7 + 0.6 * this.rng.float()),
      phase,
      apAngle: this.rng.gaussian(),
      cr: Math.cos(phase),
      ci: Math.sin(phase),
      rotC: 1,
      rotS: 0,
      w: 0,
      vessel: q.vessel,
      isBlood,
      vBlood: q.bloodVelocity ?? [0, 0, 0],
      flowBasis: q.flowBasis ?? [0, 0, 0],
      tissue: q.tissue,
    };
  }

  /**
   * Crea un dispersor. Sin `exited`: posición uniforme en la caja. Con
   * `exited` (un dispersor que acaba de salir): reentra por el extremo opuesto
   * de SU línea de corriente (envoltura periódica a lo largo del flujo), donde
   * el peso del haz es ≈0. Así la sangre que sale de la luz vuelve a entrar en
   * la luz y no aparecen transitorios (chasquidos) en la IQ.
   *
   * La sangre reentra con SU identidad y SU base de flujo, sin reclasificar: cada dispersor
   * recorre siempre la misma cuerda de la caja (órbita cerrada) y la densidad uniforme de la
   * siembra se conserva por construcción. Antes el punto de entrada se reclasificaba y la
   * reclasificación periódica reorientaba el flujo con la tangente local: en un vaso curvo la
   * recta de vuelta ya no era la de ida, la población derivaba hacia una esquina de la caja y
   * quedaba atrapada en cuerdas tan cortas (8–32 ticks) que no volvía a reclasificarse. Con la
   * puerta quieta sobre la suprahepática del sano, en apnea, los dispersores con peso > 0,3
   * pasaban de 30 a 0 en 10 s (la señal se perdía) y las resiembras subían a 29 000/s. Si la
   * recta ya no cruza la caja (la respiración la desplazó de lado), el dispersor se resiembra en
   * un punto al azar de la caja con su identidad real.
   */
  private spawn(phys: PhysiologySample, exited: Scatterer | null): Scatterer {
    if (!exited) return this.makeScatterer(this.gateToWorld(this.randomInBox()), phys);
    const v = exited.isBlood ? exited.vBlood : this.anatomy.deformation.tissueVelocity(exited.m, phys.resp);
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (speed > 1e-6) {
      const wExit = this.worldOf(exited);
      const c = this.worldToGate(wExit);
      const dv = this.worldToGate([
        this.gate!.center[0] - v[0] / speed,
        this.gate!.center[1] - v[1] / speed,
        this.gate!.center[2] - v[2] / speed,
      ]);
      // dv es −v̂ en coordenadas de la puerta (restando el centro)
      const d = [dv[0], dv[1], dv[2]];
      const h = [this.halfAxial, this.halfLateral, this.halfElev];
      let tIn = -Infinity;
      let tOut = Infinity;
      let ok = true;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) {
          if (Math.abs(c[i]) > h[i]) ok = false;
          continue;
        }
        const t1 = (-h[i] - c[i]) / d[i];
        const t2 = (h[i] - c[i]) / d[i];
        tIn = Math.max(tIn, Math.min(t1, t2));
        tOut = Math.min(tOut, Math.max(t1, t2));
      }
      if (ok && tIn < tOut && Number.isFinite(tOut)) {
        const t = tOut - 0.02 * (tOut - Math.max(tIn, 0));
        const entry: [number, number, number] = [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
        if (exited.isBlood) return this.reenter(exited, this.gateToWorld(entry));
        // El tejido se reclasifica en el punto de entrada: con la respiración puede entrar sangre.
        return this.makeScatterer(this.gateToWorld(entry), phys);
      }
    }
    return this.makeScatterer(this.gateToWorld(this.randomInBox()), phys);
  }

  /** Dispersor nuevo (fase y amplitud nuevas) en la misma línea de corriente que `exited`. */
  private reenter(exited: Scatterer, world: Vec3): Scatterer {
    const phase = this.rng.float() * 2 * Math.PI;
    const d = this.dispNow;
    return {
      m: [world[0] - d[0], world[1] - d[1], world[2] - d[2]],
      amp: TISSUES[exited.tissue].backscatter * (0.7 + 0.6 * this.rng.float()),
      phase,
      apAngle: this.rng.gaussian(),
      cr: Math.cos(phase),
      ci: Math.sin(phase),
      rotC: 1,
      rotS: 0,
      w: 0,
      vessel: exited.vessel,
      isBlood: true,
      vBlood: [exited.vBlood[0], exited.vBlood[1], exited.vBlood[2]],
      flowBasis: exited.flowBasis,
      tissue: exited.tissue,
    };
  }

  private updateComposition(): void {
    let blood = 0;
    let art = 0;
    let wall = 0;
    const vessels: Partial<Record<VesselId, number>> = {};
    let wsum = 0;
    for (const s of this.scatterers) {
      const w = this.weight(s);
      wsum += w;
      if (s.isBlood) {
        blood += w;
        if (s.vessel && VESSEL_META[s.vessel].kind === 'artery') art += w;
        if (s.vessel) vessels[s.vessel] = (vessels[s.vessel] ?? 0) + w;
      } else if (s.tissue === Tissue.VesselWallPortal || s.tissue === Tissue.VesselWallThin || s.tissue === Tissue.ArteryWall) {
        wall += w;
      }
    }
    if (wsum > 0) {
      for (const k of Object.keys(vessels) as VesselId[]) vessels[k] = vessels[k]! / wsum;
    }
    this.composition = {
      bloodFraction: wsum > 0 ? blood / wsum : 0,
      bloodWeight: this.scatterers.length > 0 ? blood / this.scatterers.length : 0,
      arterialFraction: wsum > 0 ? art / wsum : 0,
      wallFraction: wsum > 0 ? wall / wsum : 0,
      vessels,
    };
  }

  /** Posición de un dispersor en el mundo (desplazamiento de la puerta, ver `dispNow`). */
  private worldOf(s: Scatterer): Vec3 {
    return [s.m[0] + this.dispNow[0], s.m[1] + this.dispNow[1], s.m[2] + this.dispNow[2]];
  }

  /** Peso del haz/puerta para un dispersor (en coordenadas del mundo). */
  private weight(s: Scatterer): number {
    const g = this.gate!;
    const w = this.worldOf(s);
    const dx = w[0] - g.center[0];
    const dy = w[1] - g.center[1];
    const dz = w[2] - g.center[2];
    const ax = dx * g.beamDir[0] + dy * g.beamDir[1] + dz * g.beamDir[2];
    const la = dx * g.lateral[0] + dy * g.lateral[1] + dz * g.lateral[2];
    const el = dx * g.elevation[0] + dy * g.elevation[1] + dz * g.elevation[2];
    // Ventana de puerta (caja de longitud L) suavizada por el pulso.
    const half = g.lengthMm / 2;
    const ps = Math.max(0.2, g.pulseSigmaMm);
    const axialW = 0.5 * (erf((half - ax) / (ps * Math.SQRT2)) + erf((half + ax) / (ps * Math.SQRT2)));
    const latW = Math.exp(-0.5 * (la / g.lateralSigmaMm) ** 2);
    const elW = Math.exp(-0.5 * (el / g.elevationSigmaMm) ** 2);
    return axialW * latW * elW;
  }

  /**
   * Genera `n` muestras IQ a la PRF actual con la muestra fisiológica dada y la
   * velocidad de la sonda (mm/s, mundo). Escribe en `re`/`im` desde `offset`.
   */
  generate(phys: PhysiologySample, probeVelocity: Vec3, n: number, re: Float32Array, im: Float32Array, offset = 0): void {
    const g = this.gate;
    if (!g) {
      re.fill(0, offset, offset + n);
      im.fill(0, offset, offset + n);
      return;
    }
    const dt = 1 / this.equipment.prfHz;
    const f0 = this.equipment.f0Hz;
    const bHat: Vec3 = [-g.beamDir[0], -g.beamDir[1], -g.beamDir[2]];
    const apSigma = g.apertureAngleSigmaRad ?? 0;
    const tissueVel = this.anatomy.deformation.tissueVelocity(g.center, phys.resp);
    // La deformación se evalúa en el centro de la puerta (varía lentamente).
    const disp = this.anatomy.deformation.displacement(g.center, phys.resp);
    this.dispNow = disp;
    const half = g.lengthMm / 2;
    const ps = Math.max(0.2, g.pulseSigmaMm);
    const invLat2 = 1 / (g.lateralSigmaMm * g.lateralSigmaMm);
    const invEl2 = 1 / (g.elevationSigmaMm * g.elevationSigmaMm);
    const twoPiDt = 2 * Math.PI * dt;
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      const slow = this.tick % SLOW_EVERY === 0;
      const reclass = this.tick % RECLASSIFY_EVERY === 0;
      for (let j = 0; j < this.scatterers.length; j++) {
        const s = this.scatterers[j];
        if (s.isBlood) {
          // Advección en coordenadas materiales (la sangre se mueve respecto al vaso).
          s.m[0] += s.vBlood[0] * dt;
          s.m[1] += s.vBlood[1] * dt;
          s.m[2] += s.vBlood[2] * dt;
        }
        if (slow) {
          const wx = s.m[0] + disp[0];
          const wy = s.m[1] + disp[1];
          const wz = s.m[2] + disp[2];
          const dx = wx - g.center[0];
          const dy = wy - g.center[1];
          const dz = wz - g.center[2];
          const ax = dx * g.beamDir[0] + dy * g.beamDir[1] + dz * g.beamDir[2];
          const la = dx * g.lateral[0] + dy * g.lateral[1] + dz * g.lateral[2];
          const el = dx * g.elevation[0] + dy * g.elevation[1] + dz * g.elevation[2];
          if (Math.abs(ax) > this.halfAxial || Math.abs(la) > this.halfLateral || Math.abs(el) > this.halfElev) {
            this.scatterers[j] = this.spawn(phys, s);
            continue;
          }
          if (reclass && (j + this.tick / SLOW_EVERY) % 4 === 0) {
            // Reclasificación geométrica: por la aritmética (96/8 = 12 ≡ 0 mod 4) solo alcanza a los
            // dispersores con j ≡ 0 (mod 4); ver la limitación `thin-vessel-sample-volume-lag`.
            const q = this.anatomy.classifyWorld([wx, wy, wz], phys);
            const nowBlood = q.tissue === Tissue.Blood && q.bloodVelocity !== null;
            // La sangre que sigue en su vaso conserva su dirección (órbita cerrada, ver `spawn`)
            const sameVessel = nowBlood && s.isBlood && q.vessel === s.vessel;
            if (nowBlood !== s.isBlood) {
              s.isBlood = nowBlood;
              s.tissue = q.tissue;
              s.amp = TISSUES[q.tissue].backscatter * (0.7 + 0.6 * this.rng.float());
            }
            if (!sameVessel) {
              s.vessel = q.vessel;
              s.flowBasis = q.flowBasis ?? [0, 0, 0];
            }
          }
          if (s.isBlood && s.vessel) {
            const u = phys.velocities[s.vessel];
            s.vBlood[0] = s.flowBasis[0] * u;
            s.vBlood[1] = s.flowBasis[1] * u;
            s.vBlood[2] = s.flowBasis[2] * u;
          }
          // Peso del haz/puerta: ventana axial (erf) × gaussianas lateral y elevacional.
          const axialW = 0.5 * (erf((half - ax) / (ps * Math.SQRT2)) + erf((half + ax) / (ps * Math.SQRT2)));
          s.w = axialW * Math.exp(-0.5 * (la * la * invLat2 + el * el * invEl2));
          // Velocidad relativa: sangre + tejido − sonda, proyectada sobre b̂ → fD → rotación por tick.
          const vx = (s.isBlood ? s.vBlood[0] : 0) + tissueVel[0] - probeVelocity[0];
          const vy = (s.isBlood ? s.vBlood[1] : 0) + tissueVel[1] - probeVelocity[1];
          const vz = (s.isBlood ? s.vBlood[2] : 0) + tissueVel[2] - probeVelocity[2];
          // Ensanchamiento intrínseco: cada dispersor es visto por la apertura con un
          // ángulo propio (σ = D/4r) respecto al eje del haz, dentro del plano de imagen
          const da = s.apAngle * apSigma;
          const bx = bHat[0] + g.lateral[0] * da;
          const by = bHat[1] + g.lateral[1] * da;
          const bz = bHat[2] + g.lateral[2] * da;
          const bn = 1 / Math.hypot(bx, by, bz);
          const fd = dopplerShiftHz((vx * bx + vy * by + vz * bz) * bn, f0);
          const dphi = twoPiDt * fd;
          s.rotC = Math.cos(dphi);
          s.rotS = Math.sin(dphi);
        }
        // Avance de fase por multiplicación compleja: e^{iφ} · e^{i2πfDΔt}
        const cr = s.cr * s.rotC - s.ci * s.rotS;
        const ci = s.cr * s.rotS + s.ci * s.rotC;
        s.cr = cr;
        s.ci = ci;
        const a = s.amp * s.w;
        sr += a * cr;
        si += a * ci;
      }
      // Ruido electrónico: independiente de la transmisión (no se atenúa con la profundidad).
      const nr = this.rng.gaussian() * NOISE_STD;
      const ni = this.rng.gaussian() * NOISE_STD;
      re[offset + k] = (sr * g.transmission + nr) * this.equipment.gain;
      im[offset + k] = (si * g.transmission + ni) * this.equipment.gain;
      this.tick++;
      if (this.tick % (RECLASSIFY_EVERY * 4) === 0) this.updateComposition();
    }
  }
}

/** Función error (aproximación de Abramowitz–Stegun 7.1.26, |ε| < 1,5e−7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
