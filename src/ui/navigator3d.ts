import { START_POINTS } from '../app/startPoints';
import { DIAPHRAGM_THICKNESS_MM } from '../anatomy/tissues';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { AnatomyScene } from '../anatomy/scene';
import { domeHeight, torsoDepth, type Tube } from '../anatomy/primitives';
import { RespiratoryDeformation } from '../anatomy/deformation';
import type { ProbeFrame, ProbePose, Transducer } from '../probe/probe';
import type { Vec3 } from '../core/vec3';

/**
 * Navegador 3D «Sonda y abdomen» (guía §8, §17): tronco con piel translúcida,
 * esqueleto (costillas de ambos lados, esternón, columna, crestas ilíacas),
 * diafragma, hígado (malla extraída del MISMO campo implícito que corta el
 * haz, por marching cubes), vesícula, vasos con radio variable, sonda
 * convexa con marcador y abanico del plano de imagen.
 *
 * Interacción (misma convención que EchoTwin):
 *   arrastrar piel = deslizar · arrastrar el marcador azul o rueda = rotar ·
 *   ⇧+arrastrar = bascular · ⌥+arrastrar = inclinar · botón derecho = orbitar ·
 *   ⌘/Ctrl+rueda = zoom. Nunca teletransporta a una vista.
 *
 * Unidades de la escena: cm (anatomía en mm / 10). Ejes del paciente: +x
 * izquierda, +y anterior, +z craneal. Sin activos externos: todo procedural.
 */
export interface Navigator3DOptions {
  getPose: () => ProbePose;
  setPose: (p: ProbePose) => void;
  getFrame: () => ProbeFrame;
  getDepthMm: () => number;
  getRespCaudalMm: () => number;
}

export interface NavigatorLayers {
  skin: boolean;
  skeleton: boolean;
  organs: boolean;
  vessels: boolean;
  windows: boolean;
}

const CM = 0.1;

