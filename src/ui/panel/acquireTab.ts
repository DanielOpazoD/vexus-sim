import { caseDisplayLabel } from '../../app/blindMode';
import type { RespiratoryPattern } from '../../physiology/patientState';
import { button, note, row, slider } from '../controls';
import type { PanelContext } from './context';
import { sweepRow } from './dopplerTab';
import { buildImageAdvanced, buildImageBasics, IMAGE_ADVANCED_INFO } from './imageControls';

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
    info: 'Arrastra sobre la imagen o el 3D para mover la sonda; los deslizadores la afinan. Teclado: W A S D deslizar · Q E rotar · ← → bascular · ↑ ↓ inclinar · R F presión · ⇧ fino.',
  });
  const deg = (v: number) => `${v.toFixed(0)}°`;
  ctx.track(
    slider(
      probe,
      {
        label: 'Rotación',
        min: -180,
        max: 180,
        step: 1,
        get: () => (s().pose.yaw * 180) / Math.PI,
        set: (v) => s().setPose({ ...s().pose, yaw: (v * Math.PI) / 180 }),
        format: deg,
      },
      () => undefined,
    ),
  );
  ctx.track(
    slider(
      probe,
      {
        label: 'Inclinación',
        min: -40,
        max: 40,
        step: 1,
        get: () => (s().pose.tilt * 180) / Math.PI,
        set: (v) => s().setPose({ ...s().pose, tilt: (v * Math.PI) / 180 }),
        format: deg,
      },
      () => undefined,
    ),
  );
  ctx.track(
    slider(
      probe,
      {
        label: 'Basculación',
        min: -40,
        max: 40,
        step: 1,
        get: () => (s().pose.rock * 180) / Math.PI,
        set: (v) => s().setPose({ ...s().pose, rock: (v * Math.PI) / 180 }),
        format: deg,
      },
      () => undefined,
    ),
  );
  ctx.track(
    slider(
      probe,
      {
        label: 'Presión',
        min: -6,
        max: 12,
        step: 0.5,
        get: () => -s().pose.lift,
        set: (v) => s().setPose({ ...s().pose, lift: -v }),
        format: (v) => `${v.toFixed(1)} mm`,
      },
      () => undefined,
    ),
  );
  const pos = note(probe);
  ctx.track({
    sync: () =>
      (pos.textContent = `φ ${((s().pose.phi * 180) / Math.PI).toFixed(0)}° · z ${(s().pose.z / 10).toFixed(1)} cm · acoplamiento ${(s().renderer.meanCoupling() * 100).toFixed(0)} %`),
  });
  ctx.track(button(row(probe), 'Reiniciar sonda', () => s().setPose({ ...s().pose, yaw: 0, rock: 0, tilt: 0, lift: 0 })));

  const resp = ctx.section(p, 'Respiración', { info: 'La maniobra cambia presiones y movimiento; no reinicia el ciclo cardíaco.' });
  const info = note(resp);
  ctx.track({
    sync: () =>
      (info.textContent = `${caseDisplayLabel(s().patient.id, ctx.store.get().debug)} · FC ${s().patient.heartRateBpm} lpm · resp ${s().patient.respiratoryRateMin}/min`),
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

  buildImageAdvanced(ctx, ctx.section(p, 'Avanzado', { collapsed: true, info: IMAGE_ADVANCED_INFO }));
  return m.parentElement!;
}
