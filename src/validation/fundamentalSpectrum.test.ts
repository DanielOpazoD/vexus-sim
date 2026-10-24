import { describe, expect, it } from 'vitest';
import { envelopeFwhm } from '../../tools/fidelity/independentPsf';
import fixture from '../../tools/fidelity/fundamentalSpectrum.fixture.json';
import spec from '../../tools/fidelity/fundamentalSpectrum.spec.json';
import negativeV1 from '../../tools/fidelity/fundamentalSpectrum.v1-negative.json';

const measurement = (id: string) => {
  const row = fixture.measurements.find((value) => value.id === id);
  if (!row) throw new Error(`Missing stored measurement ${id}`);
  return row;
};

describe('independent fundamental spectral reference: stored development evidence', () => {
  it('keeps its synthetic origin, units, original hashes and complete case inventory', () => {
    expect(fixture.protocolId).toBe(spec.protocolId);
    expect(fixture.units).toEqual(spec.units);
    expect(fixture.source).toEqual(spec.source);
    expect(fixture.slopes).toEqual(spec.slopes);
    expect(fixture.cases).toEqual(spec.cases);
    expect(fixture.grid).toEqual(spec.grids.find((grid) => grid.id === 'refined'));
    expect(fixture.origin).toBe('synthetic');
    expect(fixture.evidenceRole).toBe('development');
    expect(fixture.calibration).toBe('pending');
    expect(fixture.humanValidation).toBe('pending');
    expect(fixture.units.soundSpeedMmUs).toBe(1.54);
    expect(fixture.units.band).toContain('half amplitude');
    expect(fixture.source.muMHz).toBe(3.5);
    expect(fixture.source.fractionalHalfAmplitudeBandwidth).toBe(0.45);
    expect(fixture.measurements.map((row) => row.id)).toEqual(spec.cases.map((row) => row.id));
    expect(fixture.provenance.summariesRecomputedFromRaw).toBe(true);
    for (const key of ['reportSha256', 'specSha256', 'generatorSha256', 'profilesSha256', 'extractorSha256'] as const)
      expect(fixture.provenance[key]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reads real stored complex samples with the existing half-amplitude reader', () => {
    expect(fixture.profiles.map((row) => row.id)).toEqual(['face', 'liver-100', 'fluid-100', 'narrow-receiver']);
    const zscale = fixture.units.soundSpeedMmUs / 2;
    for (const profile of fixture.profiles) {
      expect(profile.samples).toHaveLength(129);
      expect(profile.rawIndices).toHaveLength(129);
      expect(new Set(profile.rawIndices).size).toBe(129);
      expect(profile.samples[0][0]).toBe(-1);
      expect(profile.samples.at(-1)![0]).toBe(1);
      const amplitude = profile.samples.map((row) => Math.hypot(row[1], row[2]));
      const measured = envelopeFwhm(
        profile.samples.map((row) => row[0] * zscale),
        amplitude,
      );
      expect(measured.peakPositionMm).toBe(0);
      expect(measured.widthMm).toBeCloseTo(profile.sampledEnvelopeFwhmMm, 12);
      const [lo, hi] = profile.sampledEnvelopeCellIntervalMm;
      expect(measured.widthMm).toBeGreaterThanOrEqual(lo);
      expect(measured.widthMm).toBeLessThanOrEqual(hi);
      // The full-grid width stays in the sampled crossing cells; zero padding is not physical resolution.
      expect(measurement(profile.id).fftEnvelopeFwhmMm).toBeGreaterThanOrEqual(lo);
      expect(measurement(profile.id).fftEnvelopeFwhmMm).toBeLessThanOrEqual(hi);
      // The complex amplitude was not normalized by the extractor.
      expect(amplitude[64]).toBeCloseTo(measurement(profile.id).amplitudeMoments.integral, 12);
    }
  });

  it('distinguishes path slope, fixed loss and receiver bandwidth', () => {
    const face = measurement('face'),
      liver = measurement('liver-100'),
      fluid = measurement('fluid-100');
    expect(liver.amplitudeMoments.meanMHz).toBeLessThan(fluid.amplitudeMoments.meanMHz);
    expect(fluid.amplitudeMoments.meanMHz).toBeLessThan(face.amplitudeMoments.meanMHz);
    expect(Math.abs(liver.amplitudeMoments.varianceMHz2 - face.amplitudeMoments.varianceMHz2)).toBeLessThan(
      spec.acceptance.ordinaryMomentAbsoluteTolerance,
    );
    for (const [a, b] of [
      ['liver-100', 'liver-split'],
      ['mixed', 'mixed-reversed'],
    ] as const)
      for (const key of ['integral', 'meanMHz', 'varianceMHz2'] as const)
        expect(measurement(a).amplitudeMoments[key]).toBeCloseTo(measurement(b).amplitudeMoments[key], 12);
    expect(measurement('fixed-loss').amplitudeMoments.meanMHz).toBeCloseTo(liver.amplitudeMoments.meanMHz, 12);
    expect(measurement('fixed-loss').amplitudeMoments.integral / liver.amplitudeMoments.integral).toBeCloseTo(0.1, 12);
    expect(measurement('fixed-loss').powerMoments.integral / liver.powerMoments.integral).toBeCloseTo(0.01, 12);
    expect(measurement('narrow-receiver').fftEnvelopeFwhmMm).toBeGreaterThan(1.5 * liver.fftEnvelopeFwhmMm);
  });

  it('keeps receiver noise outside patient/source filtering and preserves positive support', () => {
    const face = measurement('face');
    for (const id of ['liver-100', 'fluid-100', 'fixed-loss'])
      expect(measurement(id).receiverNoiseMoments).toEqual(face.receiverNoiseMoments);
    expect(measurement('unfiltered-liver').receiverNoiseMoments.integral).toBe(12);
    expect(measurement('positive-support-stress').frequencyHalfAmplitudeBand.status).toBe('missing-left');
    expect(fixture.counterfactuals.map((row) => row.name)).toEqual([
      'negative/amplitude_10log',
      'negative/missing_return',
      'negative/fixed_loss_as_slope',
      'negative/noise-through-patient',
      'negative/noise-through-source',
      'negative/rational-is-not-fixed-receiver',
    ]);
    expect(fixture.counterfactuals.every((row) => row.passed)).toBe(true);
  });

  it('preserves the failed first run and its explicit frequency-grid refinement', () => {
    expect(negativeV1.status).toBe('failed');
    expect(negativeV1.failedChecks.map((row) => row.name)).toEqual([
      'unfiltered-liver/coarse/Amplitude/varianceMHz2',
      'positive-support-stress/frequency-refinement',
    ]);
    for (const [i, grid] of spec.grids.entries()) {
      expect(grid.stepMHz * 2).toBe(negativeV1.grids[i].stepMHz);
      expect(grid.nfft).toBe(negativeV1.grids[i].nfft);
    }
  });
});