export class Navigator3D {
  private renderer: WebGLRendererLike;
  private scene = new THREE.Scene();
  /**
   * El marco anatómico del simulador es LEVÓGIRO (x = izquierda del paciente, y anterior,
   * z craneal; véase `anatomy/scene.ts`), y three.js es dextrógiro: sin corregirlo, el
   * avatar se ve en espejo (hígado a la izquierda del paciente). Todo lo anatómico cuelga
   * de este grupo con escala x = −1, de modo que el mundo three.js queda con la derecha del
   * paciente en +x; three.js invierte solo el sentido de las caras cuando el determinante
   * es negativo. Las intersecciones se devuelven al marco anatómico con `worldToLocal`.
   */
  private world = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  /** Vista por defecto: anterior oblicua desde la derecha del paciente, cabeza arriba (convención clínica: su derecha a la izquierda de pantalla). */
  private orbit = { azimuth: 0.6, elevation: 0.2, distance: 72, target: new THREE.Vector3(6, 0, -2) };
  private skin: THREE.Mesh;
  private skeleton: THREE.Group;
  private organs: THREE.Group;
  private vessels: THREE.Group;
  private windows: THREE.Group;
  private probe: THREE.Group;
  private marker: THREE.Group;
  private fan: THREE.Mesh;
  private fanEdges: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private dragging: 'slide' | 'rotate' | 'rock' | 'tilt' | 'orbit' | null = null;
  private lastX = 0;
  private lastY = 0;
  private lastPhi = 0;
  private lastZ = 0;
  private dirty = true;
  private lastResp = -1;
  private lastPoseKey = '';
  private lastDepth = -1;
  layers: NavigatorLayers = { skin: true, skeleton: true, organs: true, vessels: true, windows: true };
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private anatomy: AnatomyScene,
    private readonly transducer: Transducer,
    private readonly opts: Navigator3DOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x0f1319);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.display = 'block';
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 400);
    this.scene.add(new THREE.HemisphereLight(0xe8eef5, 0x1a1f28, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-30, 40, 25);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 0.8);
    rim.position.set(20, 10, -30);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.5);
    fill.position.set(30, -20, 10);
    this.scene.add(fill);

    ({
      skin: this.skin,
      skeleton: this.skeleton,
      organs: this.organs,
      vessels: this.vessels,
      windows: this.windows,
    } = buildAnatomyGroups(anatomy));
    const p = buildProbe(transducer);
    this.probe = p.probe;
    this.marker = p.marker;
    const fan = buildFan();
    this.fan = fan.fan;
    this.fanEdges = fan.edges;
    this.world.scale.set(-1, 1, 1);
    this.world.add(this.skin, this.skeleton, this.organs, this.vessels, this.windows, this.probe, this.fan, this.fanEdges);
    this.scene.add(this.world);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointermove', this.onHover);
  }

  /**
   * Sustituye la anatomía (cambio de caso): el hábito cambia la pared, la piel y los
   * recortes del hígado, así que se reconstruyen los grupos anatómicos y se liberan
   * las geometrías anteriores; sonda, abanico, cámara y gestos se conservan.
   */
  setAnatomy(anatomy: AnatomyScene): void {
    if (anatomy === this.anatomy) return;
    this.anatomy = anatomy;
    for (const g of [this.skin, this.skeleton, this.organs, this.vessels, this.windows]) {
      this.world.remove(g);
      disposeObject(g);
    }
    ({
      skin: this.skin,
      skeleton: this.skeleton,
      organs: this.organs,
      vessels: this.vessels,
      windows: this.windows,
    } = buildAnatomyGroups(anatomy));
    this.world.add(this.skin, this.skeleton, this.organs, this.vessels, this.windows);
    this.setLayers({});
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setLayers(l: Partial<NavigatorLayers>): void {
    this.layers = { ...this.layers, ...l };
    this.skin.visible = this.layers.skin;
    this.skeleton.visible = this.layers.skeleton;
    this.organs.visible = this.layers.organs;
    this.vessels.visible = this.layers.vessels;
    this.windows.visible = this.layers.windows;
    (this.skin.material as THREE.MeshStandardMaterial).opacity =
      this.layers.organs || this.layers.vessels || this.layers.skeleton ? 0.42 : 0.85;
    this.dirty = true;
  }

  zoomBy(f: number): void {
    this.orbit.distance = THREE.MathUtils.clamp(this.orbit.distance * f, 22, 140);
    this.dirty = true;
  }

  /** Centra la cámara en la sonda. */
  centerOnProbe(): void {
    const fr = this.opts.getFrame();
    this.orbit.target.set(-fr.face[0] * CM, fr.face[1] * CM, fr.face[2] * CM);
    this.orbit.distance = 32;
    this.dirty = true;
  }

  resetCamera(): void {
    this.orbit = { azimuth: 0.6, elevation: 0.2, distance: 72, target: new THREE.Vector3(6, 0, -2) };
    this.dirty = true;
  }

  // --- interacción ---------------------------------------------------------

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private hitSkin(e: PointerEvent): { phi: number; z: number } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObject(this.skin, false);
    if (!hits.length) return null;
    const p = this.world.worldToLocal(hits[0].point.clone()); // → marco anatómico
    const t = this.anatomy.torso;
    return { phi: Math.atan2(p.y / CM / t.b, p.x / CM / t.a), z: p.z / CM };
  }

  private hitMarker(e: PointerEvent): boolean {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.intersectObject(this.marker, true).length > 0;
  }

  private onHover = (e: PointerEvent): void => {
    if (this.dragging) return;
    this.renderer.domElement.style.cursor = this.hitMarker(e) ? 'grab' : this.hitSkin(e) ? 'crosshair' : 'default';
  };

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (e.button === 2) this.dragging = 'orbit';
    else if (this.hitMarker(e)) this.dragging = 'rotate';
    else if (e.shiftKey) this.dragging = 'rock';
    else if (e.altKey) this.dragging = 'tilt';
    else {
      const hit = this.hitSkin(e);
      if (hit) {
        this.dragging = 'slide';
        this.lastPhi = hit.phi;
        this.lastZ = hit.z;
      } else this.dragging = 'orbit';
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const p = this.opts.getPose();
    switch (this.dragging) {
      case 'slide': {
        const hit = this.hitSkin(e);
        if (hit) {
          // por diferencias: la sonda no salta al punto bajo el cursor
          let dphi = hit.phi - this.lastPhi;
          if (dphi > Math.PI) dphi -= 2 * Math.PI;
          if (dphi < -Math.PI) dphi += 2 * Math.PI;
          this.opts.setPose({ ...p, phi: p.phi + dphi, z: p.z + (hit.z - this.lastZ) });
          this.lastPhi = hit.phi;
          this.lastZ = hit.z;
        }
        break;
      }
      case 'rotate':
        this.opts.setPose({ ...p, yaw: p.yaw + dx * 0.01 });
        break;
      case 'rock':
        this.opts.setPose({ ...p, rock: p.rock + dx * 0.006 });
        break;
      case 'tilt':
        this.opts.setPose({ ...p, tilt: p.tilt + dy * 0.006 });
        break;
      case 'orbit':
        // como OrbitControls: arrastrar a la derecha gira el avatar hacia la derecha
        // (la cámara va hacia la izquierda de pantalla); arrastrar abajo sube la cámara
        this.orbit.azimuth -= dx * 0.008;
        this.orbit.elevation = THREE.MathUtils.clamp(this.orbit.elevation + dy * 0.008, -1.3, 1.3);
        this.dirty = true;
        break;
    }
  };

  private onUp = (): void => {
    this.dragging = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      this.zoomBy(Math.exp(e.deltaY * 0.002));
      return;
    }
    const p = this.opts.getPose();
    this.opts.setPose({ ...p, yaw: p.yaw + Math.sign(e.deltaY) * (e.shiftKey ? 0.17 : 0.05) });
  };

  // --- dibujo ---------------------------------------------------------------

  private updateCamera(): void {
    const o = this.orbit;
    const ce = Math.cos(o.elevation);
    // Azimut 0 → cámara anterior (+y) mirando al abdomen; azimut positivo → hacia la
    // derecha del paciente (+x del mundo tras el espejo de `world`). Elevación positiva →
    // hacia la cabeza. Arriba = craneal (+z): la cabeza queda arriba y la derecha del
    // paciente a la izquierda de pantalla, como al mirarlo de frente.
    const dir = new THREE.Vector3(Math.sin(o.azimuth) * ce, Math.cos(o.azimuth) * ce, Math.sin(o.elevation));
    this.camera.position.copy(o.target).add(dir.multiplyScalar(o.distance));
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(o.target);
  }

  private fitSize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
  }

  draw(): void {
    if (this.disposed) return;
    this.fitSize();
    const pose = this.opts.getPose();
    const key = `${pose.phi.toFixed(4)}|${pose.z.toFixed(2)}|${pose.yaw.toFixed(4)}|${pose.rock.toFixed(4)}|${pose.tilt.toFixed(4)}|${pose.lift.toFixed(2)}`;
    const resp = this.opts.getRespCaudalMm();
    const depth = this.opts.getDepthMm();
    if (key !== this.lastPoseKey || Math.abs(resp - this.lastResp) > 0.3 || depth !== this.lastDepth) {
      this.lastPoseKey = key;
      this.lastResp = resp;
      this.lastDepth = depth;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    // órganos y vasos siguen el campo respiratorio (ponderación ≈1 en vísceras)
    const d = RespiratoryDeformation.direction;
    const shift = new THREE.Vector3(d[0] * resp * CM, d[1] * resp * CM, d[2] * resp * CM);
    this.organs.position.copy(shift);
    this.vessels.position.copy(shift);
    // sonda: base (lateral, elevación, axial) → (x, y, z) locales
    const fr = this.opts.getFrame();
    this.probe.position.set(fr.face[0] * CM, fr.face[1] * CM, fr.face[2] * CM);
    this.probe.setRotationFromMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(...fr.lateral), new THREE.Vector3(...fr.elevation), new THREE.Vector3(...fr.axial)),
    );
    updateFan(this.fan, this.fanEdges, fr, this.transducer, depth);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

