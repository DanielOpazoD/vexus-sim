import { bodySection } from '../anatomy/referenceBody';
import * as THREE from 'three';
import type { AnatomyScene, VesselCaliber } from '../anatomy/scene';
import { bindRespiratoryMotion } from './navigator3d/respiratoryMotion';
import type { ProbeFrame, ProbePose, Transducer } from '../probe/probe';
import { buildAnatomyGroups } from './navigator3d/anatomyGroups';
import { CM, disposeObject } from './navigator3d/common';
import { buildFan, buildProbe, updateFan } from './navigator3d/probe';

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
  /** Calibres del caso (escala de radio por vaso y sección de la VCI) en régimen. */
  getCaliber: () => VesselCaliber;
}

/** Campo de visión vertical de la cámara (grados) en un lienzo apaisado o cuadrado. */
const FOV_DEG = 35;

export interface NavigatorLayers {
  skin: boolean;
  skeleton: boolean;
  organs: boolean;
  vessels: boolean;
  windows: boolean;
}

export class Navigator3D {
  private renderer: THREE.WebGLRenderer;
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
  private respiratoryMotion: ReturnType<typeof bindRespiratoryMotion> | null = null;
  private lastPoseKey = '';
  private lastDepth = -1;
  layers: NavigatorLayers = { skin: true, skeleton: true, organs: true, vessels: true, windows: true };
  private disposed = false;
  /**
   * Grupos de la anatomía anterior, pendientes de liberar TRAS el primer render con la nueva: si
   * sus materiales se liberan antes, three.js borra los programas GLSL que ya no usa nadie y los
   * materiales nuevos (misma clave) los recompilan — 5 de 10 programas por cambio de caso, varios
   * segundos con SwiftShader (el HUD de la e2e llegó a quedarse 15 s sin cuadro nuevo).
   */
  private retired: THREE.Object3D[] = [];

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
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1, 400);
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
    } = buildAnatomyGroups(anatomy, opts.getCaliber()));
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
   * recortes del hígado, así que se reconstruyen los grupos anatómicos; los anteriores se
   * liberan después del siguiente render (`retired`). Sonda, abanico, cámara y gestos se conservan.
   */
  setAnatomy(anatomy: AnatomyScene): void {
    if (anatomy === this.anatomy) return;
    this.anatomy = anatomy;
    this.respiratoryMotion = null;
    for (const g of [this.skin, this.skeleton, this.organs, this.vessels, this.windows]) {
      this.world.remove(g);
      this.retired.push(g);
    }
    ({
      skin: this.skin,
      skeleton: this.skeleton,
      organs: this.organs,
      vessels: this.vessels,
      windows: this.windows,
    } = buildAnatomyGroups(anatomy, this.opts.getCaliber()));
    this.world.add(this.skin, this.skeleton, this.organs, this.vessels, this.windows);
    this.setLayers({});
    this.dirty = true;
  }

  dispose(): void {
    this.disposed = true;
    this.releaseRetired();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.respiratoryMotion = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Modo alumno: los vasos se ocultan aunque la capa esté marcada (el calibre delata el caso). */
  private studentMode = false;

  setStudentMode(on: boolean): void {
    this.studentMode = on;
    this.setLayers({});
  }

  setLayers(l: Partial<NavigatorLayers>): void {
    this.layers = { ...this.layers, ...l };
    this.skin.visible = this.layers.skin;
    this.skeleton.visible = this.layers.skeleton;
    this.organs.visible = this.layers.organs;
    this.vessels.visible = this.layers.vessels && !this.studentMode;
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
    const z = p.z / CM;
    const cy = t.profile ? bodySection(0, z, t.profile)[3] : (t.y0 ?? 0);
    return {
      phi: t.profile ? Math.atan2(p.y / CM - cy, p.x / CM) : Math.atan2((p.y / CM - cy) / t.b, p.x / CM / t.a),
      z,
    };
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
      // En un lienzo más alto que ancho (el corte plegado) se abre el campo vertical para conservar el ancho
      // visible de un lienzo cuadrado: el tronco no se recorta por los lados
      this.camera.fov = w >= h ? FOV_DEG : (2 * Math.atan(Math.tan((FOV_DEG * Math.PI) / 360) * (h / w)) * 180) / Math.PI;
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
    // El mismo peso material que usa la anatomía: inserciones y región paravertebral quietas.
    // OFF por defecto no crea los buffers; al apagar después se restauran las posiciones exactas.
    if (resp !== 0 && !this.respiratoryMotion)
      this.respiratoryMotion = bindRespiratoryMotion([this.organs, this.vessels], (m) => this.anatomy.respiratoryWeight(m));
    this.respiratoryMotion?.apply(resp);
    // sonda: base (lateral, elevación, axial) → (x, y, z) locales
    const fr = this.opts.getFrame();
    this.probe.position.set(fr.face[0] * CM, fr.face[1] * CM, fr.face[2] * CM);
    this.probe.setRotationFromMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(...fr.lateral), new THREE.Vector3(...fr.elevation), new THREE.Vector3(...fr.axial)),
    );
    updateFan(this.fan, this.fanEdges, fr, this.transducer, depth);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.releaseRetired();
  }

  private releaseRetired(): void {
    for (const g of this.retired) disposeObject(g);
    this.retired = [];
  }
}
