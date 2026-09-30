import { describe, expect, it } from 'vitest';
import { Tissue } from '../anatomy/tissues';
import { INTERFACES, Interface } from '../anatomy/interfaces';
import {
  APERTURE_GLSL,
  APERTURE_SEARCH_LINES,
  SPECULAR_PAIR_FIT,
  SPECULAR_PAIR_SLOPE,
  STEERED_APERTURE_GLSL,
  refractionBeam,
  specularPairSpread,
  type ApertureGeometry,
} from '../ultrasound/aperture';
import { BONE_ENTRY_DB } from '../ultrasound/transmission';
import {
  apertureCones,
  apertureEcho,
  apertureTransmission,
  apertureWindowIntegral,
  steeredApertureTransmission,
} from '../ultrasound/transmissionTwin';
import { CONVEX_BEAM } from '../ultrasound/beamModel';
import { COMPOUND, COMPOUND_STEER_RANGE_DEG, lookTheta } from '../ultrasound/compound';
import { CONVEX_C35 } from '../probe/probe';
import { CONVEX_C35_PROFILE, bmodeBeam } from '../ultrasound/transducerProfile';
import { GRID_GEOMETRY, lookTransmission, segmentGridFromScene } from './support/segmentGrid';

/**
 * Penumbra de la apertura (decisión 54) sobre una costilla sintética: un bloque de 20 líneas a 25 mm
 * de profundidad que no deja pasar nada. Con la geometría del convexo (192 líneas, ±34°, R 60 mm,
 * apertura 26 mm, F# 2,5), la sombra es completa bajo la costilla cerca de ella, se rellena en
 * profundidad y su borde es una rampa, no un escalón.
 */
const GEOM: ApertureGeometry = {
  lines: 192,
  halfSector: (34 * Math.PI) / 180,
  curvatureRadius: 60,
  apertureTxMm: CONVEX_BEAM.apertureTxMm,
  apertureRxMaxMm: CONVEX_BEAM.apertureRxMaxMm,
  fNumberRxMin: CONVEX_BEAM.fNumberRxMin,
  refraction: refractionBeam(bmodeBeam(CONVEX_C35_PROFILE, { harmonic: false }), 90),
};
const RIB = { from: 86, to: 105, depthMm: 25 };
const onRib = (l: number): boolean => l >= RIB.from && l <= RIB.to;
const oneWay = (r: number) => (l: number) => (onRib(l) && r > RIB.depthMm ? 0 : 1);
const obstacle = (l: number): number => (onRib(l) ? RIB.depthMm : Infinity);
const T = (line: number, r: number): number => apertureTransmission(GEOM, line, r, oneWay(r), obstacle);
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-6));