type WebGLRendererLike = THREE.WebGLRenderer;

// --- constructores de geometría ---------------------------------------------

/** Grupos anatómicos del avatar (todo lo que depende del paciente). */
function buildAnatomyGroups(a: AnatomyScene): {
  skin: THREE.Mesh;
  skeleton: THREE.Group;
  organs: THREE.Group;
  vessels: THREE.Group;
  windows: THREE.Group;
} {
  return { skin: buildSkin(a), skeleton: buildSkeleton(a), organs: buildOrgans(a), vessels: buildVessels(a), windows: buildWindowMarks(a) };
}

/** Libera geometrías, materiales y texturas de un subárbol de three.js. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh | THREE.Sprite;
    if ('geometry' in mesh && mesh.geometry) mesh.geometry.dispose();
    const mat = 'material' in mesh ? mesh.material : null;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const sm = m as THREE.SpriteMaterial;
      if (sm.map) sm.map.dispose();
      m.dispose();
    }
  });
}

/** Escala del contorno del tronco a lo largo de z (hombros, cintura y pelvis, solo estética). */
function torsoScale(zMm: number): number {
  if (zMm < -170) return 1 - 0.1 * Math.min(1, (-170 - zMm) / 80);
  if (zMm > 150) return 1 - 0.14 * Math.min(1, (zMm - 150) / 100);
  return 1;
}

