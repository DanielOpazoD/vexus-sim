// @tier slow
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { torsoSkinPoint, type Torso } from '../anatomy/primitives';
import { setThoracicAtlas, thoracicValue } from '../anatomy/thoracicAtlas';
import { setAbdominalAtlas } from '../anatomy/abdominalAtlas';
import { setAbdominalBody, setReferenceBody } from '../anatomy/referenceBody';
import { startPointsFor } from '../app/startPoints';
import { gateTransmission } from '../app/gateTransmission';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../cases';
import { acquire, openSession, placeGate, probeAt, PROFILE, TR } from './support/studentChain';

const profile = (name: string): Float32Array => {
  const bytes = readFileSync(new URL('../anatomy/' + name, import.meta.url));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const reference = profile('reference-body.bin');
const abdominal = profile('abdominal-body.bin');
const raw = gunzipSync(readFileSync(new URL('../anatomy/abdominal-atlas.gzip.bin', import.meta.url)));
const atlas = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const thoracicRaw = gunzipSync(readFileSync(new URL('../anatomy/thoracic-atlas.gzip.bin', import.meta.url)));
const thoracic = new Uint16Array(thoracicRaw.buffer.slice(thoracicRaw.byteOffset, thoracicRaw.byteOffset + thoracicRaw.byteLength));
// Identidades del esqueleto registrado, independientes de la pose seleccionada.
const skeleton = JSON.parse(readFileSync(new URL('../../docs/anatomy/thoracic-atlas-manifest.json', import.meta.url), 'utf8')) as {
  meta: { parts: Array<{ label: number; name: string }> };
};
const costalLabels = new Set(
  skeleton.meta.parts.filter((p) => / (seventh|eighth|ninth|tenth) (rib|costal cartilage)$/.test(p.name)).map((p) => p.label),
);
function inferiorCostalProjection(phi: number, torso: Torso): number {
  let inferior = 0;
  for (let z = -160; z < 5; z += 1.5) {
    const skin = torsoSkinPoint(phi, z, torso);
    const dx = skin[0],
      dy = skin[1] - (torso.y0 ?? 0),
      norm = Math.hypot(dx, dy);
    for (let r = 0; r < 60; r += 2) {
      const q = thoracicValue([skin[0] - (r * dx) / norm, skin[1] - (r * dy) / norm, z]);
      if (q.d < 0.75 && costalLabels.has(q.label)) {
        inferior = Math.min(inferior, z);
        break;
      }
    }
  }
  return inferior;
}
afterEach(() => {
  setThoracicAtlas();
  setReferenceBody();
  setAbdominalBody();
  setAbdominalAtlas();
});

describe('Porta subcostal: adquisición real sobre el cuerpo completo (212–213)', () => {
  for (const model of ['legacy', 'reference', 'atlas'] as const)
    for (const base of [NORMAL_ADULT, SEVERE_CONGESTION])
      it(`${model}, ${base.id}: territorio, transmisión e IQ útiles sin desplazar órganos`, () => {
        setReferenceBody(model === 'reference' ? reference : undefined);
        setAbdominalBody(model === 'atlas' ? abdominal : undefined);
        setAbdominalAtlas(model === 'atlas' ? atlas : undefined);
        setThoracicAtlas(model === 'atlas' ? thoracic : undefined);
        const session = openSession(base, 'apnea-expiratory');
        const sp = startPointsFor(session.scene.torso).find((point) => point.id === 'portalSubcostal')!;
        // Apoyos subcostales explorados; el límite lateral es solo de este preset, nunca de navegación.
        expect(sp.phi).toBeGreaterThanOrEqual(1.4);
        expect(sp.phi).toBeLessThanOrEqual(model === 'atlas' ? 2.85 : 2.2);
        expect(sp.z).toBeGreaterThanOrEqual(-100);
        expect(sp.z).toBeLessThanOrEqual(-45);
        // 8 mm bajo la proyección inferior del reborde: evita renombrar un acceso intercostal.
        // Resolución ósea 1,5 mm; margen estimado de apoyo, no umbral clínico.
        if (model === 'atlas') expect(sp.z).toBeLessThanOrEqual(inferiorCostalProjection(sp.phi, session.scene.torso) - 8);
        const contact = probeAt(session, sp.id);
        const target = model === 'atlas' ? 'pvRight' : 'pvTrunk';
        const gate = placeGate(session, contact, [target], { maxDepthMm: 145 });
        expect(gate).not.toBeNull();
        // Atlas mejora el coseno anterior ≈0,60 a ≥0,75 en ambos pacientes. Se conserva transmisión >0,01.
        expect(gate!.cosAngle).toBeGreaterThanOrEqual(model === 'atlas' ? 0.75 : 0.5);
        expect(
          gateTransmission(
            session.anatomy,
            contact.frame,
            TR,
            contact,
            gate!.theta,
            gate!.r,
            session.engine.sample,
            PROFILE.dopplerEffectiveMHz,
          ),
        ).toBeGreaterThan(0.01);
        const { captures, track } = acquire(session, contact, gate!, 'portal', {
          prfHz: 6000,
          focusMm: 100,
          seconds: 8.5,
          gateMm: Math.min(4, 2 * gate!.bd),
          wallFilterHz: 15,
        });
        let intended = 0,
          total = 0;
        for (const sample of track)
          for (const [id, weight] of Object.entries(sample.vessels)) {
            total += weight;
            if (id === target) intended += weight;
          }
        // Misma pureza >90%: rama derecha en Atlas; tronco en los dos modelos históricos.
        expect(intended / total).toBeGreaterThan(0.9);
        const result = captures.at(-1)!.m;
        expect(result).not.toBeNull();
        expect(result!.quality.issue).toBeNull();
        if (base.id === NORMAL_ADULT.id) expect(result!.pulsatilityFraction).toBeLessThan(30);
        else expect(result!.pulsatilityFraction).toBeGreaterThan(50);
        expect(result!.vMin).toBeGreaterThan(0);
      });
});
