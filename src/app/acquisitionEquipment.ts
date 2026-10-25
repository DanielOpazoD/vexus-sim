import { effectiveWallFilterCutoff } from '../core/highPass';
import { acquisitionSchedule, type AcquisitionRequest, type AcquisitionSchedule } from '../ultrasound/acquisitionSchedule';
import { colorLineCount, type ColorTiming } from '../ultrasound/colorTiming';
import type { EquipmentSettings } from './simulator';

/** Requested immutable equipment never receives its effective reciprocal PRFs. */
export class AcquisitionEquipment {
  private requested?: EquipmentSettings;
  private input?: AcquisitionRequest;
  private schedule?: AcquisitionSchedule;
  private effective?: {
    color: EquipmentSettings['color'];
    pw: EquipmentSettings['pw'];
    timing: ColorTiming;
    schedule: AcquisitionSchedule;
  };
  private bLines = 0;
  private spacing = 0;
  private speed = 0;

  get(e: EquipmentSettings, bLines: number, spacing: number, cMmS: number) {
    if (e === this.requested && bLines === this.bLines && spacing === this.spacing && cMmS === this.speed) return this.effective!;
    const input: AcquisitionRequest = {
      bLines: bLines * (e.bmode.harmonic ? 2 : 1),
      cMmS,
      colorLines: colorLineCount(e.color.theta0, e.color.theta1, spacing),
      ensemble: e.color.ensemble,
      depthMm: e.bmode.depthMm,
      colorFarMm: e.color.r1,
      gateFarMm: e.pw.depthMm + e.pw.gateMm / 2,
      pwPrf: e.pw.enabled ? e.pw.prfHz : 0,
      colorPrf: e.color.enabled ? e.color.prfHz : 0,
    };
    // Gain, baseline, filter and placement changes that preserve these physical
    // scalars reuse the clock. No BigInt arithmetic in the IQ or frame loop.
    if (!this.input || (Object.keys(input) as (keyof AcquisitionRequest)[]).some((k) => input[k] !== this.input![k])) {
      this.schedule = acquisitionSchedule(input);
      this.input = input;
    }
    const schedule = this.schedule!;
    const colorPrf = e.color.enabled ? schedule.colorPrfHz : e.color.prfHz;
    const pwPrf = e.pw.enabled ? schedule.pwPrfHz : e.pw.prfHz;
    this.effective = {
      color: e.color.enabled
        ? { ...e.color, prfHz: colorPrf, wallFilterHz: effectiveWallFilterCutoff(e.color.wallFilterHz, colorPrf) }
        : e.color,
      pw: e.pw.enabled ? { ...e.pw, prfHz: pwPrf, wallFilterHz: effectiveWallFilterCutoff(e.pw.wallFilterHz, pwPrf) } : e.pw,
      timing: {
        lines: input.colorLines,
        colorFrameS: e.color.enabled ? (input.colorLines * input.ensemble) / colorPrf : 0,
        bFrameS: input.bLines * schedule.tb,
        pwDuty: schedule.pwDuty,
        frameHz: 1 / schedule.frameS,
      },
      schedule,
    };
    this.requested = e;
    this.bLines = bLines;
    this.spacing = spacing;
    this.speed = cMmS;
    return this.effective;
  }
}