/** Punto de la superficie del tronco (cm) a escala `scale`, ángulo φ y altura z (mm). */
function surfaceAt(a: AnatomyScene, phi: number, zMm: number, scale: number): THREE.Vector3 {
  const t = a.torso;
  const sc = torsoScale(zMm) * scale;
  return new THREE.Vector3(t.a * sc * Math.cos(phi) * CM, t.b * sc * Math.sin(phi) * CM, zMm * CM);
}

function buildSkin(a: AnatomyScene): THREE.Mesh {
  const t = a.torso;
  const nT = 72;
  const nZ = 40;
  const z0 = -260;
  const z1 = 270;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nZ; j++) {
    const z = z0 + ((z1 - z0) * j) / nZ;
    const sc = torsoScale(z);
    for (let i = 0; i <= nT; i++) {
      const th = (i / nT) * Math.PI * 2;
      // La piel usa la misma elipse que el modelo acústico (torsoDepth): así la
      // sonda apoya exactamente donde la ve el haz.
      pos.push(t.a * sc * Math.cos(th) * CM, t.b * sc * Math.sin(th) * (Math.sin(th) < 0 ? 0.95 : 1) * CM, z * CM);
    }
  }
  for (let j = 0; j < nZ; j++)
    for (let i = 0; i < nT; i++) {
      const p = j * (nT + 1) + i;
      idx.push(p, p + nT + 1, p + 1, p + 1, p + nT + 1, p + nT + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd9b59a,
    roughness: 0.75,
    metalness: 0.02,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 3;
  const flesh = new THREE.MeshStandardMaterial({ color: 0xd9b59a, roughness: 0.8 });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 8, 24), flesh);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, 1.5, 31);
  const head = new THREE.Mesh(new THREE.SphereGeometry(8.5, 28, 20), flesh);
  head.scale.set(0.9, 1, 1.1);
  head.position.set(0, 2.5, 42);
  mesh.add(neck, head);
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), flesh);
    sh.scale.set(1.35, 0.9, 1);
    sh.position.set(side * 17.5, -1, 25);
    // Brazos abducidos (mano tras la cabeza), como se explora el flanco: no tapan la ventana
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.0, 30, 20), flesh);
    arm.rotation.x = Math.PI / 2;
    arm.rotation.z = side * 0.35;
    arm.position.set(side * 24, 2, 40);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 26, 24), flesh);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(side * 8, -1, -38);
    mesh.add(sh, arm, thigh);
  }
  return mesh;
}

