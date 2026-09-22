import { START_POINTS, type StartPoint } from '../../app/startPoints';
import type { RespiratoryPattern } from '../../physiology/patientState';
import { button, help, row, slider } from '../controls';
import type { PanelContext } from './context';

/** Pestaña Adquirir: puntos de partida, sonda (ángulos y presión), caso y respiración. */
export function buildAcquireTab(ctx: PanelContext, p: HTMLElement, onStartPoint: (sp: StartPoint) => void): void {
  const s = ctx.sim;
  const start = ctx.section(p, 'Puntos de partida');
  const grid = document.createElement('div');
  grid.className = 'tool-grid';
  for (const sp of START_POINTS) {
    const b = document.createElement('button');
    b.textContent = sp.label;
    b.title = sp.hint;
    b.addEventListener('click', () => onStartPoint(sp));
    grid.appendChild(b);
  }
  start.appendChild(grid);
  help(
    start,
    'La sonda se desliza de forma continua hasta la posición cutánea de partida con ángulos neutros; la ventana diagnóstica hay que afinarla a mano (guía §8).',
  );

  const probe = ctx.section(p, 'Sonda');
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
  const pos = document.createElement('div');
  pos.className = 'help';
  probe.appendChild(pos);
  ctx.track({
    sync: () =>
      (pos.textContent = `φ ${((s().pose.phi * 180) / Math.PI).toFixed(0)}° · z ${(s().pose.z / 10).toFixed(1)} cm · acoplamiento ${(s().renderer.meanCoupling() * 100).toFixed(0)} %`),
  });
  const r = row(probe);
  ctx.track(button(r, 'Reiniciar sonda', () => s().setPose({ ...s().pose, yaw: 0, rock: 0, tilt: 0, lift: 0 })));

  const pat = ctx.section(p, 'Caso y paciente');
  const info = document.createElement('div');
  info.className = 'help';
  pat.appendChild(info);
  ctx.track({
    sync: () => (info.textContent = `${s().patient.label} · FC ${s().patient.heartRateBpm} · resp ${s().patient.respiratoryRateMin}/min`),
  });
  const rl = document.createElement('div');
  rl.className = 'help';
  rl.textContent = 'Respiración';
  pat.appendChild(rl);
  ctx.segmented<RespiratoryPattern>(
    pat,
    [
      ['quiet', 'Tranquila'],
      ['deep', 'Profunda'],
      ['apnea-expiratory', 'Apnea esp'],
      ['apnea-inspiratory', 'Apnea insp'],
    ],
    () => s().patient.respiratoryPattern,
    (v) => (s().patient.respiratoryPattern = v),
  );
  help(
    pat,
    'La maniobra cambia presiones y movimiento; no reinicia el ciclo cardíaco. Teclado: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> deslizar · <kbd>Q</kbd><kbd>E</kbd> rotar · <kbd>←→</kbd> bascular · <kbd>↑↓</kbd> inclinar · <kbd>R</kbd><kbd>F</kbd> presión.',
  );
}
