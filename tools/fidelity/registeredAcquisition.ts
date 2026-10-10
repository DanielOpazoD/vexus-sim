import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { pointOnLine } from '../../src/probe/probe';
import { pixelToBeam } from '../../src/ultrasound/sectorGeometry';
import { encodeBMode } from './captureBMode';
import type { CtCaseFrame } from '../anatomy/ctFrame';

/** Callback autocontenido: geometría del framebuffer mostrado, nunca controles actuales. */
export function acquiredState(selection?: { index: number; expected: number; caseId: string } | void) {
  const h = window.__vexusTest!;
  const s = h.sim();
  if (selection) {
    const r = s.renderer;
    if (!s.frozen || s.patient.id !== selection.caseId || r.cineFrame(selection.index).n !== selection.expected)
      throw new Error('Cine cambió durante exportación');
    const slider = document.querySelector('#cine');
    if (!(slider instanceof HTMLInputElement)) throw new Error('Selector del cine ausente');
    slider.value = String(selection.index);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    r.showCine(selection.index);
  }
  const f = s.renderer.displayedFrame;
  if (!s.frozen || !f || f.color.enabled) throw new Error('Exportación requiere B-mode congelado presentado');
  if (f.t !== f.anatomy.sample.t || f.anatomy.seed !== s.patient.seed) throw new Error('Procedencia adquirida contradictoria');
  const image = s.renderer.readDisplay();
  if (!image.gray.some((v) => v > 0)) throw new Error('Imagen adquirida vacía');
  return structuredClone({
    schemaVersion: 1,
    caseId: s.patient.id,
    patient: s.patient,
    anatomyFrameId: null as string | null,
    anatomyDomain: s.scene.torso.profile ? 'bodyparts3d-profile' : 'procedural',
    frame: f,
    livePose: s.pose,
    liveFrame: s.frame,
    clock: { step: s.physiology.clock.step, dtSeconds: s.physiology.clock.dt, timeSeconds: s.sample.t },
    layout: s.renderer.display,
    image: { width: image.width, height: image.height, gray: Array.from(image.gray) },
    errors: h.loggedErrors(),
  });
}

export type AcquiredState = ReturnType<typeof acquiredState>;

/** Punto del plano presentado, utilizable por el torso y el corte sin reinterpretar la pose. */
export function acquiredPixelPoint(state: Pick<AcquiredState, 'frame' | 'layout'>, x: number, y: number) {
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= state.layout.width || y >= state.layout.height) return null;
  const beam = pixelToBeam(state.layout, state.frame.anatomy.transducer, state.frame.bmode.depthMm, x, y);
  return beam ? pointOnLine(state.frame.anatomy.frame, state.frame.anatomy.transducer, beam.theta, beam.r) : null;
}

/** Solo un simulador que adopte ESTE marco TAC puede superponerse sin registro adicional. */
export function acquiredPixelVoxel(
  state: Pick<AcquiredState, 'frame' | 'layout' | 'anatomyFrameId'>,
  x: number,
  y: number,
  ct: CtCaseFrame,
) {
  if (state.anatomyFrameId !== ct.id) throw new Error('Adquisición y referencia TAC tienen marcos distintos');
  if (
    state.frame.anatomy.sample.resp.diaphragmCaudalMm !== 0 ||
    state.frame.anatomy.compression.nodes.some((n) => n[0] !== 0 || n[1] !== 0)
  )
    throw new Error('TAC en reposo: requiere inversa material verificada de respiración y compresión');
  const point = acquiredPixelPoint(state, x, y);
  return point ? ct.patientToVoxel(point, state.anatomyFrameId) : null;
}

/** Lee señal y procedencia en una sola evaluación; escribe PNG y sidecar con hashes de contenido. */
export async function exportAcquiredFrame(
  page: Page,
  prefix: string,
  sourceSha: string,
  selection?: { index: number; expected: number; caseId: string },
) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('SHA de código exacto requerido');
  const state = await page.evaluate(acquiredState, selection);
  if (state.errors.length) throw new Error('Adquisición con errores del simulador');
  const { image, ...metadata } = state;
  const png = encodeBMode(image.width, image.height, image.gray);
  const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  const json =
    JSON.stringify(
      {
        ...metadata,
        sourceSha,
        image: { width: image.width, height: image.height, pngSha256: hash(png) },
        anatomyFrameId: null,
        ctRegistrationAccepted: false,
      },
      null,
      2,
    ) + '\n';
  writeFileSync(prefix + '.png', png);
  writeFileSync(prefix + '.json', json);
  return { pngSha256: hash(png), metadataSha256: hash(json), frameNumber: state.frame.n, acquiredTimeSeconds: state.frame.t };
}

/** Secuencia adquirida, con tiempos originales y restauración del cuadro seleccionado. No inventa fps. */
export async function exportAcquiredCine(page: Page, prefix: string, sourceSha: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('SHA de código exacto requerido');
  const initial = await page.evaluate(() => {
    const s = window.__vexusTest!.sim(),
      r = s.renderer;
    if (!s.frozen || !r.displayedFrame || !r.cineCount) throw new Error('Cine exportable requiere congelación');
    return { caseId: s.patient.id, selected: r.displayedFrame.n, frames: Array.from({ length: r.cineCount }, (_, i) => r.cineFrame(i).n) };
  });
  const frames = [];
  try {
    for (let i = 0; i < initial.frames.length; i++) {
      const file = prefix + '-' + String(i).padStart(3, '0');
      // Selección, presentación y lectura atómicas: ningún tick puede interponer otra imagen.
      frames.push({
        file,
        ...(await exportAcquiredFrame(page, file, sourceSha, { index: i, expected: initial.frames[i], caseId: initial.caseId })),
      });
    }
  } finally {
    await page.evaluate(
      ({ expected, caseId }) => {
        const s = window.__vexusTest!.sim(),
          r = s.renderer;
        if (!s.frozen || s.patient.id !== caseId) throw new Error('Exportación perdió congelación o caso');
        const i = Array.from({ length: r.cineCount }, (_, j) => j).find((j) => r.cineFrame(j).n === expected);
        if (i === undefined) throw new Error('Cuadro original del cine ya no existe');
        const slider = document.querySelector('#cine');
        if (!(slider instanceof HTMLInputElement)) throw new Error('Selector del cine ausente');
        slider.value = String(i);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        r.showCine(i);
      },
      { expected: initial.selected, caseId: initial.caseId },
    );
  }
  if (frames.some((f, i) => f.frameNumber !== initial.frames[i])) throw new Error('Identidad del cine exportado cambió');
  const manifest = {
    schemaVersion: 1,
    sourceSha,
    frames,
    acquiredTimesPreserved: true,
    fixedPresentationFps: null,
    reconstruction: 'Envolvente R16F y persistencia reconstruida por el cine real; no equivalencia exacta con todos los cuadros en vivo',
    ctRegistrationAccepted: false,
  };
  writeFileSync(prefix + '-cine.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