function buildSkeleton(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.55 });
  const cartilage = new THREE.MeshStandardMaterial({ color: 0xcfd9e6, roughness: 0.5, transparent: true, opacity: 0.85 });
  // Costillas 3–11 de ambos lados. Las derechas 5–10 siguen exactamente la ley de
  // scene.ribs (zAnterior + 60·(0,5 − 0,5·sen φ), escala 0,85); el resto la extiende.
  const anterior = [120, 95, 70, 45, 20, -5, -30, -55, -80];
  anterior.forEach((zAnt, k) => {
    const ribNo = k + 3;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const cart: THREE.Vector3[] = [];
      const phiFront = ribNo <= 7 ? 0.5 * Math.PI + 0.1 : 0.5 * Math.PI + 0.25 + (ribNo - 7) * 0.12;
      for (let i = 0; i <= 44; i++) {
        const phR = phiFront + ((1.5 * Math.PI - 0.12 - phiFront) * i) / 44; // anterior → posterior, lado derecho
        const ph = side < 0 ? phR : Math.PI - phR;
        const zr = zAnt + 60 * (0.5 - 0.5 * Math.sin(phR));
        const p = surfaceAt(a, ph, zr, 0.85);
        pts.push(p);
        if (ribNo <= 7 && phR < 0.5 * Math.PI + 0.45) cart.push(p);
      }
      const r = ribNo >= 11 ? 0.35 : 0.5;
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 8, false), bone));
      if (cart.length >= 3)
        g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cart), 12, r * 1.05, 8, false), cartilage));
    }
  });
  const yFront = a.torso.b * 0.85 * CM;
  const sternum = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.9, 11, 3, 0.4), bone);
  sternum.position.set(0, yFront - 0.2, 12.5);
  const xiphoid = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.5, 3, 3, 0.3), cartilage);
  xiphoid.position.set(0, yFront - 0.4, 5.5);
  g.add(sternum, xiphoid);
  for (let z = -240; z <= 280; z += 28) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(a.spine.r * CM, a.spine.r * CM, 2.2, 20), bone);
    body.rotation.x = Math.PI / 2;
    body.position.set(a.spine.x0 * CM, a.spine.y0 * CM, z * CM);
    const spinous = new THREE.Mesh(new RoundedBoxGeometry(1.2, 2.4, 1.6, 2, 0.3), bone);
    spinous.position.set(a.spine.x0 * CM, (a.spine.y0 - a.spine.r - 10) * CM, z * CM);
    g.add(body, spinous);
  }
  for (const side of [-1, 1]) {
    const ph = (x: number) => (side < 0 ? Math.PI * x : Math.PI * (1 - x));
    const pts = [surfaceAt(a, ph(0.95), -205, 0.9), surfaceAt(a, ph(1.12), -222, 0.88), surfaceAt(a, ph(1.28), -235, 0.86)];
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.7, 8, false), bone));
  }
  return g;
}

/** Malla del hígado extraída del mismo campo implícito que corta el haz (marching cubes). */
function buildLiverMesh(a: AnatomyScene): THREE.Mesh {
  const res = 64;
  const lobes = [a.liver, a.liverLeft];
  const lo = [0, 1, 2].map((i) => Math.min(...lobes.map((l) => l.center[i] - l.radii[i])) - 8);
  const hi = [0, 1, 2].map((i) => Math.max(...lobes.map((l) => l.center[i] + l.radii[i])) + 8);
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const min: Vec3 = [lo[0], lo[1], lo[2]];
  const wall = a.wallThickness();
  const mc = new MarchingCubes(
    res,
    new THREE.MeshStandardMaterial({ color: 0x9a5a3c, roughness: 0.6, transparent: true, opacity: 0.88 }),
    false,
    false,
    300000,
  );
  for (let k = 0; k < res; k++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const p: Vec3 = [min[0] + (size * (i + 0.5)) / res, min[1] + (size * (j + 0.5)) / res, min[2] + (size * (k + 0.5)) / res];
        // recortes idénticos a scene.classify: diafragma (lámina 2,5 mm) y pared del tronco
        const d = Math.max(a.liverSdf(p), -(domeHeight(p[0], p[1], a.dome) - p[2]) + DIAPHRAGM_THICKNESS_MM, torsoDepth(p, a.torso) + wall);
        mc.field[i + j * res + k * res * res] = -d / 10; // positivo dentro; suavizado por escala
      }
  mc.isolation = 0;
  mc.update();
  // MarchingCubes genera en [−1, 1]³ sobre un búfer de tamaño fijo: se compacta
  // a los triángulos realmente emitidos (drawRange) y se reescala a la caja.
  const count = mc.geometry.drawRange.count;
  const src = mc.geometry.getAttribute('position') as THREE.BufferAttribute;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute((src.array as Float32Array).slice(0, count * 3), 3));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, mc.material as THREE.Material);
  mesh.scale.setScalar((size / 2) * CM);
  mesh.position.set((min[0] + size / 2) * CM, (min[1] + size / 2) * CM, (min[2] + size / 2) * CM);
  return mesh;
}

