import { caseDisplayLabel } from '../../app/blindMode';
import type { RespiratoryPattern } from '../../physiology/patientState';
import { PROBE_LIFT_LIMITS } from '../../probe/probe';
import { button, note, row, slider } from '../controls';
import type { PanelContext } from './context';
import { sweepRow } from './dopplerTab';
import { buildImageAdvanced, buildImageBasics, IMAGE_ADVANCED_INFO } from './imageControls';
import { buildProbePositionCopy } from './probePosition';

/**
 * Pestaña Adquirir: lo que se toca mientras se busca y se sostiene la ventana — la imagen (profundidad,
 * ganancia, foco), la sonda (ángulos y presión) y la respiración —, con los mandos avanzados de la imagen
 * plegados; arriba, con el modo M, su barrido (decisión 80). Las ventanas (puntos de partida) están en el carril
 * izquierdo. Devuelve la sección del modo M, que el panel muestra solo en ese modo.
 */
export function buildAcquireTab(ctx: PanelContext, p: HTMLElement): HTMLElement {
  const s = ctx.sim;
  const m = ctx.section(p, 'Modo M', {
    info: 'Arrastra la línea M sobre la imagen o haz clic donde la quieras: cada cuadro copia esa línea, con los grises de la imagen, a la franja de abajo. La colapsabilidad de la VCI se mide en Medir.',
  });
  sweepRow(ctx, m);
  buildImageBasics(ctx, ctx.section(p, 'Imagen', { info: 'También con el teclado: [ ] profundidad · − + ganancia.' }));

  const probe = ctx.section(p, 'Sonda', {
    info: 'Arrastra sobre la imagen o desde la piel 3D para deslizar alrededor del tronco, incluso fuera de su silueta. Los tres ángulos permiten vueltas completas; si la cara apunta hacia fuera pierde contacto. Teclado: W A S D deslizar · Q E rotar · ← → bascular · ↑ ↓ inclinar · R F presión · ⇧ fino.',
  });
  const deg = (v: number) => `${v.toFixed(0)}°`;
  ctx.track(
    slider(probe, {
      label: 'Rotación',
      min: -180,
      max: 180,
      step: 1,
      get: () => (s().pose.yaw * 180) / Math.PI,
      set: (v) => ctx.setPose({ ...s().pose, yaw: (v * Math.PI) / 180 }),
      format: deg,
    }),
  );
  ctx.track(
    slider(probe, {
      label: 'Inclinación',
      min: -180,
      max: 180,
      step: 1,
      get: () => (s().pose.tilt * 180) / Math.PI,
      set: (v) => ctx.setPose({ ...s().pose, tilt: (v * Math.PI) / 180 }),
      format: deg,
    }),
  );
  ctx.track(
    slider(probe, {
      label: 'Basculación',
      min: -180,
      max: 180,
      step: 1,
      get: () => (s().pose.rock * 180) / Math.PI,
      set: (v) => ctx.setPose({ ...s().pose, rock: (v * Math.PI) / 180 }),
      format: deg,
    }),
  );
  ctx.track(
    slider(probe, {
      label: 'Presión',
      min: -PROBE_LIFT_LIMITS.max,
      max: -PROBE_LIFT_LIMITS.min,
      step: 0.5,
      get: () => -s().pose.lift,
      set: (v) => ctx.setPose({ ...s().pose, lift: -v }),
      format: (v) => `${v.toFixed(1)} mm`,
    }),
  );
  const pos = note(probe);
  ctx.track({
    sync: () =>
      (pos.textContent = `φ ${((s().pose.phi * 180) / Math.PI).toFixed(0)}° · z ${(s().pose.z / 10).toFixed(1)} cm · acoplamiento ${(s().renderer.meanCoupling() * 100).toFixed(0)} %`),
  });
  buildProbePositionCopy(ctx, probe);

  buildRespirationControls(ctx, p);

  buildImageAdvanced(ctx, ctx.section(p, 'Avanzado', { collapsed: true, info: IMAGE_ADVANCED_INFO }));
  return m.parentElement!;
}

/** Controles respiratorios: la respuesta del panel pertenece al evento, no al próximo cuadro. */
export function buildRespirationControls(ctx: PanelContext, p: HTMLElement): void {
  const s = ctx.sim;
  const resp = ctx.section(p, 'Configurar respiración', {
    info: 'Apagada: referencia de fin de espiración. Las maniobras cambian presiones y movimiento; el corazón, el flujo y el reloj continúan.',
  });
  const breathing = () => s().patient.respiratoryPattern === 'quiet' || s().patient.respiratoryPattern === 'deep';
  const toggle = button(
    row(resp),
    'Activar respiración',
    () => {
      s().patient.respiratoryPattern = breathing() ? 'apnea-expiratory' : 'quiet';
      // Actualiza rótulo, estado accesible y maniobra sin esperar otro cuadro GPU.
      ctx.sync();
    },
    breathing,
  );
  ctx.track(toggle);
  ctx.track({
    sync: () => {
      toggle.el.textContent = breathing() ? 'Desactivar respiración' : 'Activar respiración';
    },
  });
  const info = note(resp);
  ctx.track({
    sync: () =>
      (info.textContent = `${caseDisplayLabel(s().patient.id, ctx.store.get().debug)} · FC ${s().patient.heartRateBpm} lpm · ${breathing() ? `resp ${s().patient.respiratoryRateMin}/min` : s().patient.respiratoryPattern === 'apnea-inspiratory' ? 'pausa inspiratoria' : 'apagada · fin de espiración'}`),
  });
  ctx
    .segmented<RespiratoryPattern>(
      resp,
      [
        ['quiet', 'Tranquila'],
        ['deep', 'Profunda'],
        ['apnea-expiratory', 'Apnea espiratoria'],
        ['apnea-inspiratory', 'Apnea inspiratoria'],
      ],
      () => s().patient.respiratoryPattern,
      (v) => (s().patient.respiratoryPattern = v),
    )
    .classList.add('grid2');
}
