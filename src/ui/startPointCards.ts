import type { Torso } from '../anatomy/primitives';
import { START_POINTS, type StartPoint } from '../app/startPoints';
import type { ProbePose } from '../probe/probe';

type StartPointId = StartPoint['id'];

/**
 * Lo que cada tarjeta dice de su ventana: la estructura VExUS y el abordaje en el nombre, y lo que se ve en
 * una línea. La explicación completa (`hint`) queda en el tooltip; el color es el del anillo del 3D.
 */
const CARD_TEXT: Record<StartPointId, { name: string; sub: string }> = {
  subxiphoid: { name: 'VCI · subxifoidea', sub: 'Eje largo hasta la aurícula derecha' },
  intercostal: { name: 'Suprahepáticas · lateral', sub: '8.º espacio intercostal, con la VCI' },
  flank: { name: 'VCI · flanco coronal', sub: 'Suprahepáticas entrando en la VCI' },
  portal: { name: 'Porta · lateral', sub: 'Porta principal, VCI por detrás' },
  renal: { name: 'Riñón · flanco', sub: 'Eje largo; PW en una vena interlobar' },
};

/** Radio (mm, sobre la piel) dentro del cual la sonda «está» en una ventana; las dos más próximas distan 24 mm. */
export const CURRENT_WINDOW_MM = 20;

/** Distancia (mm) entre la sonda y un punto de partida: cuerda sobre la elipse del tronco y eje craneocaudal. */
export function startPointDistanceMm(pose: Pick<ProbePose, 'phi' | 'z'>, sp: StartPoint, torso: Pick<Torso, 'a' | 'b'>): number {
  const dx = torso.a * (Math.cos(pose.phi) - Math.cos(sp.phi));
  const dy = torso.b * (Math.sin(pose.phi) - Math.sin(sp.phi));
  return Math.hypot(dx, dy, pose.z - sp.z);
}

/** La ventana en la que está la sonda: el punto de partida más cercano a ≤ `maxMm`, o ninguno. */
export function currentStartPoint(
  pose: Pick<ProbePose, 'phi' | 'z'>,
  torso: Pick<Torso, 'a' | 'b'>,
  maxMm = CURRENT_WINDOW_MM,
): StartPointId | null {
  let best: StartPointId | null = null;
  let bestMm = maxMm;
  for (const sp of START_POINTS) {
    const d = startPointDistanceMm(pose, sp, torso);
    if (d <= bestMm) {
      best = sp.id;
      bestMm = d;
    }
  }
  return best;
}

export interface StartPointCardsDeps {
  /** Lleva la sonda al punto de partida (se desliza: decisión 17). */
  onPick: (sp: StartPoint) => void;
  getPose: () => ProbePose;
  getTorso: () => Pick<Torso, 'a' | 'b'>;
  /** La sonda se está deslizando hacia la ventana elegida. */
  animating: () => boolean;
}

/**
 * Ventanas VExUS del carril izquierdo: una tarjeta por punto de partida. Resalta la ventana actual: la elegida
 * mientras la sonda se desliza hacia ella y, después, aquella en cuyo punto de partida está la sonda.
 */
export class StartPointCards {
  private readonly cards = new Map<StartPointId, HTMLButtonElement>();
  private target: StartPointId | null = null;

  constructor(
    host: HTMLElement,
    private readonly deps: StartPointCardsDeps,
  ) {
    for (const sp of START_POINTS) {
      const text = CARD_TEXT[sp.id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'win-card';
      card.title = sp.hint;
      card.style.setProperty('--win', sp.color);
      const ring = document.createElement('span');
      ring.className = 'win-ring';
      const name = document.createElement('span');
      name.className = 'win-name';
      name.textContent = text.name;
      const sub = document.createElement('span');
      sub.className = 'win-sub';
      sub.textContent = text.sub;
      card.append(ring, name, sub);
      card.addEventListener('click', () => {
        this.target = sp.id;
        deps.onPick(sp);
        this.sync();
      });
      host.appendChild(card);
      this.cards.set(sp.id, card);
    }
  }

  sync(): void {
    const current = this.target && this.deps.animating() ? this.target : currentStartPoint(this.deps.getPose(), this.deps.getTorso());
    for (const [id, card] of this.cards) {
      card.classList.toggle('current', id === current);
      if (id === current) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
  }
}