function buildOrgans(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  g.add(buildLiverMesh(a));
  // Diafragma: cúpula paramétrica (misma domeHeight que el clasificador)
  const dome = a.dome;
  const nR = 20;
  const nA = 48;
  const pos: number[] = [];
  const idx: number[] = [];
  const wall = a.wallThickness();
  for (let j = 0; j <= nR; j++) {
    const rho = j / nR;
    for (let i = 0; i <= nA; i++) {
      const ang = (i / nA) * Math.PI * 2;
      let x = dome.x0 + dome.rx * rho * Math.cos(ang);
      let y = dome.y0 + dome.ry * rho * Math.sin(ang);
      const dep = torsoDepth([x, y, 0], a.torso);
      if (dep > -wall) {
        const k = Math.max(0.05, (-wall - 1) / Math.min(-1e-3, dep));
        x = dome.x0 + (x - dome.x0) * Math.min(1, k);
        y = dome.y0 + (y - dome.y0) * Math.min(1, k);
      }
      pos.push(x * CM, y * CM, domeHeight(x, y, dome) * CM);
    }
  }
  for (let j = 0; j < nR; j++)
    for (let i = 0; i < nA; i++) {
      const p = j * (nA + 1) + i;
      idx.push(p, p + 1, p + nA + 1, p + 1, p + nA + 2, p + nA + 1);
    }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  dg.setIndex(idx);
  dg.computeVertexNormals();
  g.add(
    new THREE.Mesh(
      dg,
      new THREE.MeshStandardMaterial({
        color: 0xc9cfd8,
        roughness: 0.6,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  const gb = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0x3fb08f, roughness: 0.5, transparent: true, opacity: 0.85 }),
  );
  gb.scale.set(a.gallbladder.radii[0] * CM, a.gallbladder.radii[1] * CM, a.gallbladder.radii[2] * CM);
  gb.position.set(a.gallbladder.center[0] * CM, a.gallbladder.center[1] * CM, a.gallbladder.center[2] * CM);
  const ra = new THREE.Mesh(
    new THREE.SphereGeometry(a.rightAtrium.r * CM, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb04848, roughness: 0.6, transparent: true, opacity: 0.45, depthWrite: false }),
  );
  ra.position.set(a.rightAtrium.center[0] * CM, a.rightAtrium.center[1] * CM, a.rightAtrium.center[2] * CM);
  g.add(gb, ra);
  // Riñones: elipsoide orientado con la MISMA base que el SDF, seno como elipsoide interior
  for (const k of [a.kidneyRight, a.kidneyLeft]) {
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...k.u), new THREE.Vector3(...k.v), new THREE.Vector3(...k.w));
    const outer = new THREE.Mesh(
      new THREE.SphereGeometry(1, 28, 18),
      new THREE.MeshStandardMaterial({ color: 0x9a5a52, roughness: 0.55, transparent: true, opacity: 0.8 }),
    );
    outer.scale.set(k.radii[0] * CM, k.radii[1] * CM, k.radii[2] * CM);
    const sinus = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshStandardMaterial({ color: 0xe0c27a, roughness: 0.6 }));
    sinus.scale.set(k.sinusRadii[0] * CM, k.sinusRadii[1] * CM, k.sinusRadii[2] * CM);
    sinus.position.set(0, k.sinusOffset * CM, 0);
    const kg = new THREE.Group();
    kg.add(outer, sinus);
    kg.setRotationFromMatrix(basis);
    kg.position.set(k.center[0] * CM, k.center[1] * CM, k.center[2] * CM);
    g.add(kg);
  }
  // Vía biliar (verde), fina
  for (const d of a.ducts) g.add(variableTube(d.tube, 0x5fc86a, 0.95));
  return g;
}

/** Tubo con radio variable a lo largo de una polilínea (anillos por segmento, Catmull-Rom). */
function variableTube(tube: Tube, color: number, opacity = 1): THREE.Mesh {
  const pts = tube.nodes.map((n) => new THREE.Vector3(n.p[0] * CM, n.p[1] * CM, n.p[2] * CM));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const segs = Math.max(12, pts.length * 12);
  const ringN = 12;
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segs, false);
  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const p = curve.getPointAt(u);
    const fl = u * (tube.nodes.length - 1);
    const i0 = Math.min(tube.nodes.length - 2, Math.floor(fl));
    const f = fl - i0;
    const r = (tube.nodes[i0].r + (tube.nodes[i0 + 1].r - tube.nodes[i0].r) * f) * CM;
    const N = frames.normals[s];
    const B = frames.binormals[s];
    for (let k = 0; k < ringN; k++) {
      const ang = (k / ringN) * Math.PI * 2;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang) * tube.apScale;
      pos.push(p.x + (N.x * nx + B.x * ny) * r, p.y + (N.y * nx + B.y * ny) * r, p.z + (N.z * nx + B.z * ny) * r);
    }
  }
  for (let s = 0; s < segs; s++)
    for (let k = 0; k < ringN; k++) {
      const a0 = s * ringN + k;
      const a1 = s * ringN + ((k + 1) % ringN);
      idx.push(a0, a0 + ringN, a1, a1, a0 + ringN, a1 + ringN);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, transparent: opacity < 1, opacity, side: THREE.DoubleSide }),
  );
}