describe('penumbra de la apertura', () => {
  it('sin obstáculo por encima es un solo rayo', () => {
    expect(
      apertureTransmission(
        GEOM,
        40,
        80,
        () => 0.7,
        () => Infinity,
      ),
    ).toBeCloseTo(0.49, 12);
    // el obstáculo por debajo del punto no cuenta
    expect(T(95, 20)).toBe(1);
  });

  it('bajo la costilla la sombra es completa cerca de ella y se rellena en profundidad', () => {
    const center = (RIB.from + RIB.to) / 2;
    expect(T(Math.round(center), 35)).toBeLessThan(0.02);
    const shallow = db(T(Math.round(center), 45));
    const deep = db(T(Math.round(center), 150));
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThan(-6); // sigue siendo sombra, rellena solo en parte
  });

  it('cada cono es la integral exacta de su ventana sobre la transmisión de las líneas (decisiones 86 y 91)', () => {
    // las primitivas: la ventana de Hann de la emisión integra h en [−h, h] y la uniforme de la recepción, 2h
    for (const h of [0.3, 2.7, 17, 35]) {
      expect(apertureWindowIntegral(-h, h, h, h, true)).toBeCloseTo(h, 12);
      expect(apertureWindowIntegral(-2 * h, 2 * h, h, h, false)).toBeCloseTo(2 * h, 12);
      // la de los pares es la de emisión recortada a la recepción más estrecha
      const c = 0.6 * h;
      let num = 0;
      for (let i = 0; i < 20000; i++) {
        const x = -c + ((i + 0.5) / 20000) * 2 * c;
        num += Math.cos((Math.PI * x) / (2 * h)) ** 2 * ((2 * c) / 20000);
      }
      expect(apertureWindowIntegral(-h, h, h, c, true)).toBeCloseTo(num, 6);
    }
    // las medias, frente a la regla del punto medio muy fina sobre la transmisión constante en cada línea [l − ½, l + ½],
    // con la del borde fuera del arreglo (texelFetch con clamp) y conos más estrechos que una línea
    const rnd = (() => {
      let x = 91;
      return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
    })();
    const tLine = Array.from({ length: GEOM.lines }, () => rnd());
    const oneWayAt = (l: number) => tLine[Math.min(GEOM.lines - 1, Math.max(0, l))];
    const numeric = (line: number, h: number, c: number, hann: boolean, pair: boolean): number => {
      const n = 40000;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        const u = -c + ((i + 0.5) / n) * 2 * c;
        const w = hann ? Math.cos((Math.PI * u) / (2 * h)) ** 2 : 1;
        const t = oneWayAt(line + Math.round(u)) * (pair ? oneWayAt(line + Math.round(-u)) : 1);
        num += w * t;
        den += w;
      }
      return num / den;
    };
    for (const [line, hTx, hRx] of [
      [95, 18.3, 12.1],
      [3, 30, 30],
      [188, 7.4, 21.6],
      [60, 0.3, 0.2],
      [120, 1.4, 35],
    ]) {
      const c = apertureCones(GEOM.lines, line, hTx, hRx, oneWayAt);
      expect(c.tx, `emisión ${line}`).toBeCloseTo(numeric(line, hTx, hTx, true, false), 4);
      expect(c.rx, `recepción ${line}`).toBeCloseTo(numeric(line, hRx, hRx, false, false), 4);
      expect(c.pair, `pares ${line}`).toBeCloseTo(numeric(line, hTx, Math.min(hTx, hRx), true, true), 4);
    }
    // un cono más estrecho que una línea es el rayo de su línea
    const narrow = apertureCones(GEOM.lines, 77, 0.4, 0.3, oneWayAt);
    expect(narrow.tx).toBe(tLine[77]);
    expect(narrow.rx).toBe(tLine[77]);
    expect(narrow.pair).toBeCloseTo(tLine[77] ** 2, 15);
    // y uno de anchura nula (1 − r₀/r redondeado a 0 junto al obstáculo; revisión de la decisión 91), también: no 0
    for (const h of [0, 1e-9]) {
      const zero = apertureCones(GEOM.lines, 77, h, h, oneWayAt);
      expect(zero.tx, `h ${h}`).toBe(tLine[77]);
      expect(zero.rx, `h ${h}`).toBe(tLine[77]);
      expect(zero.pair, `h ${h}`).toBeCloseTo(tLine[77] ** 2, 15);
    }
    // la GLSL hace las mismas cuentas
    expect(APERTURE_GLSL).toContain('float apG(float y, float h) { return 0.5 * y - h * sin(3.14159265 * y / h) / 6.2831853; }');
    expect(APERTURE_GLSL).toContain(
      'return a >= 0.0 ? apG(h - a, h) - apG(h - b, h) : b <= 0.0 ? apG(h + b, h) - apG(h + a, h) : h - apG(h - b, h) - apG(h + a, h);',
    );
    expect(APERTURE_GLSL).toContain('hTx = max(hTx, 1e-4);');
    expect(APERTURE_GLSL).toContain('hRx = max(hRx, 1e-4);');
    expect(APERTURE_GLSL).toContain(
      'vec3 w = f * vec3(apW(lo, lo + 1.0, hTx, hTx, 1.0), apW(lo, lo + 1.0, hRx, hRx, 0.0), apW(lo, lo + 1.0, hTx, hP, 1.0));',
    );
    expect(APERTURE_GLSL).toContain('sum += w * vec3(a + b, a + b, 2.0 * a * b);');
    expect(APERTURE_GLSL).toContain('return apEcho(apCones(uPre0, line, k, halfTx, halfRx), r, spec);');
    expect(APERTURE_GLSL).not.toMatch(/AP_TAPS/);
  });

  it('con la emisión apodizada la costilla deja su sombra más honda en profundidad que con la uniforme', () => {
    // la misma cuenta que el gemelo con la emisión uniforme (la penumbra de antes de la decisión 86): el cono de emisión
    // con la ventana de la recepción
    const uniformTx = (line: number, r: number): number => {
      const dTheta = (2 * GEOM.halfSector) / GEOM.lines;
      const ro = RIB.depthMm;
      const spacing = (GEOM.curvatureRadius + ro) * dTheta;
      const shrink = 1 - ro / r;
      const hTx = (0.5 * GEOM.apertureTxMm * shrink) / spacing;
      const hRx = (0.5 * Math.min(GEOM.apertureRxMaxMm, r / GEOM.fNumberRxMin) * shrink) / spacing;
      return apertureCones(GEOM.lines, line, hTx, hTx, oneWay(r)).rx * apertureCones(GEOM.lines, line, hRx, hRx, oneWay(r)).rx;
    };
    const center = Math.round((RIB.from + RIB.to) / 2);
    for (const r of [60, 90, 150]) {
      // el borde de la apertura, que la ventana apenas usa, ya no rellena el centro de la sombra como su centro
      expect(db(T(center, r)), `${r} mm`).toBeLessThan(db(uniformTx(center, r)) - 3);
      // lejos de la costilla, igual: sin obstáculo en el cono no hay nada que pesar
      expect(T(center + 60, r)).toBe(1);
    }
  });

  it('la penumbra es continua (decisión 91): sin los escalones de las tomas en líneas enteras, entre líneas ni en profundidad', () => {
    // Nueve tomas en líneas enteras (decisiones 54 y 86) hacían la media a saltos: cada toma que cruzaba el borde de la
    // costilla movía la media su peso (hasta 0,22 con la ventana de Hann), en una línea y en toda la profundidad (las
    // costuras de la VCI del flanco, ronda 5 del juez ciego), y otra vez al abrirse el cono en profundidad
    const taps = (line: number, r: number): number => {
      const dTheta = (2 * GEOM.halfSector) / GEOM.lines;
      const spacing = (GEOM.curvatureRadius + RIB.depthMm) * dTheta;
      const shrink = 1 - RIB.depthMm / r;
      const mean = (h: number, hann: boolean) => {
        let sum = 0;
        let ws = 0;
        for (let j = 0; j < 9; j++) {
          const t = (j + 0.5) / 9 - 0.5;
          const w = hann ? Math.cos(Math.PI * t) ** 2 : 1;
          sum += w * oneWay(r)(line + Math.floor(2 * h * t + 0.5));
          ws += w;
        }
        return sum / ws;
      };
      return (
        mean((0.5 * GEOM.apertureTxMm * shrink) / spacing, true) *
        mean((0.5 * Math.min(GEOM.apertureRxMaxMm, r / GEOM.fNumberRxMin) * shrink) / spacing, false)
      );
    };
    // entre líneas vecinas la media no cambia más que lo que pesa una línea en las ventanas: 1/h la de Hann y 1/(2h) la
    // uniforme, con h el cono más estrecho
    const worst = (f: (l: number, r: number) => number) => {
      let lateral = 0;
      let depth = 0;
      for (let r = 60; r <= 170; r += 2.5) {
        const spacing = (GEOM.curvatureRadius + RIB.depthMm) * ((2 * GEOM.halfSector) / GEOM.lines);
        const h = (0.5 * Math.min(GEOM.apertureTxMm, GEOM.apertureRxMaxMm, r / GEOM.fNumberRxMin) * (1 - RIB.depthMm / r)) / spacing;
        for (let l = 40; l < 150; l++) lateral = Math.max(lateral, (Math.abs(f(l + 1, r) - f(l, r)) * h) / 1.5);
      }
      for (let l = 60; l <= 130; l++) for (let r = 60; r < 170; r += 0.25) depth = Math.max(depth, Math.abs(f(l, r + 0.25) - f(l, r)));
      return { lateral, depth };
    };
    const now = worst(T);
    expect(now.lateral).toBeLessThanOrEqual(1);
    expect(now.depth).toBeLessThan(0.01);
    // con las tomas: 2,8 veces esa cota entre líneas y saltos de 0,2 en un cuarto de milímetro
    const before = worst(taps);
    expect(before.lateral).toBeGreaterThan(2);
    expect(before.depth).toBeGreaterThan(0.1);
  });

  it('el borde de la sombra es una rampa del ancho del cono, no un escalón de una línea', () => {
    // a 90 mm el cono sobre la costilla (25 mm) mide ±18 líneas: el perfil empieza fuera de él
    const r = 90;
    const profile = Array.from({ length: 40 }, (_, i) => T(RIB.from - 25 + i, r));
    // fuera del cono: sin sombra; dentro, en el centro: la más honda
    expect(profile[0]).toBeGreaterThan(0.95);
    const min = Math.min(...profile);
    expect(min).toBeLessThan(0.3);
    // al menos 5 líneas intermedias entre el 90 % y el 10 % del salto (una sombra de un solo rayo tiene 0)
    const hi = 1 - 0.1 * (1 - min);
    const lo = min + 0.1 * (1 - min);
    expect(profile.filter((x) => x < hi && x > lo).length).toBeGreaterThanOrEqual(5);
    // monótona hasta el mínimo (entrando en la sombra)
    const iMin = profile.indexOf(min);
    for (let i = 1; i <= iMin; i++) expect(profile[i]).toBeLessThanOrEqual(profile[i - 1] + 1e-12);
  });

  it('en float32, el peso de la última loncha de la ventana de Hann sale de su borde (apG) sin la cancelación de la primitiva', () => {
    // Revisión de la decisión 91: con 0,5·(b − a) + (sin(q·b) − sin(q·a))/(2q), la última loncha parcial de un cono (peso
    // ~10⁻⁵) es la resta de dos senos ≈ 1 dividida por 2q, pequeño: 6–12 % de error en float32 con seno correctamente
    // redondeado, que domina la media de los pares bajo la costilla (5·10⁻³ dB, la mitad de la tolerancia de la e2e).
    // Desde el borde, ∫ sin²(π·t/(2h)) de 0 a y, el seno es de un ángulo pequeño: ≤ 0,34 %
    const f = Math.fround;
    const sin32 = (x: number) => f(Math.sin(f(x)));
    const g32 = (y: number, h: number) => f(f(0.5 * y) - f(f(h * sin32(f(f(3.14159265 * y) / h))) / f(6.2831853)));
    const primitive32 = (a: number, b: number, h: number) => {
      const q = f(f(3.14159265) / h);
      return f(f(0.5 * f(b - a)) + f(f(sin32(f(q * b)) - sin32(f(q * a))) / f(2 * q)));
    };
    let worstNow = 0;
    let worstBefore = 0;
    for (const h of [20.67, 27.66, 34.67]) {
      const lo = Math.round(h) - 0.5;
      const exact = apertureWindowIntegral(lo, lo + 1, h, h, true);
      expect(exact, `h ${h}`).toBeLessThan(1e-4);
      worstNow = Math.max(worstNow, Math.abs(f(g32(f(h - lo), h) - g32(0, h)) - exact) / exact);
      worstBefore = Math.max(worstBefore, Math.abs(primitive32(lo, h, h) - exact) / exact);
    }
    expect(worstNow).toBeLessThan(5e-3);
    expect(worstBefore).toBeGreaterThan(5e-2);
  });

  it('con el foco somero (emisión de 8–12 mm) el obstáculo se busca hasta la recepción, más ancha: la penumbra sigue continua', () => {
    // Revisión de la decisión 91: la búsqueda llegaba solo a D_tx/2. Con el foco a 20–30 mm la emisión mide 8–12 mm y la
    // recepción hasta 26: una costilla dentro de la recepción pero fuera de la búsqueda no contaba, y al entrar en ella la
    // transmisión saltaba de la del rayo a la del cono (un borde de una línea a 11 líneas de la costilla)
    const dTheta = (2 * GEOM.halfSector) / GEOM.lines;
    for (const dTx of [8, 10, 12]) {
      const g = { ...GEOM, apertureTxMm: dTx };
      const wTx = Math.ceil((0.5 * dTx) / (GEOM.curvatureRadius * dTheta));
      const now = (l: number, r: number) => apertureTransmission(g, l, r, oneWay(r), obstacle);
      const before = (l: number, r: number) =>
        apertureTransmission(g, l, r, oneWay(r), (m) => (Math.abs(m - l) <= wTx ? obstacle(m) : Infinity));
      // el paso entre líneas vecinas frente a lo que pesa una línea en las dos ventanas: 1/h_tx la de Hann y 1/(2h_rx) la uniforme
      const worst = (f: (l: number, r: number) => number) => {
        let w = 0;
        for (let r = 40; r <= 170; r += 5) {
          const spacing = (GEOM.curvatureRadius + RIB.depthMm) * dTheta;
          const shrink = 1 - RIB.depthMm / r;
          const hTx = (0.5 * dTx * shrink) / spacing;
          const hRx = (0.5 * Math.min(GEOM.apertureRxMaxMm, r / GEOM.fNumberRxMin) * shrink) / spacing;
          for (let l = 40; l < 150; l++) w = Math.max(w, Math.abs(f(l + 1, r) - f(l, r)) / (1 / hTx + 1 / (2 * hRx)));
        }
        return w;
      };
      expect(worst(now), `D_tx ${dTx} mm`).toBeLessThanOrEqual(0.7);
      if (dTx <= 10) expect(worst(before), `D_tx ${dTx} mm, búsqueda de la emisión`).toBeGreaterThan(1.2);
    }
  });

  it('la búsqueda del obstáculo y la integral de los conos (AP_SEARCH) cubren el mayor cono de todas las miradas', () => {
    // el cono más ancho es la mayor de las aperturas a la cara, D/2 / (R·cos θ·dθ) líneas (el obstáculo en la cara y el
    // punto en el fondo): con la mirada más dirigida del rango del compuesto, en fundamental y en armónica
    const dTheta = (2 * CONVEX_C35.halfSector) / CONVEX_C35.lines;
    let widest = 0;
    for (const harmonic of [false, true]) {
      const b = bmodeBeam(CONVEX_C35_PROFILE, { harmonic });
      for (const deg of [0, ...COMPOUND_STEER_RANGE_DEG]) {
        const rc = CONVEX_C35.curvatureRadius * Math.cos((deg * Math.PI) / 180);
        widest = Math.max(widest, (0.5 * Math.max(b.apertureTxMm, b.apertureRxMaxMm)) / (rc * dTheta));
      }
    }
    // 35,4 líneas con 8°: el bucle llega a la línea 40, cuyo intervalo empieza en 39,5
    expect(widest).toBeGreaterThan(35);
    expect(Math.ceil(widest)).toBeLessThanOrEqual(APERTURE_SEARCH_LINES - 2);
  });
});

