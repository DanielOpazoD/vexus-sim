import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { pointOnLine } from '../../src/probe/probe';
import { pixelToBeam } from '../../src/ultrasound/sectorGeometry';
import { encodeBMode } from './captureBMode';
import type { CtCaseFrame } from '../anatomy/ctFrame';

/** Callback autocontenido: geometría del framebuffer mostrado, nunca controles actuales. */
export function acquiredState(
  selection?:
    | { index: number; expected: number; caseId: string }
    | {
        frames: Array<{ index: number; expected: number; caseId: string }>;
        restore: { index: number; expected: number; caseId: string };
      }
    | void,
) {
  const h = window.__vexusTest!;
  const s = h.sim();
  const select = (at: { index: number; expected: number; caseId: string }) => {
    const r = s.renderer;
    if (!s.frozen || s.patient.id !== at.caseId || r.cineFrame(at.index).n !== at.expected)
      throw new Error('Cine cambió durante exportación');
    const slider = document.querySelector('#cine');
    if (!(slider instanceof HTMLInputElement)) throw new Error('Selector del cine ausente');
    slider.value = String(at.index);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    r.showCine(at.index);
  };
  const read = () => {
    const f = s.renderer.displayedFrame;
    if (!s.frozen || !f || f.color.enabled) throw new Error('Exportación requiere B-mode congelado presentado');
    if (f.t !== f.anatomy.sample.t || f.anatomy.seed !== s.patient.seed) throw new Error('Procedencia adquirida contradictoria');
    const image = s.renderer.readDisplay();
    if (!image.gray.some((v) => v > 0)) throw new Error('Imagen adquirida vacía');
    // Transporte binario sin pérdida: evita serializar un número JSON por píxel.
    // Trozos32KiB acotan argumentos de fromCharCode; no reducen imagen ni cuantización.
    let binary = '';
    for (let first = 0; first < image.gray.length; first += 32768)
      binary += String.fromCharCode(...image.gray.subarray(first, first + 32768));
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
      image: { width: image.width, height: image.height, grayBase64: btoa(binary) },
      errors: h.loggedErrors(),
    });
  };
  if (selection && 'frames' in selection) {
    // Banco offline: un lote acotado evita intercalar rAF/torso entre sus lecturas GPU.
    // Todos los cuadros se presentan con el cine real; el original se restaura ANTES de ceder el hilo.
    if (!selection.frames.length || selection.frames.length > 8) throw new Error('Lote de cine fuera de límite de memoria');
    const sequence: ReturnType<typeof read>[] = [];
    const loopBefore = h.framesRendered();
    try {
      for (const at of selection.frames) {
        select(at);
        sequence.push(read());
      }
    } finally {
      select(selection.restore);
    }
    return { ...read(), sequence, sequenceLoopFrames: h.framesRendered() - loopBefore };
  }
  if (selection) select(selection);
  return { ...read(), sequence: null, sequenceLoopFrames: 0 };
}

export type AcquiredState = Omit<ReturnType<typeof acquiredState>, 'sequence' | 'sequenceLoopFrames'>;

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
  const { sequence, sequenceLoopFrames, ...state } = await page.evaluate(acquiredState, selection);
  if (sequence || sequenceLoopFrames !== 0) throw new Error('Captura individual recibió un lote');
  return writeAcquiredFrame(state, prefix, sourceSha);
}

function writeAcquiredFrame(state: AcquiredState, prefix: string, sourceSha: string) {
  if (state.errors.length) throw new Error('Adquisición con errores del simulador');
  const { image, ...metadata } = state;
  const png = encodeBMode(image.width, image.height, Buffer.from(image.grayBase64, 'base64'));
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
    const frames = Array.from({ length: r.cineCount }, (_, i) => r.cineFrame(i).n);
    const selected = r.displayedFrame.n;
    const index = frames.indexOf(selected);
    if (index < 0) throw new Error('Cuadro presentado fuera del cine');
    return { caseId: s.patient.id, selected, index, frames };
  });
  const frames = [];
  const batches = [];
  for (let first = 0; first < initial.frames.length; first += 8) {
    const started = Date.now();
    console.info(`Cine: leer cuadros${first + 1}–${Math.min(first + 8, initial.frames.length)} de${initial.frames.length}`);
    const selections = initial.frames.slice(first, first + 8).map((expected, j) => ({
      index: first + j,
      expected,
      caseId: initial.caseId,
    }));
    const batch = await page.evaluate(acquiredState, {
      frames: selections,
      restore: { index: initial.index, expected: initial.selected, caseId: initial.caseId },
    });
    if (
      !batch.sequence ||
      batch.sequence.length !== selections.length ||
      batch.sequenceLoopFrames !== 0 ||
      batch.frame.n !== initial.selected
    )
      throw new Error('Lote intercaló presentación o perdió cuadro original');
    for (let j = 0; j < batch.sequence.length; j++) {
      const at = batch.sequence[j];
      if (at.frame.n !== selections[j].expected) throw new Error('Identidad del lote cambió');
      const file = prefix + '-' + String(first + j).padStart(3, '0');
      frames.push({ file, ...writeAcquiredFrame(at, file, sourceSha) });
    }
    batches.push({ first, count: selections.length, loopFramesDuringRead: batch.sequenceLoopFrames, restored: batch.frame.n });
    console.info(`Cine: ${frames.length}/${initial.frames.length} guardados; lote${Date.now() - started}ms de pared`);
  }
  if (frames.length !== initial.frames.length || frames.some((f, i) => f.frameNumber !== initial.frames[i]))
    throw new Error('Identidad del cine exportado cambió');
  const manifest = {
    schemaVersion: 1,
    sourceSha,
    frames,
    acquiredTimesPreserved: true,
    fixedPresentationFps: null,
    batches,
    presentationInterleaving: false,
    reconstruction: 'Envolvente R16F y persistencia reconstruida por el cine real; no equivalencia exacta con todos los cuadros en vivo',
    ctRegistrationAccepted: false,
  };
  writeFileSync(prefix + '-cine.json', JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