function buildVessels(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const colorOf = (id: string): number =>
    id.startsWith('ivc')
      ? 0x3b6fd8
      : id.startsWith('hv')
        ? 0x79b4ff
        : id.startsWith('pv')
          ? 0xd86ad8
          : id === 'aorta'
            ? 0xe04848
            : id.includes('Artery')
              ? 0xf0704d
              : id.includes('Vein')
                ? 0x5a8cdc
                : 0xf0a04d;
  for (const v of a.vessels) {
    const tube: Tube = { ...v.tube, nodes: v.tube.nodes.map((n) => ({ p: [n.p[0], n.p[1], Math.max(-240, n.p[2])] as Vec3, r: n.r })) };
    g.add(variableTube(tube, colorOf(v.id), v.id === 'aorta' ? 0.7 : 1));
  }
  return g;
}

/** Anillos y rótulos de puntos de partida sobre la piel (posiciones, no vistas). */
function buildWindowMarks(a: AnatomyScene): THREE.Group {
  const g = new THREE.Group();
  const marks = START_POINTS;
  // Orientación del paciente: cabeza, pies, derecha e izquierda
  const orient: Array<[string, Vec3]> = [
    ['cabeza', [0, 12, 52]],
    ['pies', [0, 8, -52]],
    ['D', [-a.torso.a * CM - 6, 6, 10]],
    ['I', [a.torso.a * CM + 6, 6, 10]],
  ];
  for (const [label, at] of orient) {
    const sp = labelSprite(label, '#e6ebf2');
    sp.position.set(at[0], at[1], at[2]);
    sp.scale.multiplyScalar(1.5);
    g.add(sp);
  }
  for (const m of marks) {
    const p = surfaceAt(a, m.phi, m.z, 1.01);
    const n = new THREE.Vector3(Math.cos(m.phi) / a.torso.a, Math.sin(m.phi) / a.torso.b, 0).normalize();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: m.color }));
    ring.position.copy(p);
    ring.lookAt(p.clone().add(n));
    const sprite = labelSprite(m.label, m.color);
    sprite.position.copy(p.clone().add(n.multiplyScalar(2.8)));
    g.add(ring, sprite);
  }
  return g;
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = ctx.measureText(text).width + 24;
  ctx.fillRect(128 - w / 2, 8, w, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(6.4, 1.6, 1);
  return sprite;
}

/**
 * Sonda convexa: lente curva (huella 62 mm, radio 60 mm), cabezal, hombros,
 * mango con cintura, alivio de tracción y cable. Marco local: x lateral
 * (marcador), y elevación, z hacia el paciente (lente en z = 0, cuerpo en −z).
 */