/**
 * Transmisión de los ecos especulares (decisión 91): la de los pares de la apertura (el rayo de emisión por u vuelve por
 * −u) mezclada con la de la apertura según lo que las facetas de la cara reparten lo reflejado. Sustituye a la regla del
 * rayo central de la decisión 88, que apagaba en toda la profundidad la especular de las líneas cuyo rayo cruzaba el hueso
 * (la pared anterior de la VCI rota, 8 cm bajo una costilla, en la ronda 5 del juez ciego).
 */
describe('transmisión de los ecos especulares (decisión 91)', () => {
  const E = (line: number, r: number) => apertureEcho(GEOM, line, r, oneWay(r), obstacle);
  /** La regla de la decisión 88: a lo sumo el rayo central. */
  const centralRay = (line: number, r: number) => Math.min(E(line, r).diffuse, oneWay(r)(line) ** 2);

  it('lejos de todo obstáculo, la del rayo; junto a la costilla, la de su rayo central; desde D/(k·s), la de la apertura', () => {
    expect(
      apertureEcho(
        GEOM,
        40,
        80,
        () => 0.7,
        () => Infinity,
      ),
    ).toEqual({ diffuse: 0.7 ** 2, specular: 0.7 ** 2 });
    // 3 mm bajo la costilla el cono cruza ±3 líneas de ella: dentro, a más de eso del borde, ni los pares ni la apertura
    // devuelven nada (la pleura y el peritoneo bajo el hueso, decisión 88); fuera, a más de eso, la del rayo
    for (let l = RIB.from + 4; l <= RIB.to - 4; l++) expect(db(E(l, RIB.depthMm + 3).specular), `línea ${l}`).toBeLessThan(-40);
    for (const l of [RIB.from - 5, RIB.to + 5]) expect(E(l, RIB.depthMm + 3).specular).toBe(1);
    // ρ = min(1, k·s·r/D): desde 62 mm con la cara más lisa de la tabla, la especular es la del moteado
    const rFull = GEOM.apertureTxMm / (SPECULAR_PAIR_FIT * SPECULAR_PAIR_SLOPE);
    expect(rFull).toBeGreaterThan(55);
    expect(rFull).toBeLessThan(70);
    expect(specularPairSpread(rFull + 0.1, GEOM.apertureTxMm)).toBe(1);
    for (let l = 60; l <= 130; l += 3)
      for (const r of [70, 110, 160]) expect(E(l, r).specular, `línea ${l}, ${r} mm`).toBeCloseTo(E(l, r).diffuse, 14);
  });

  it('dentro del borde de la costilla, donde los pares no llegan, es ρ por la de la apertura: se apaga en 1–2 mm, no en una línea', () => {
    // Revisión de la decisión 91: la regla del rayo central (88) apagaba del todo la especular de toda línea cuyo rayo
    // cruza el hueso. Ahora, en las primeras líneas dentro del borde, los pares (u por un lado, −u por el hueso) no
    // devuelven nada y queda la parte que las facetas reparten, ρ·T_ap: −22/−35 dB a 0,26/0,79 mm dentro del borde, 6 mm
    // bajo la costilla; el banco de ondas de la decisión 88 da −14 dB a 1 mm dentro y 1,2 mm bajo ella
    const spacing = (GEOM.curvatureRadius + RIB.depthMm) * ((2 * GEOM.halfSector) / GEOM.lines);
    for (const dr of [6, 10]) {
      const r = RIB.depthMm + dr;
      const rho = specularPairSpread(r, GEOM.apertureTxMm);
      expect(rho, `${r} mm`).toBeGreaterThan(0.4);
      expect(rho, `${r} mm`).toBeLessThan(0.6);
      const inside: number[] = [];
      for (let l = RIB.from; l <= RIB.from + 5; l++) {
        const e = E(l, r);
        const tag = `línea ${l} (${((l - RIB.from + 0.5) * spacing).toFixed(2)} mm dentro), ${r} mm`;
        // los pares, 0: la especular es ρ·T_ap, por debajo de la difusa y por encima de la regla del rayo central (0)
        expect(e.specular, tag).toBeCloseTo(rho * e.diffuse, 14);
        expect(centralRay(l, r), tag).toBe(0);
        inside.push(db(e.specular));
      }
      // del borde hacia dentro baja, y a 2,4 mm ya no se ve
      expect(inside[0], `${r} mm`).toBeGreaterThan(-25);
      expect(inside[0], `${r} mm`).toBeLessThan(-15);
      for (let i = 1; i < inside.length; i++) expect(inside[i]).toBeLessThanOrEqual(inside[i - 1]);
      expect(inside[4], `${r} mm`).toBeLessThan(-40);
    }
  });

  it('en profundidad la especular es continua a través de las líneas de la costilla: sin el hueco de la pared de la VCI', () => {
    // el paso entre líneas vecinas, frente a lo que pesa una línea en la ventana del cono más estrecho (como la penumbra)
    const worst = (f: (l: number, r: number) => number) => {
      let lateral = 0;
      for (let r = 60; r <= 170; r += 2.5) {
        const spacing = (GEOM.curvatureRadius + RIB.depthMm) * ((2 * GEOM.halfSector) / GEOM.lines);
        const h = (0.5 * Math.min(GEOM.apertureTxMm, GEOM.apertureRxMaxMm, r / GEOM.fNumberRxMin) * (1 - RIB.depthMm / r)) / spacing;
        for (let l = 40; l < 150; l++) lateral = Math.max(lateral, (Math.abs(f(l + 1, r) - f(l, r)) * h) / 1.5);
      }
      return lateral;
    };
    expect(worst((l, r) => E(l, r).specular)).toBeLessThanOrEqual(1);
    // la regla del rayo central: 0 en las líneas de la costilla hasta el fondo, con bordes de una línea
    expect(worst(centralRay)).toBeGreaterThan(3);
    expect(centralRay(Math.round((RIB.from + RIB.to) / 2), 110)).toBe(0);
    expect(db(E(Math.round((RIB.from + RIB.to) / 2), 110).specular)).toBeGreaterThan(-30);
  });

  it('la mezcla sigue a la suma doble con el lóbulo de las facetas (rms ≤ 0,8 dB) y la regla del rayo central no (decisión 91)', () => {
    // La suma doble: el rayo de emisión por u (ventana de Hann) vuelve por v con el núcleo gaussiano de los pares,
    // exp(−(u + v)²/(2τ²)), τ = 2s·(r − r₀) en líneas a la profundidad del obstáculo, sobre la recepción uniforme
    const ribs = [
      { from: 86, to: 105, d: 25 },
      { from: 90, to: 99, d: 20 },
      { from: 80, to: 110, d: 30 },
      { from: 88, to: 101, d: 45 },
    ];
    let sumsq = 0;
    let n = 0;
    let worst = 0;
    let raySq = 0;
    for (const rib of ribs) {
      const on = (l: number) => l >= rib.from && l <= rib.to;
      const spacing = (GEOM.curvatureRadius + rib.d) * ((2 * GEOM.halfSector) / GEOM.lines);
      for (const r of [rib.d + 3, rib.d + 6, rib.d + 10, rib.d + 20, rib.d + 40, 90, 130]) {
        const ow = (l: number) => (on(l) && r > rib.d ? 0 : 1);
        const shrink = 1 - rib.d / r;
        const hTx = (0.5 * GEOM.apertureTxMm * shrink) / spacing;
        const hRx = (0.5 * Math.min(GEOM.apertureRxMaxMm, r / GEOM.fNumberRxMin) * shrink) / spacing;
        const tau = (2 * SPECULAR_PAIR_SLOPE * (r - rib.d)) / spacing;
        for (let l = rib.from - 25; l <= rib.to + 25; l += 2) {
          const N = 160;
          let num = 0;
          let den = 0;
          for (let i = 0; i < N; i++) {
            const u = -hTx + ((i + 0.5) / N) * 2 * hTx;
            const wu = Math.cos((Math.PI * u) / (2 * hTx)) ** 2;
            const tu = ow(Math.round(l + u));
            for (let j = 0; j < N; j++) {
              const v = -hRx + ((j + 0.5) / N) * 2 * hRx;
              const g = wu * Math.exp(-0.5 * ((u + v) / tau) ** 2);
              num += g * tu * ow(Math.round(l + v));
              den += g;
            }
          }
          const exact = num / den;
          const got = apertureEcho(GEOM, l, r, ow, (m) => (on(m) ? rib.d : Infinity));
          const ray = Math.min(got.diffuse, ow(l));
          // por debajo de −40 dB no se ve
          if (Math.max(exact, got.specular) < 0.01) continue;
          const e = Math.abs(db(got.specular) - db(exact));
          sumsq += e * e;
          raySq += (db(ray) - db(exact)) ** 2;
          worst = Math.max(worst, e);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(Math.sqrt(sumsq / n)).toBeLessThan(0.8);
    expect(worst).toBeLessThan(5.5);
    expect(Math.sqrt(raySq / n)).toBeGreaterThan(20);
  });

  it('la pendiente de las facetas es la de la cara más lisa de la tabla, y la GLSL lleva la mezcla y su lectura en B', () => {
    const slopes = Object.values(INTERFACES)
      .filter((p) => p !== INTERFACES[Interface.None])
      .map((p) => p.slopeRms);
    expect(SPECULAR_PAIR_SLOPE).toBe(Math.min(...slopes));
    // fijada: una cara más lisa alargaría los pares en profundidad (revisar la decisión 91)
    expect(SPECULAR_PAIR_SLOPE).toBe(0.14);
    expect(APERTURE_GLSL).toContain('spec = mix(c.z, t, min(1.0, 0.42 * r / uAperture.x));');
  });
});

/**
 * Penumbra y refuerzo de las miradas dirigidas (decisión 58, T4), con los gemelos de producción: la
 * rejilla de segmentos de A1 de una escena 2D, el prefijo dirigido de A2 (`steeredPrefixDb`) y el cono de
 * la pasada A sobre los caminos dirigidos (`steeredApertureTransmission`). El compuesto de transmisiones
 * es su media lineal (la media de las envolventes de miradas con el mismo moteado medio).
 */
describe('penumbra y refuerzo de las miradas dirigidas (decisión 58)', () => {
  const AP: ApertureGeometry = { ...GEOM, lines: GRID_GEOMETRY.lines, halfSector: GRID_GEOMETRY.halfSector };
  const F = CONVEX_C35_PROFILE.bEffectiveMHz;
  const TH = lookTheta(1, COMPOUND);
  const liver = segmentGridFromScene(() => Tissue.Liver, F);
  const step = liver.stepMm;
  const rowOf = (r: number) => Math.round(r / step - 0.5);
  /** Transmisión de las tres miradas y del compuesto, respecto al hígado sin obstáculo (dB por línea). */
  function looksDb(scene: ReturnType<typeof segmentGridFromScene>, k: number): { look0: number[]; compound: number[] } {
    const [t0, tp, tm] = [0, TH, -TH].map((th) => lookTransmission(scene, AP, th, k));
    const [r0, rp, rm] = [0, TH, -TH].map((th) => lookTransmission(liver, AP, th, k));
    return {
      look0: Array.from(t0, (t, l) => db(t / r0[l])),
      compound: Array.from(t0, (t, l) => db((t + tp[l] + tm[l]) / (r0[l] + rp[l] + rm[l]))),
    };
  }
  const median = (a: readonly number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
  };

  it('con θ = 0 es la penumbra de la decisión 54, exactamente, en toda la rejilla', () => {
    let worst = 0;
    for (let line = 0; line < GEOM.lines; line++)
      for (let r = 2; r <= 180; r += 4) {
        const a = apertureTransmission(GEOM, line, r, oneWay(r), obstacle);
        const b = steeredApertureTransmission(GEOM, 0, line, r, oneWay(r), obstacle);
        worst = Math.max(worst, Math.abs(db(a) - db(b)));
      }
    expect(worst).toBe(0);
    // y la cadena de la GPU (A1 → A2 dirigido → A) con θ = 0 es la de hoy (A1 → A2 → A)
    const rib = segmentGridFromScene((x, z) => (Math.abs(x) < 6 && z > 18 && z < 26 ? Tissue.Bone : Tissue.Liver), F);
    for (const k of [10, 25, 40, 80, 150]) {
      const t = lookTransmission(rib, AP, 0, k);
      const r = (k + 0.5) * step;
      const hits = (l: number) => {
        for (let s = 0; s < rib.rows; s++) if (rib.bone[l * rib.rows + s]) return (s + 0.5) * step;
        return Infinity;
      };
      const pre = (l: number) => {
        let d = 0;
        let bone = false;
        for (let s = 0; s <= k; s++) {
          const i = l * rib.rows + s;
          if (rib.bone[i] && !bone) {
            d += BONE_ENTRY_DB;
            bone = true;
          }
          d += rib.db[i];
        }
        return Math.pow(10, -d / 40);
      };
      for (let l = 0; l < AP.lines; l++) expect(t[l]).toBe(apertureTransmission(AP, l, r, pre, hits));
    }
  });

  it('costilla de 12 mm a 18 mm: la umbra (−40 dB) acaba 2–6 mm antes y el núcleo sigue en el suelo', () => {
    const rib = segmentGridFromScene((x, z) => (Math.abs(x) < 6 && z > 18 && z < 26 ? Tissue.Bone : Tissue.Liver), F);
    const core = [94, 95, 96, 97];
    const rows: { behind: number; look0: number; compound: number }[] = [];
    for (let k = rowOf(26); k <= rowOf(80); k++) {
      const d = looksDb(rib, k);
      rows.push({
        behind: (k + 0.5) * step - 18,
        look0: median(core.map((l) => d.look0[l])),
        compound: median(core.map((l) => d.compound[l])),
      });
    }
    // fin de la umbra: donde el núcleo (mediana de las líneas centrales) sube de −40 dB, interpolado en dB
    const umbraEnd = (key: 'look0' | 'compound') => {
      for (let i = 1; i < rows.length; i++)
        if (rows[i - 1][key] < -40 && rows[i][key] >= -40)
          return rows[i - 1].behind + ((-40 - rows[i - 1][key]) / (rows[i][key] - rows[i - 1][key])) * step;
      return Number.NaN;
    };
    const u0 = umbraEnd('look0');
    const uc = umbraEnd('compound');
    // el gemelo del juez 1 (rib-cliff.ts) daba de 26–28 (mirada 0) a 22–24 mm (compuesto) tras la cara de la costilla con
    // la emisión uniforme; con su ventana de Hann (decisión 86) la umbra dura más: 34,6 mm en la mirada 0 y 31,1 con el
    // compuesto
    expect(u0).toBeGreaterThan(30);
    expect(u0).toBeLessThan(39);
    expect(u0 - uc).toBeGreaterThanOrEqual(2);
    expect(u0 - uc).toBeLessThanOrEqual(6);
    // núcleo: mediana de 10 a 40 mm tras la cara sobre el suelo de ruido de la GPU (K6: 22,6 dB bajo el
    // hígado, suma de potencias); el compuesto no rellena la sombra (22,6 → 22,2 dB)
    const FLOOR_DB = -22.6;
    const onFloor = (d: number) => 10 * Math.log10(10 ** (d / 10) + 10 ** (FLOOR_DB / 10));
    const win = rows.filter((q) => q.behind >= 10 && q.behind <= 40);
    const c0 = median(win.map((q) => onFloor(q.look0)));
    const cc = median(win.map((q) => onFloor(q.compound)));
    expect(Math.abs(cc - c0)).toBeLessThanOrEqual(1);
    expect(cc).toBeLessThanOrEqual(-20);
  });

  it('refuerzo tras un vaso de 12 mm a 60 mm: el borde se ensancha en profundidad y el pico apenas baja', () => {
    // la geometría del compuesto sobre el refuerzo de la atenuación: sin el camino de más de la luz, cuya refracción
    // (decisión 86, 0,2–0,6 dB tras un vaso) se prueba aparte (`refraction.test.ts`)
    const vessel = segmentGridFromScene((x, z) => (Math.hypot(x, z - 60) < 6 ? Tissue.Blood : Tissue.Liver), F);
    vessel.excess.fill(0);
    const span = Array.from({ length: 61 }, (_, i) => 66 + i);
    const edge = (d: readonly number[], r: number) => {
      const p = span.map((l) => d[l]);
      const base = p[0];
      const peak = Math.max(...p);
      const iPk = p.indexOf(peak);
      const at = (f: number) => {
        const t = base + f * (peak - base);
        for (let i = 0; i < iPk; i++) if (p[i] <= t && p[i + 1] > t) return i + (t - p[i]) / (p[i + 1] - p[i]);
        return Number.NaN;
      };
      return {
        peakDb: peak - base,
        widthMm: (at(0.9) - at(0.1)) * (GRID_GEOMETRY.curvatureRadius + r) * ((2 * GRID_GEOMETRY.halfSector) / GRID_GEOMETRY.lines),
      };
    };
    for (const [rTarget, widen] of [
      [110, 1.15],
      [150, 1.35],
    ] as const) {
      const k = rowOf(rTarget);
      const r = (k + 0.5) * step;
      const d = looksDb(vessel, k);
      const e0 = edge(d.look0, r);
      const ec = edge(d.compound, r);
      // refuerzo de un solo rayo por mirada (como hoy en la pasada A), por su propio camino
      expect(e0.peakDb).toBeGreaterThan(2);
      expect(ec.widthMm / e0.widthMm, `borde 10–90 % a ${rTarget} mm`).toBeGreaterThanOrEqual(widen);
      expect(e0.peakDb - ec.peakDb, `pico a ${rTarget} mm`).toBeLessThanOrEqual(0.3);
      expect(e0.peakDb - ec.peakDb, `pico a ${rTarget} mm`).toBeGreaterThanOrEqual(0);
    }
  });

  it('el GLSL dirigido es el cono de la pasada A con el prefijo dirigido y el radio R·cos θ', () => {
    // los conos son los de la mirada 0 (`apCones`, con su ventana de emisión, y `apEcho`, con la especular) sobre el prefijo
    // dirigido, a la distancia del camino
    expect(STEERED_APERTURE_GLSL).toContain('return apEcho(apCones(uPreSteer, line, k, halfTx, halfRx), s, spec);');
    expect(APERTURE_GLSL).toContain('float a = pow(10.0, -texelFetch(pre, ivec2(clamp(line + d, 0, last), k), 0).x / 40.0);');
    expect(STEERED_APERTURE_GLSL).toContain('float maxHalf = (0.5 * max(uAperture.x, uAperture.y)) / (rc * dTheta);');
    expect(APERTURE_GLSL).toContain('float maxHalf = (0.5 * max(uAperture.x, uAperture.y)) / (uCurvR * dTheta);');
    expect(STEERED_APERTURE_GLSL).toContain('float halfRx = 0.5 * min(uAperture.y, s / uAperture.z) * shrink / spacing;');
    // usa la búsqueda y el cono de APERTURE_GLSL, que va delante
    expect(STEERED_APERTURE_GLSL).toContain('AP_SEARCH');
    expect(APERTURE_GLSL).toContain('const int AP_SEARCH');
    expect(STEERED_APERTURE_GLSL).not.toMatch(/APERTURE_SEARCH_LINES/);
  });
});
