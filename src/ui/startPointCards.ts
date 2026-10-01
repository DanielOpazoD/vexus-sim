import { torsoSkinPoint, type Torso } from '../anatomy/primitives';
import { startPointsFor, type StartPoint } from '../app/startPoints';
import type { ProbePose } from '../probe/probe';

type StartPointId = StartPoint['id'];

/**
 * La línea de cada tarjeta con lo que muestra su ventana, estructura VExUS primero. El nombre es el `label` del
 * punto de partida, el mismo que rotula su anillo en el 3D (y el color, el del anillo); la explicación completa
 * (`hint`) queda en el tooltip.
 */
const CARD_SUB: Record<StartPointId, string> = {
  subxiphoid: 'VCI en eje largo hasta la AD',
  epigastric: 'VCI y aorta sobre la vértebra',
  intercostal: 'Suprahepáticas y VCI por el hígado',
  subcostal: 'VSH media hasta la VCI',
  flank: 'VCI coronal con las suprahepáticas',
  portal: 'Porta principal con la VCI detrás',
  renal: 'Riñón en eje largo · interlobares',
};

/** Radio (mm, sobre la piel) dentro del cual la sonda «está» en una ventana; las dos más próximas distan 24 mm. */
export const CURRENT_WINDOW_MM = 20;

/**
 * Giro máximo (rad) entre la sonda y una ventana para estar en ella. La epigástrica y la subxifoidea (decisión 83) distan
 * 32 mm sobre la piel y se distinguen por 90° de giro: sin esto, una sonda sagital entre las dos (la VCI en eje largo)
 * se marcaba «Epigástrico».
 */
export const CURRENT_WINDOW_YAW = Math.PI / 4;

/**
 * Diferencia de giro (rad, 0 … π) por el arco corto. Girar π no da la misma ventana: el marcador queda al otro lado (la
 * imagen en espejo) y, con basculación o inclinación, el haz apunta a otro sitio. NaN si alguno lo es.
 */
export function yawDelta(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** Distancia (mm) entre la sonda y un punto de partida: cuerda sobre la elipse del tronco y eje craneocaudal. */
export function startPointDistanceMm(
  pose: Pick<ProbePose, 'phi' | 'z'>,
  sp: StartPoint,
  torso: Pick<Torso, 'a' | 'b' | 'profile'>,
): number {
  if (torso.profile) {
    const t = { ...torso, zMin: -300, zMax: 300, skinMm: 2, fatMm: 0, muscleMm: 0, preperitonealMm: 0 };
    const a = torsoSkinPoint(pose.phi, pose.z, t),
      b = torsoSkinPoint(sp.phi, sp.z, t);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  const dx = torso.a * (Math.cos(pose.phi) - Math.cos(sp.phi));
  const dy = torso.b * (Math.sin(pose.phi) - Math.sin(sp.phi));
  return Math.hypot(dx, dy, pose.z - sp.z);
}

/**
 * La ventana en la que está la sonda: el punto de partida más cercano a ≤ `maxMm` cuyo giro difiere del de la sonda
 * menos de `CURRENT_WINDOW_YAW`, o ninguno.
 */
export function currentStartPoint(
  pose: Pick<ProbePose, 'phi' | 'z' | 'yaw'>,
  torso: Pick<Torso, 'a' | 'b' | 'profile'>,
  maxMm = CURRENT_WINDOW_MM,
): StartPointId | null {
  let best: StartPointId | null = null;
  let bestMm = maxMm;
  for (const sp of startPointsFor(torso)) {
    // escrito para que un giro NaN no cuente como ventana
    if (!(yawDelta(pose.yaw, sp.yaw) < CURRENT_WINDOW_YAW)) continue;
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
  getTorso: () => Pick<Torso, 'a' | 'b' | 'profile'>;
  /** La sonda se está deslizando hacia la ventana elegida. */
  animating: () => boolean;
}

/**
 * Ventanas VExUS del carril izquierdo: una tarjeta por punto de partida. Resalta la ventana actual: la elegida
 * mientras la sonda se desliza hacia ella y, después, aquella en cuyo punto de partida está la sonda, con su giro.
 */
export class StartPointCards {
  private readonly cards = new Map<StartPointId, HTMLButtonElement>();
  private target: StartPointId | null = null;

  constructor(
    host: HTMLElement,
    private readonly deps: StartPointCardsDeps,
  ) {
    for (const sp of startPointsFor(deps.getTorso())) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'win-card';
      card.title = sp.hint;
      card.style.setProperty('--win', sp.color);
      const ring = document.createElement('span');
      ring.className = 'win-ring';
      const name = document.createElement('span');
      name.className = 'win-name';
      name.textContent = sp.label;
      const sub = document.createElement('span');
      sub.className = 'win-sub';
      sub.textContent = CARD_SUB[sp.id];
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
