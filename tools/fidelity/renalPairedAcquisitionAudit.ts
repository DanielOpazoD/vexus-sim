/** Research-only probe-plane comparison. Signal remains the production IQ chain. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { NORMAL_ADULT, SEVERE_CONGESTION } from '../../src/cases';
import { AnatomyScene } from '../../src/anatomy/scene';
import { AnatomyQuery } from '../../src/anatomy/query';
import { setReferenceBody } from '../../src/anatomy/referenceBody';
import { PhysiologyEngine } from '../../src/physiology/engine';
import { INTERLOBAR_FLOW_SHARE, type VesselId } from '../../src/physiology/vessels';
import { startPointsFor } from '../../src/app/startPoints';
import { bestGateOnVessel } from '../../src/app/gatePlacement';
import { acousticWindowWeight } from '../../src/app/gateTransmission';
import { pwGate } from '../../src/app/pwGate';
import { probeContact } from '../../src/probe/contact';
import { CONVEX_C35_PROFILE } from '../../src/ultrasound/transducerProfile';
import { DEFAULT_BMODE } from '../../src/ultrasound/renderer';
import { PwDopplerChain } from '../../src/doppler/pwChain';
import { captureProtocolVessel } from '../../src/doppler/capture';
import { prfFromNyquistCms } from '../../src/core/units';
import { median } from '../../src/core/series';
import { captureNoiseFloorsDb, halfPlaneEnvelopeHz } from '../../src/doppler/spectral';
import { flowBandMinHz } from '../../src/doppler/measureQuality';
import { velocityFromShiftMmS } from '../../src/core/units';
const data = readFileSync('src/anatomy/reference-body.bin');
const reference = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
const mode = process.argv[2] ?? 'baseline';
if (!['baseline', 'plane', 'edge'].includes(mode)) throw new Error('Choose baseline, plane, or edge');
const poses: readonly (readonly [number, 'Vein' | 'Artery'])[] =
  mode === 'baseline'
    ? [
        [0, 'Vein'],
        [-2, 'Artery'],
        [-4, 'Artery'],
      ]
    : [
        [0, 'Vein'],
        [-0.5, 'Vein'],
        [-1, 'Vein'],
        [-1.5, 'Vein'],
        [-2, 'Vein'],
        [-2, 'Artery'],
      ];
const results = [];
for (const useReference of [false, true]) {
  setReferenceBody(useReference ? reference : undefined);
  for (const base of [NORMAL_ADULT, SEVERE_CONGESTION]) {
    const patient = { ...base, respiratoryPattern: 'apnea-expiratory' as const };
    const scene = new AnatomyScene(patient),
      engine = new PhysiologyEngine(patient, scene.vesselAreas());
    for (let i = 0; i < 7500; i++) engine.step();
    const initial = engine.sample,
      samples = Array.from({ length: 2000 }, () => engine.step());
    for (const [tiltDeltaDeg, kind] of poses) {
      const query = new AnatomyQuery(new AnatomyScene(patient));
      const profile = CONVEX_C35_PROFILE,
        tr = profile.geometry;
      const sp = startPointsFor(query.scene.torso).find((p) => p.id === 'renal')!;
      const contact = probeContact(
        { phi: sp.phi, z: sp.z, yaw: sp.yaw, rock: sp.rock ?? 0, tilt: (sp.tilt ?? 0) + (tiltDeltaDeg * Math.PI) / 180, lift: 0 },
        tr,
        query.scene.torso,
      );
      query.setProbeCompression(contact);
      const weight = acousticWindowWeight(query, contact.frame, tr, contact, initial, DEFAULT_BMODE.depthMm, profile.dopplerEffectiveMHz);
      const vessels = [1, 2, 3].map((i) => `interlobar${kind}${i}` as VesselId);
      const best = bestGateOnVessel(
        query,
        contact.frame,
        tr,
        initial,
        vessels,
        175,
        kind === 'Vein' && mode !== 'edge' ? 1.2 : 0.2,
        weight,
      );
      if (!best) {
        results.push({ useReference, case: patient.id, tiltDeltaDeg, kind, noGate: true });
        continue;
      }
      const chain = new PwDopplerChain(query, patient.seed),
        track = [];
      let info;
      for (const [i, s] of samples.entries()) {
        chain.begin(prfFromNyquistCms(50, tr.f0Doppler), tr.f0Doppler, 0, 25, s.t);
        if (i % 8 === 0) {
          const g = pwGate(
            query,
            contact.frame,
            contact,
            profile,
            DEFAULT_BMODE.focusMm,
            { theta: best.theta, depthMm: best.r, gateMm: 4 },
            s,
          );
          chain.setGate(g.gate, s);
          info = g.info;
        }
        chain.step(s, [0, 0, 0], engine.clock.dt);
        chain.flush();
        track.push({ t: s.t, vessels: { ...chain.sampleVolume.lastComposition.vessels } });
      }
      const m = captureProtocolVessel(
        'renal',
        chain.spectral.columns,
        engine.rhythm,
        samples.at(-1)!.t,
        { f0Hz: tr.f0Doppler, angleCorrectionRad: 0, invert: false, fftSize: 128, wallFilterHz: 25, gainDb: 0 },
        track,
      );
      const db = chain.spectral.columns
        .filter((c) => c.t > 34)
        .map((c) => 10 * Math.log10([...c.powerDb].slice(84, 122).reduce((s, x) => s + 10 ** (x / 10), 0)));
      const columns = chain.spectral.columns.filter((c) => c.t > 33);
      const floors = captureNoiseFloorsDb(columns);
      const envelopes = columns.map((c, i) => ({
        t: c.t,
        artery:
          velocityFromShiftMmS(
            halfPlaneEnvelopeHz(c, c.powerDb.length, floors[i], 1, flowBandMinHz(25, c.prfHz, c.powerDb.length), 12),
            tr.f0Doppler,
            0,
          ) / 10,
        vein:
          velocityFromShiftMmS(
            halfPlaneEnvelopeHz(c, c.powerDb.length, floors[i], -1, flowBandMinHz(25, c.prfHz, c.powerDb.length), 12),
            tr.f0Doppler,
            0,
          ) / 10,
      }));
      const quantile = (values: number[], q: number) => {
        const v = values.filter(Number.isFinite).sort((a, b) => a - b);
        return v[Math.round(q * (v.length - 1))] ?? null;
      };
      const arterialPeakCms = quantile(
        envelopes.map((x) => x.artery),
        0.97,
      );
      const venousPeakCms = quantile(
        envelopes.map((x) => x.vein),
        0.97,
      );
      const summary = (v: number[]) => ({ min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length });
      const r = {
        useReference,
        case: patient.id,
        tiltDeltaDeg,
        kind,
        best,
        fixedHemisphereDiagnostic: {
          arterialPeakCms,
          venousPeakCms,
          ratio: arterialPeakCms && venousPeakCms ? venousPeakCms / arterialPeakCms : null,
          note: '97th percentile of raw half-plane envelope; not a clinical validated PSV detector',
        },
        meanSectionArtery3Cms: summary(samples.map((s) => s.velocities.interlobarArtery3 / 10)),
        meanSectionVein3Cms: summary(samples.map((s) => s.velocities.interlobarVein3 / 10)),
        info,
        composition: chain.sampleVolume.lastComposition,
        positiveBandPowerDb: median(db),
        positiveBandNote: 'Integrated 15.6–44.5 cm/s diagnostic power; not PSV/EDV or clinical validation',
        measured: m ? { s: m.sPeak, d: m.dPeak, min: m.vMin, direction: m.anterogradeSign, pattern: m.pattern, quality: m.quality } : null,
      };
      console.log(JSON.stringify(r));
      results.push(r);
    }
  }
}
setReferenceBody();
writeFileSync(
  process.argv[3] ?? `/tmp/renal-paired-${mode}-review.json`,
  JSON.stringify(
    {
      clinicalValidation: false,
      mode,
      sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
      targetShare: INTERLOBAR_FLOW_SHARE,
      method:
        '30 s warmup; 8 s IQ; Nyquist50; wall filter25Hz; actual patient seed; geometry-defined gates. Peaks are temporal97th percentiles of hemisphere envelopes, not clinically validated PSV/EDV.',
      results,
    },
    null,
    2,
  ),
);