function buildProbe(tr: Transducer): { probe: THREE.Group; marker: THREE.Group } {
  const probe = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, roughness: 0.5, metalness: 0.05 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.25, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.8 });
  const collar = new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.55, metalness: 0.1 });
  const R = tr.curvatureRadius * CM;
  const half = (tr.footprintMm / 2) * CM;
  const el = (tr.elevationMm / 2) * CM;
  const halfAng = Math.asin(Math.min(1, half / R));
  // Lente: arco de cilindro de radio R (eje = elevación) centrado en z = −R, abierto hacia +z
  const lensGeo = new THREE.CylinderGeometry(R, R, el * 2, 40, 1, true, Math.PI / 2 - halfAng, 2 * halfAng);
  const lensMesh = new THREE.Mesh(lensGeo, lens);
  lensMesh.rotation.x = Math.PI / 2; // eje del cilindro (y) → z; theta se mide en el plano x–z
  lensMesh.rotation.z = 0;
  lensMesh.position.z = -R;
  const sag = R - Math.sqrt(R * R - half * half);
  const head = new THREE.Mesh(new RoundedBoxGeometry(half * 2 + 0.3, el * 2 + 0.4, 2.0, 4, 0.3), shell);
  head.position.z = -sag - 1.1;
  const shoulder = new THREE.Mesh(
    new THREE.LatheGeometry(
      [new THREE.Vector2(2.4, 0), new THREE.Vector2(2.3, 0.4), new THREE.Vector2(1.7, 1.0), new THREE.Vector2(1.2, 1.6)],
      28,
    ),
    shell,
  );
  shoulder.rotation.x = -Math.PI / 2;
  shoulder.scale.set(1, 1, 0.7);
  shoulder.position.z = -sag - 2.1;
  const rs = [1.2, 1.25, 1.2, 1.1, 1.0, 1.0, 1.08, 1.12, 1.06, 0.9];
  const profile = rs.map((r, i) => new THREE.Vector2(r, (i / (rs.length - 1)) * 7.4));
  profile.push(new THREE.Vector2(0.6, 7.5), new THREE.Vector2(0, 7.56));
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), shell);
  handle.rotation.x = -Math.PI / 2;
  handle.scale.set(1, 1, 0.74);
  handle.position.z = -sag - 3.6;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.9, 0.32, 24), collar);
  band.rotation.x = Math.PI / 2;
  band.position.z = -sag - 11.0;
  const relief = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.7, 1.4, 20), rubber);
  relief.rotation.x = -Math.PI / 2;
  relief.position.z = -sag - 11.9;
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -sag - 12.5),
        new THREE.Vector3(0.2, 0.6, -sag - 14.5),
        new THREE.Vector3(0.8, 2.4, -sag - 16.8),
      ]),
      14,
      0.3,
      10,
      false,
    ),
    rubber,
  );
  const marker = new THREE.Group();
  const ridge = new THREE.Mesh(
    new RoundedBoxGeometry(0.3, 0.7, 1.2, 2, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.45 }),
  );
  ridge.position.set(half + 0.3, 0, -sag - 1.3);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x5cb0ee, emissive: 0x123c5e, roughness: 0.35 }),
  );
  dot.position.set(half + 0.15, 0, -sag - 2.9);
  marker.add(ridge, dot);
  probe.add(lensMesh, head, shoulder, handle, band, relief, cable, marker);
  return { probe, marker };
}

function buildFan(): { fan: THREE.Mesh; edges: THREE.LineSegments } {
  const fan = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x3fb6a8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  fan.renderOrder = 4;
  const edges = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.7 }),
  );
  edges.renderOrder = 5;
  return { fan, edges };
}

function updateFan(fan: THREE.Mesh, edges: THREE.LineSegments, fr: ProbeFrame, tr: Transducer, depthMm: number): void {
  const n = 20;
  const C = new THREE.Vector3(fr.curvatureCenter[0] * CM, fr.curvatureCenter[1] * CM, fr.curvatureCenter[2] * CM);
  const at = (theta: number, r: number): THREE.Vector3 => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const d = new THREE.Vector3(
      fr.axial[0] * c + fr.lateral[0] * s,
      fr.axial[1] * c + fr.lateral[1] * s,
      fr.axial[2] * c + fr.lateral[2] * s,
    );
    return C.clone().add(d.multiplyScalar((tr.curvatureRadius + r) * CM));
  };
  const verts: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = -tr.halfSector + (2 * tr.halfSector * i) / n;
    const t1 = -tr.halfSector + (2 * tr.halfSector * (i + 1)) / n;
    const a0 = at(t0, 0);
    const a1 = at(t1, 0);
    const b0 = at(t0, depthMm);
    const b1 = at(t1, depthMm);
    verts.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
    e.push(b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
  }
  const l0 = at(-tr.halfSector, 0);
  const l1 = at(-tr.halfSector, depthMm);
  const r0 = at(tr.halfSector, 0);
  const r1 = at(tr.halfSector, depthMm);
  e.push(l0.x, l0.y, l0.z, l1.x, l1.y, l1.z, r0.x, r0.y, r0.z, r1.x, r1.y, r1.z);
  fan.geometry.dispose();
  fan.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  edges.geometry.dispose();
  edges.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(e, 3));
}
