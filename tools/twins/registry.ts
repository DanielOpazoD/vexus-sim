/**
 * Registro de gemelos (decisión 322, punto 5): cada par de implementaciones de lo mismo —TypeScript en la CPU (página o
 * Worker del corte) y GLSL en la GPU, o la CPU de la página y la del Worker— con las pruebas que demuestran que dicen lo
 * mismo. `src/validation/twinRegistry.test.ts` lo hace cumplir y `tools/twins/inventory.ts` escribe el inventario de
 * `docs/engineering/gemelos.md`.
 *
 * Vive en `tools/` y no en `src/`: `glslMinify` reserva del renombrado todo identificador que aparezca en una cadena de un
 * módulo de `src` (salvo las pruebas), y los nombres GLSL de este registro dejarían esas funciones sin renombrar.
 *
 * Convención (`docs/engineering/gemelos.md`):
 * - un par se declara aquí con un `id` y se marca con `@twin <id>` en el comentario inmediatamente anterior a la
 *   declaración de un símbolo de cada lado: una función TS del lado CPU y una plantilla (constante o función TS que lleva
 *   la GLSL) del lado GPU; nunca dentro del texto GLSL, cuyos bytes fija `s0028WallGpu.test.ts`;
 * - la palabra «gemelo» en un comentario TS va con su `@twin`; en el texto GLSL, solo delante de una función registrada;
 * - una función GLSL con el nombre de una función TS (exportada o no) es un gemelo por nombre (decisión 46) y está en
 *   algún par;
 * - cada par nombra sus pruebas: `gpu`/`worker` demuestran la paridad con números; `texto` solo la inspecciona.
 */

/** Cómo sostiene una prueba la paridad de un par. */
export type EvidenceKind =
  /** Ejecuta la GLSL en WebGL (la e2e de la CI, con SwiftShader) y la compara número a número con el gemelo TS. */
  | 'gpu'
  /** Compara la CPU de la página con el Worker del corte, número a número. */
  | 'worker'
  /** Lee el texto GLSL (constantes interpoladas, mismas expresiones o nombres) sin ejecutarlo. */
  | 'texto';

export interface TwinEvidence {
  kind: EvidenceKind;
  /** `src/validation/*.test.ts` (vitest) o `e2e/*.spec.ts` (Playwright en la CI). */
  file: string;
  /** Fragmento literal del título de la prueba (`it`/`test`). */
  title: string;
  /** Lo que la prueba cubre del par cuando no es todo. */
  scope?: string;
}

export interface TwinSide {
  file: string;
  /**
   * Lado CPU: declaraciones TS (funciones, constantes, clases o métodos). Lado GPU: funciones GLSL del archivo (de una
   * plantilla `/* glsl *\/` o de una cadena con GLSL). Lado Worker: funciones que el Worker llama.
   */
  symbols: readonly string[];
  /** Lado GPU: declaraciones TS que llevan la GLSL (constantes `*_GLSL`, `FRAG_*`, funciones que la montan). */
  templates?: readonly string[];
}

export interface TwinPair {
  id: string;
  /** Una frase: qué calculan los dos lados. */
  what: string;
  kind: 'cpu-glsl' | 'cpu-worker';
  /** Lado TS de la CPU (la página). */
  cpu: readonly TwinSide[];
  /** Lado GLSL (o el Worker del corte en `cpu-worker`). */
  gpu: readonly TwinSide[];
  evidence: readonly TwinEvidence[];
  /**
   * Lo que la comparación numérica no cubre o por qué no la hay. Obligatorio si ninguna prueba es `gpu`/`worker`; con
   * una prueba numérica y un hueco, el par es `parcial`.
   */
  gap?: string;
}

export type TwinStatus = 'demostrada' | 'parcial' | 'inspeccion' | 'sin-paridad';

/**
 * Demostrada si una prueba compara números y no queda hueco; parcial si la compara con un hueco declarado (`gap`);
 * inspección si solo se lee el texto GLSL; si no, sin paridad.
 */
export function twinStatus(pair: Pick<TwinPair, 'evidence' | 'gap'>): TwinStatus {
  if (pair.evidence.some((e) => e.kind === 'gpu' || e.kind === 'worker')) return pair.gap ? 'parcial' : 'demostrada';
  return pair.evidence.length > 0 ? 'inspeccion' : 'sin-paridad';
}

const E = {
  equivalence: {
    kind: 'gpu',
    file: 'e2e/equivalence.spec.ts',
    title: 'la anatomía GLSL coincide con la TypeScript en tejido, vaso y velocidad',
  },
  reference: {
    kind: 'gpu',
    file: 'e2e/referenceAdult.spec.ts',
    title: 'el adulto de referencia carga el mismo campo corporal para imagen y consulta TS/GPU',
  },
  atlas: { kind: 'gpu', file: 'e2e/abdominalAtlas.spec.ts', title: 'abdomen de producción: todos los campos y velocidades CPU/GPU' },
  thoracic: {
    kind: 'gpu',
    file: 'e2e/thoracicAtlas.spec.ts',
    title: 'all 24 registered ribs agree in production CPU/GPU and preserve intercostal spaces',
  },
  faceNormals: {
    kind: 'gpu',
    file: 'e2e/smoke.spec.ts',
    title: 'las normales de la GPU coinciden con el gradiente de la distancia de TS en las caras que dan brillo',
  },
  transmission: {
    kind: 'gpu',
    file: 'e2e/smoke.spec.ts',
    title: 'la pasada A en cuatro etapas da la misma transmisión de un solo rayo que el modelo de CPU; la de la imagen, la de sus gemelos',
  },
  steered: {
    kind: 'gpu',
    file: 'e2e/liverTexture.spec.ts',
    title: 'composición espacial: más SNR con el mismo grano, sin huecos, y la mirada dirigida de la GPU igual a su gemelo',
  },
  facets: {
    kind: 'gpu',
    file: 'e2e/facetCompression.spec.ts',
    title: 'facetas y espejo pleural conservan la paridad bajo compresión y respiración en WebGL2',
  },
  organNames: {
    kind: 'texto',
    file: 'src/validation/organs.test.ts',
    title: 'cada función GLSL tiene su gemela TS exportada y el shader la incluye',
  },
  s0028Solids: {
    kind: 'gpu',
    file: 'e2e/s0028SolidsGpu.spec.ts',
    title: 'la GPU s0028 clasifica los sólidos con la política P3 de la CPU: dueños, conflicto, riñón U con contorno, grasa D',
  },
  s0028Wall: {
    kind: 'gpu',
    file: 'e2e/s0028WallGpu.spec.ts',
    title: 'la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU',
  },
} as const satisfies Record<string, TwinEvidence>;
/** Lo que la e2e de los sólidos s0028 (r3 de P3) compara de la clasificación: tejido y cara, no los valores intermedios. */
const S0028_CLASSIFICATION =
  'resultado en la clasificación s0028 (tejido y cara) de nodos renales, cajas de grasa, conflictos, planos renales y diez ventanas';

export const TWINS: readonly TwinPair[] = [
  // ——— Anatomía: escena, primitivas y deformación (ANATOMY_GLSL) ———
  {
    id: 'clasificacion',
    what: 'Tejido, vaso, cara y distancia de un punto material: `AnatomyScene.classify` y `classifyWith` en el mismo orden.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/scene.ts', symbols: ['classify', 'classifyWall', 'classifyInside'] }],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: ['classify', 'classifyWith', 'classifyWall', 'classifyInside'],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
      { file: 'src/anatomy/gpu/s0028Wall.glsl.ts', symbols: ['classifyWall'], templates: ['s0028WallShader'] },
      { file: 'src/anatomy/gpu/s0028Solids.glsl.ts', symbols: ['classifyWith', 'classifyInside'], templates: ['S0028_CLASSIFY_GLSL'] },
    ],
    evidence: [
      E.equivalence,
      E.reference,
      E.atlas,
      { ...E.s0028Solids, scope: 'clasificación s0028 con los dueños P3: nodos, cajas de grasa, conflictos, planos y ventanas' },
      { ...E.s0028Wall, scope: 'clasificación s0028 en la banda de la pared y testigos sólidos' },
      {
        kind: 'texto',
        file: 'src/validation/pleura.test.ts',
        title: 'la GLSL: classify es classifyWith(m, true) y la cortina solo se mira con withCurtain',
      },
    ],
  },
  {
    id: 'cara-gradiente',
    what: 'Gradiente sin normalizar de la distancia de la cara que dibuja un punto (normal del eco de interfaz).',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/scene.ts', symbols: ['faceGradient'] }],
    gpu: [{ file: 'src/anatomy/gpu/anatomy.glsl.ts', symbols: ['faceGradient'], templates: ['anatomyGlsl', 'ANATOMY_GLSL'] }],
    evidence: [
      E.faceNormals,
      { kind: 'gpu', file: 'e2e/vertebralCortex.spec.ts', title: 'cortical vertebral: cara, normales y hueso CPU/GPU' },
      {
        kind: 'texto',
        file: 'src/validation/faceGradient.test.ts',
        title: 'GLSL: el gradiente sin normalizar de los tubos, la norma de las diferencias centrales y δ con |∇|',
      },
    ],
  },
  {
    id: 'pared-interna',
    what: 'Profundidad bajo la cara interna de la pared (0 en la pleura parietal), donde A0 busca el cruce de la pleura.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/scene.ts', symbols: ['insideWallMm'] }],
    gpu: [
      { file: 'src/anatomy/gpu/anatomy.glsl.ts', symbols: ['insideWallMm'], templates: ['anatomyGlsl', 'ANATOMY_GLSL'] },
      { file: 'src/anatomy/gpu/s0028Wall.glsl.ts', symbols: ['insideWallMm'], templates: ['s0028WallShader'] },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/pleura.test.ts',
        title: 'la GLSL: classify es classifyWith(m, true) y la cortina solo se mira con withCurtain',
        scope: 'fija el texto exacto de la función GLSL',
      },
    ],
    gap: 'Ninguna e2e lee insideWallMm de la GPU: A0 la usa para el cruce de la pleura y la paridad de A2/A parte de los segmentos que A0 ya escribió. En s0028 la sustituye `s0028WallShader` (`s28Inside`), comparada con la CPU solo dentro de la banda de la pared.',
  },
  {
    id: 'cortina-receso',
    what: 'Cortina pulmonar bajo la pared y receso costodiafragmático en la escena (envoltorios de `organs/lungCurtain.ts`).',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/scene.ts', symbols: ['inLungCurtain', 'inLungRecess', 'lungEdgeMm'] }],
    gpu: [
      {
        file: 'src/anatomy/organs/lungCurtain.ts',
        symbols: ['lungCurtainDistance', 'inLungRecess', 'lungCurtainEdgeMm'],
        templates: ['LUNG_CURTAIN_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/pleura.test.ts',
        title: 'la GLSL de A0 lleva la misma marcha que el gemelo',
      },
    ],
    gap: 'Las usa A0 para el cruce de la pleura y la paridad e2e de A2/A parte de los segmentos que A0 ya escribió.',
  },
  {
    id: 'tubos',
    what: 'Vasos y conductos: ruido del radio con su hash, consulta del tubo que gana y gradiente analítico de su cara.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/primitives.ts', symbols: ['tubeHash', 'tubeNoise', 'tubeQuery', 'tubeFaceGradient'] }],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: ['tubeHash', 'tubeNoise', 'tubeQuery', 'tubeFace'],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      {
        kind: 'texto',
        file: 'src/validation/vesselShape.test.ts',
        title: 'la GLSL es el gemelo: la forma viaja en el téxel H4 de cada tubo y el ruido usa el mismo hash, celda y sal',
      },
    ],
  },
  {
    id: 'columna',
    what: 'Cuerpos, discos y arco vertebrales, su unión y la curvatura de la cara cortical.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/anatomy/primitives.ts', symbols: ['sdSpine', 'spineBodySd', 'spineArchSd', 'spineDistances', 'spineFaceCurvature'] },
    ],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: ['spineSd', 'spineBodySd', 'spineArchSd', 'spineBodyParts', 'spineFaceCurvature'],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      { kind: 'gpu', file: 'e2e/vertebralCortex.spec.ts', title: 'cortical vertebral: cara, normales y hueso CPU/GPU' },
      {
        kind: 'texto',
        file: 'src/validation/spine.test.ts',
        title: 'GLSL: la columna con las constantes de SPINE_SHAPE, la cara tras la clasificación y el eco de la cortical',
      },
    ],
  },
  {
    id: 'tronco-primitivas',
    what: 'Profundidad y normal del tronco, cuerpo de referencia, SDF genéricos (elipsoide, esfera, uniones suaves) y costillas.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/primitives.ts',
        symbols: [
          'torsoDepth',
          'torsoNormal',
          'torsoDepthGradient',
          'sdEllipsoid',
          'sdEllipsoidLocal',
          'smoothMin',
          'smoothMax',
          'sdSphere',
          'ribDistanceLowerBound',
          'sdRib',
          'sdRibBone',
        ],
      },
      { file: 'src/anatomy/referenceBody.ts', symbols: ['bodyGradient'] },
    ],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: [
          'torsoDepth',
          'torsoNormal',
          'bodyGradient',
          'sdEllipsoid',
          'sdEllipsoidLocal',
          'smoothMin',
          'smoothMax',
          'sdSphere',
          'ribDistanceLowerBound',
          'sdRib',
          'sdRibBone',
        ],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
      { file: 'src/anatomy/organs/wall.ts', symbols: ['torsoDepthGrad'], templates: ['WALL_GLSL'] },
      { file: 'src/anatomy/gpu/personShader.ts', symbols: ['torsoDepth', 'torsoNormal', 'torsoDepthGrad'], templates: ['personShader'] },
    ],
    evidence: [
      E.equivalence,
      E.reference,
      { ...E.s0028Wall, scope: 'banda de la pared s0028' },
      { ...E.s0028Solids, scope: S0028_CLASSIFICATION },
    ],
    gap: 'En s0028, `torsoDepth`, `torsoNormal` y `torsoDepthGrad` de `personShader` se comparan por su resultado en la clasificación s0028 (`s0028WallGpu.spec.ts`, `s0028SolidsGpu.spec.ts`), no valor a valor.',
  },
  {
    id: 'cupula',
    what: 'Altura del diafragma: inserción costal y la hemicúpula más alta.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/primitives.ts', symbols: ['diaphragmHeight'] }],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: ['domeHeight', 'domeLift', 'sdDome'],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      { kind: 'gpu', file: 'e2e/diaphragmAxis.spec.ts', title: 'eje diafragmático sin singularidad CPU/GPU' },
      { kind: 'gpu', file: 'e2e/diaphragmJunction.spec.ts', title: 'unión diafragmática y tejidos vecinos CPU/GPU' },
    ],
  },
  {
    id: 'deformacion',
    what: 'Mundo → material (compresión y respiración), velocidad del tejido y peso respiratorio con su gradiente exacto.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/anatomy/deformation.ts', symbols: ['toMaterial', 'tissueVelocity'] },
      { file: 'src/anatomy/respiratoryNormals.ts', symbols: ['respiratoryWeightGradient'] },
      { file: 'src/anatomy/scene.ts', symbols: ['respiratoryWeight'] },
    ],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: ['toMaterial', 'tissueVelocity', 'respWeight', 'respWeightGradient', 'anatomyWarpAt'],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
      { file: 'src/anatomy/gpu/s0028Wall.glsl.ts', symbols: ['respWeight', 'respWeightGradient'], templates: ['s0028WallShader'] },
    ],
    evidence: [
      { ...E.equivalence, scope: 'mundo → material con respiración y compresión, en la clasificación' },
      E.facets,
      {
        kind: 'gpu',
        file: 'e2e/s0028WallGpu.spec.ts',
        title: 'la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU',
        scope: 'peso respiratorio y su gradiente (variante s0028)',
      },
    ],
    gap: '`tissueVelocity` (velocidad del tejido para el Doppler) no se compara: la e2e compara la de la sangre.',
  },
  {
    id: 'compresion',
    what: 'Campo de compresión de la sonda: spline, elevación, inversa y jacobiana para las normales.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/compression.ts',
        symbols: ['compressionElevation', 'compressionSample', 'uncompress', 'warpAt', 'warpNormal', 'warpBound', 'smoothstepSlope'],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/compression.ts',
        symbols: ['compressionElevation', 'compressionSample', 'uncompress', 'warpAt', 'warpNormal', 'warpBound', 'smoothstepSlope'],
        templates: ['COMPRESSION_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/compressionSpline.spec.ts',
        title: 'compresión cúbica: desplazamiento, jacobiana y normales TS/GLSL en nodos y extremos',
      },
      E.facets,
      {
        kind: 'texto',
        file: 'src/validation/compression.test.ts',
        title: 'la GLSL lleva las mismas constantes y funciones, y toMaterial deshace la compresión antes que la respiración',
      },
    ],
  },
  {
    id: 'atlas-abdominal',
    what: 'Campos del atlas abdominal (distancia y rótulo), su gradiente y la cúpula registrada.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/abdominalAtlas.ts',
        symbols: [
          'abdominalAtlasValue',
          'abdominalAtlasSdf',
          'abdominalAtlasGradient',
          'registeredDomeValue',
          'registeredDomeSample',
          'hepaticDomeValue',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/abdominalAtlas.ts',
        symbols: [
          'abdominalAtlasValue',
          'abdominalAtlasSdf',
          'abdominalAtlasGradient',
          'registeredDomeValue',
          'registeredDomeSample',
          'hepaticDomeValue',
        ],
        templates: ['ABDOMINAL_ATLAS_GLSL'],
      },
      {
        file: 'src/anatomy/gpu/personShader.ts',
        symbols: ['abdominalAtlasValue', 'registeredDomeSample', 'hepaticDomeValue'],
        templates: ['personShader'],
      },
    ],
    evidence: [
      E.atlas,
      { kind: 'gpu', file: 'e2e/atlasQuadratusCaps.spec.ts', title: 'Atlas renal muscle ends agree in production through probe movement' },
      { kind: 'gpu', file: 'e2e/hepaticContact.spec.ts', title: 'registered hepatic contact agrees across the production classifiers' },
      {
        kind: 'gpu',
        file: 'e2e/registeredRoof.spec.ts',
        title: 'techo registrado y vecinos mantienen tejidos, interfaces y normales CPU/GPU',
      },
      { ...E.s0028Solids, scope: S0028_CLASSIFICATION },
    ],
    gap: 'El lector s0028 de `personShader` (`abdominalAtlasValue` y las cúpulas vacías) se compara por su resultado en la clasificación s0028 (`s0028SolidsGpu.spec.ts`, `s0028WallGpu.spec.ts`), no valor a valor.',
  },
  {
    id: 'atlas-toracico',
    what: 'Campo óseo torácico registrado: distancia, material, gradiente y marco de la superficie ósea.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/thoracicAtlas.ts',
        symbols: ['thoracicValue', 'thoracicSdf', 'thoracicMaterial', 'thoracicGradient', 'boneSurfaceFrame', 'thoracicFrame'],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/thoracicAtlas.ts',
        symbols: ['thoracicValue', 'thoracicSdf', 'thoracicMaterial', 'thoracicGradient', 'boneSurfaceFrame', 'thoracicFrame'],
        templates: ['THORACIC_GLSL'],
      },
      { file: 'src/anatomy/gpu/personShader.ts', symbols: ['thoracicValue', 'thoracicMaterial'], templates: ['personShader'] },
    ],
    evidence: [
      E.thoracic,
      { kind: 'gpu', file: 'e2e/thoracicCoverage.spec.ts', title: 'doce pares, extremos libres y esternón: misma barrera CPU/GPU' },
      { ...E.s0028Solids, scope: S0028_CLASSIFICATION },
    ],
    gap: 'La sustitución s0028 de `thoracicValue` y `thoracicMaterial` (`personShader`) se compara por su resultado en la clasificación s0028 (`s0028SolidsGpu.spec.ts`), no valor a valor.',
  },
  {
    id: 'volumen-fuente',
    what: 'Interpolación trilineal de los ocho nodos de un volumen fuente junto a las interfaces óseas.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/sourceVolume.ts', symbols: ['sourceDistance'] }],
    gpu: [{ file: 'src/anatomy/sourceVolume.ts', symbols: ['sourceDistancePrecise'], templates: ['SOURCE_DISTANCE_GLSL'] }],
    evidence: [E.thoracic, E.atlas],
  },
  {
    id: 'cartilago-referencia',
    what: 'Cartílago costal del adulto de referencia: distancia, tangente y curvatura.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/referenceCartilage.ts', symbols: ['referenceCartilage'] }],
    gpu: [{ file: 'src/anatomy/gpu/referenceCartilage.glsl.ts', symbols: ['referenceCartilage'], templates: ['CARTILAGE_GLSL'] }],
    evidence: [E.equivalence, E.reference],
  },
  {
    id: 'moteado-anatomia',
    what: 'Campo complejo de dispersores persistente en coordenadas materiales: hash, retícula y fundido trilineal.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/speckleField.ts', symbols: ['hash13', 'scattererField'] }],
    gpu: [
      {
        file: 'src/anatomy/gpu/anatomy.glsl.ts',
        symbols: ['hash13', 'latticeValueS', 'scattererFieldS', 'scattererField'],
        templates: ['anatomyGlsl', 'ANATOMY_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/parenchymaTexture.test.ts',
        title: 'la retícula de la anatomía elige los nodos fuertes y reparte su fase como el gemelo',
      },
    ],
    gap: 'El moteado solo se ve en la envolvente: la e2e mide su estadística (Rayleigh, persistencia), no el campo nodo a nodo frente al gemelo.',
  },
  {
    id: 'geometria-sector',
    what: 'Dirección de la línea y punto del sector a una profundidad.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/probe/probe.ts', symbols: ['pointOnLine'] }],
    gpu: [
      {
        file: 'src/ultrasound/shaders/passes.glsl.ts',
        symbols: ['pointOnLine', 'lineDir'],
        templates: ['BEAM_GEOMETRY_GLSL', 'LINE_DIR_GLSL'],
      },
    ],
    evidence: [
      {
        ...E.equivalence,
        scope: '`FRAG_TISSUEMAP` sitúa cada celda con `lineDir`/`pointOnLine` de la GLSL y el barrido TS con `pointOnLine`',
      },
    ],
  },

  // ——— Módulos de órgano (decisión 46): TS y GLSL en el mismo archivo, mismos nombres ———
  {
    id: 'organo-abdomen',
    what: 'Pared digestiva, tejido gástrico, frontera y plano del gas del abdomen.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/organs/abdomen.ts',
        symbols: ['digestiveWallMm', 'digestiveWallTissue', 'gastricWallTissue', 'gastricBoundary', 'digestiveGasPlane', 'abdomenQuery'],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/organs/abdomen.ts',
        symbols: ['digestiveWallMm', 'digestiveWallTissue', 'gastricWallTissue', 'gastricBoundary', 'digestiveGasPlane', 'abdomenQuery'],
        templates: ['ABDOMEN_GLSL'],
      },
      { file: 'src/anatomy/gpu/personShader.ts', symbols: ['digestiveWallMm', 'digestiveGasPlane'], templates: ['personShader'] },
    ],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/gastricWall.spec.ts',
        title: 'epigastric stomach: folded wall and contents agree on CPU/GPU, without flow or a black cavity',
      },
      { kind: 'texto', file: 'src/validation/gastricWall.test.ts', title: 'la GLSL usa las mismas capas y el mismo pliegue' },
      E.organNames,
      { ...E.s0028Solids, scope: S0028_CLASSIFICATION },
    ],
    gap: 'La sustitución s0028 de `digestiveWallMm` y `digestiveGasPlane` (`personShader`) se compara por su resultado en la clasificación s0028 (`s0028SolidsGpu.spec.ts`), no valor a valor.',
  },
  {
    id: 'organo-intestino',
    what: 'Asas: luz, gas, pared y serosa.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/organs/bowel.ts', symbols: ['bowelQuery', 'bowelSdf', 'bowelGasSdf'] }],
    gpu: [{ file: 'src/anatomy/organs/bowel.ts', symbols: ['bowelQuery', 'bowelSdf', 'bowelGasSdf'], templates: ['BOWEL_GLSL'] }],
    evidence: [
      { kind: 'gpu', file: 'e2e/bowel.spec.ts', title: 'asas: luz, gas, pared y serosa coinciden en CPU/GPU' },
      { kind: 'gpu', file: 'e2e/bowel.spec.ts', title: 'asas: compresión local reversible y gemelo GPU' },
      E.organNames,
    ],
  },
  {
    id: 'organo-esternon',
    what: 'Esternón: semianchura y distancia.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/organs/sternum.ts', symbols: ['sternumHalfWidth', 'sternumSd'] }],
    gpu: [{ file: 'src/anatomy/organs/sternum.ts', symbols: ['sternumHalfWidth', 'sternumSd'], templates: ['STERNUM_GLSL'] }],
    evidence: [
      { kind: 'gpu', file: 'e2e/thoracicCoverage.spec.ts', title: 'doce pares, extremos libres y esternón: misma barrera CPU/GPU' },
      E.organNames,
    ],
  },
  {
    id: 'organo-pared',
    what: 'Pared en capas con relieve, sus caras y costillas (decisiones 62 y 88).',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/organs/wall.ts',
        symbols: [
          'ribSearchDepth',
          'wallArc',
          'wallPerimeter',
          'wallWavenumber',
          'wallDepths',
          'wallPlaneDepth',
          'wallPlaneGap',
          'wallFace',
          'wallFaceDepth',
          'wallFaceSd',
          'wallArcGradient',
          'wallFaceSlope',
          'wallFaceGradient',
          'ribSd',
          'nearestRib',
          'ribTangent',
          'ribCurvature',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/organs/wall.ts',
        symbols: [
          'ribSearchDepth',
          'wallArc',
          'wallPerimeter',
          'wallWavenumber',
          'wallDepths',
          'wallPlaneDepth',
          'wallPlaneGap',
          'wallFace',
          'wallFaceDepth',
          'wallFaceSd',
          'wallArcGradient',
          'wallFaceSlope',
          'wallFaceGradient',
          'ribSd',
          'nearestRib',
          'ribTangent',
          'ribCurvature',
        ],
        templates: ['WALL_GLSL'],
      },
      {
        file: 'src/anatomy/gpu/s0028Wall.glsl.ts',
        symbols: ['wallFaceSd', 'wallFaceGradient', 'wallFaceDepth', 'wallDepths', 'ribSd'],
        templates: ['s0028WallShader'],
      },
    ],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/smoke.spec.ts',
        title: 'pared (decisión 62): líneas brillantes, grasa hipoecoica con septos, músculo con estrías, cortical costal y sus normales',
        scope: 'caras, normales y gradiente de la pared y de las costillas (`wallNormals`)',
      },
      { kind: 'gpu', file: 'e2e/atlasWallNormals.spec.ts', title: 'pared Atlas: caras y normales del modelo compartido coinciden con GPU' },
      E.equivalence,
      {
        kind: 'texto',
        file: 'src/validation/wall.test.ts',
        title: 'la GLSL: un relieve por cara con los términos de la tabla, la fascia con el espesor de grasa del relieve lento',
      },
      E.organNames,
      {
        kind: 'gpu',
        file: 'e2e/s0028WallGpu.spec.ts',
        title: 'la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU',
        scope: 'caras y normales de la pared s0028 (sustituciones de `s0028WallShader`)',
      },
    ],
  },
  {
    id: 'organo-rinon',
    what: 'Riñón: marco local, contorno (procedural y de atlas), grasa perirrenal, seno, pelvis y pirámides.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/organs/kidney.ts',
        symbols: [
          'kidneyLocal',
          'kidneyOuterSdf',
          'kidneyAtlasPoint',
          'atlasKidneyOuter',
          'atlasKidneyOuterGradient',
          'sdRoundCone',
          'softRamp',
          'perirenalThicknessMm',
          'perirenalFromOuter',
          'perirenalOuterSdf',
          'hilumChannelSdf',
          'interiorPoint',
          'kidneySinusSdf',
          'atlasDepthScale',
          'kidneyQuery',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/organs/kidney.ts',
        symbols: [
          'kidneyLocal',
          'kidneyOuterSdf',
          'kidneyAtlasPoint',
          'atlasKidneyOuter',
          'atlasKidneyOuterGradient',
          'sdRoundCone',
          'softRamp',
          'perirenalThicknessMm',
          'perirenalFromOuter',
          'perirenalOuterSdf',
          'hilumChannelSdf',
          'interiorPoint',
          'kidneySinusSdf',
          'atlasDepthScale',
          'kidneyQuery',
        ],
        templates: ['KIDNEY_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      { kind: 'gpu', file: 'e2e/renalEnvelope.spec.ts', title: 'renal adipose/fascial volume agrees on CPU/GPU during probe movement' },
      { kind: 'texto', file: 'src/validation/renalSinus.test.ts', title: 'la GLSL aplica las mismas fronteras que TS' },
      E.organNames,
    ],
  },
  {
    id: 'organo-ligamentos',
    what: 'Fisura umbilical y ligamento venoso del hígado.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/organs/liverLigaments.ts', symbols: ['umbilicalFissureSdf', 'ligamentumVenosumSdf'] }],
    gpu: [
      {
        file: 'src/anatomy/organs/liverLigaments.ts',
        symbols: ['umbilicalFissureSdf', 'ligamentumVenosumSdf'],
        templates: ['LIVER_LIGAMENTS_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      {
        kind: 'texto',
        file: 'src/validation/organs.test.ts',
        title: 'las constantes del shader salen del módulo, no de literales copiados',
      },
      E.organNames,
    ],
  },
  {
    id: 'organo-cortina',
    what: 'Cortina pulmonar: distancia a su frontera, receso y borde.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/organs/lungCurtain.ts', symbols: ['lungCurtainDistance', 'inLungRecess', 'lungCurtainEdgeMm'] }],
    gpu: [
      {
        file: 'src/anatomy/organs/lungCurtain.ts',
        symbols: ['lungCurtainDistance', 'inLungRecess', 'lungCurtainEdgeMm'],
        templates: ['LUNG_CURTAIN_GLSL'],
      },
      { file: 'src/anatomy/gpu/s0028Wall.glsl.ts', symbols: ['lungCurtainEdgeMm', 'inLungRecess'], templates: ['s0028WallShader'] },
    ],
    evidence: [{ ...E.equivalence, scope: '`lungCurtainDistance` dentro de la clasificación' }, E.organNames],
    gap: '`inLungRecess` y `lungCurtainEdgeMm` solo los usa A0 (cruce de la pleura): sin comparación numérica. En s0028 las dos quedan vacías (sin cortina procedural), también sin comparación.',
  },
  {
    id: 'organo-vesicula',
    what: 'Vesícula: segmentos y unión suave con su gradiente exacto.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/organs/gallbladder.ts', symbols: ['gbSegment', 'gallbladderSdf'] }],
    gpu: [{ file: 'src/anatomy/organs/gallbladder.ts', symbols: ['gbSegment', 'gallbladderSdf'], templates: ['GALLBLADDER_GLSL'] }],
    evidence: [
      { kind: 'gpu', file: 'e2e/gallbladderGradient.spec.ts', title: 'pared vesicular: gradiente de la unión suave CPU/GPU' },
      E.equivalence,
      E.organNames,
    ],
  },
  {
    id: 'organo-higado',
    what: 'Hígado: envolvente, cara visceral, recorte posteromedial y su normal.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/organs/liver.ts',
        symbols: [
          'hepaticSpineEnvelopeSd',
          'sminGrad',
          'visceralHeight',
          'visceralFaceDistance',
          'medialCutDistance',
          'medialCutNormal',
          'liverSdf',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/organs/liver.ts',
        symbols: [
          'hepaticSpineEnvelopeSd',
          'sminGrad',
          'visceralHeight',
          'visceralFaceDistance',
          'medialCutDistance',
          'medialCutNormal',
          'liverSdf',
        ],
        templates: ['LIVER_GLSL'],
      },
      { file: 'src/anatomy/gpu/s0028Wall.glsl.ts', symbols: ['visceralHeight'], templates: ['s0028WallShader'] },
    ],
    evidence: [
      E.equivalence,
      { kind: 'gpu', file: 'e2e/hepaticBoundary.spec.ts', title: 'plano retrohepático: cápsula y tejido blando CPU/GPU' },
      {
        kind: 'texto',
        file: 'src/validation/liverCapsuleMedium.test.ts',
        title: 'el shader consulta hacia fuera pese al signo contrario de liverInner, con los mismos coeficientes',
      },
      E.organNames,
      { ...E.s0028Solids, scope: S0028_CLASSIFICATION },
    ],
    gap: 'La sustitución s0028 de `visceralHeight` (`s0028WallShader`) se compara por su resultado en la clasificación s0028 (`s0028SolidsGpu.spec.ts`), no valor a valor.',
  },
  {
    id: 'organo-retroperitoneo',
    what: 'Psoas, cuadrado lumbar y grasa retroperitoneal.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/organs/retroperitoneum.ts',
        symbols: ['psoasSdf', 'quadratusSdf', 'retroFrontY', 'retroFatSdf', 'retroperitoneum'],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/organs/retroperitoneum.ts',
        symbols: ['psoasSdf', 'quadratusSdf', 'retroFrontY', 'retroFatSdf', 'retroperitoneum'],
        templates: ['RETROPERITONEUM_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      { kind: 'gpu', file: 'e2e/posteriorMuscles.spec.ts', title: 'production quadratus field closes at the wall in GPU as in CPU' },
      {
        kind: 'texto',
        file: 'src/validation/retroperitoneum.test.ts',
        title: 'el gemelo GLSL toma las constantes del módulo y classify lo llama tras el hígado',
      },
      E.organNames,
    ],
  },
  {
    id: 'organo-corazon',
    what: 'Corazón y mediastino: marcos, aurícula derecha, cavidades, VCI que entra y tórax.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/organs/heart.ts',
        symbols: ['heartShift', 'heartFrame', 'raFrame', 'raSdf', 'heartChambers', 'raInferiorZ', 'ivcAtrium', 'thorax'],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/organs/heart.ts',
        symbols: ['heartShift', 'heartFrame', 'raFrame', 'raSdf', 'heartChambers', 'raInferiorZ', 'ivcAtrium', 'thorax'],
        templates: ['HEART_GLSL'],
      },
    ],
    evidence: [
      E.equivalence,
      { kind: 'gpu', file: 'e2e/ivcAtrium.spec.ts', title: 'bloque cardíaco registrado conserva paridad CPU/GPU con suelo y vecinos' },
      {
        kind: 'texto',
        file: 'src/validation/heart.test.ts',
        title: 'el GLSL lleva las constantes del módulo y los tejidos y la cara nuevos',
      },
      E.organNames,
    ],
  },

  // ——— Persona s0028 (decisiones 317–321) ———
  {
    id: 's0028-pared',
    what: 'Pared continua s0028: proyección EDT, carta bilineal, cara interna con gradiente analítico, rampas y peso respiratorio.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/anatomy/s0028Wall.ts',
        symbols: [
          's0028WallAt',
          's0028WallSurface',
          's0028WallFaceGradient',
          's0028InsideWall',
          's0028RespiratoryWall',
          's0028RespiratoryRamp',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/anatomy/gpu/s0028Wall.glsl.ts',
        symbols: [
          's28Project',
          's28WallKnown',
          's28WallSurface',
          's28WallAt',
          's28Grad',
          's28FaceGradient',
          's28Ramp',
          's28RespWall',
          's28Inside',
        ],
        templates: ['s0028WallShader'],
      },
    ],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/s0028WallGpu.spec.ts',
        title: 'la GPU s0028 conserva la banda D/E con identidad U y el panículo regional CPU',
      },
      {
        kind: 'texto',
        file: 'src/validation/s0028WallGpu.test.ts',
        title: 'la GPU s0028 pesa la celda U con la rampa por profundidad de su fila y la celda D/E como antes (gemelo de la CPU)',
      },
    ],
  },
  {
    id: 's0028-lector',
    what: 'Lector directo s0028 de los campos abdominal y torácico (distancia, rótulo, gas) y profundidad de la piel.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/anatomy/s0028Source.ts', symbols: ['s0028SourceValue'] },
      { file: 'src/anatomy/abdominalAtlas.ts', symbols: ['s0028Depth', 's0028DepthGradient'] },
    ],
    gpu: [
      { file: 'src/anatomy/gpu/personShader.ts', symbols: ['s28Gas', 's28DepthGradient'], templates: ['personShader'] },
      {
        file: 'src/anatomy/gpu/s0028Solids.glsl.ts',
        symbols: ['s28P', 's28PA', 's28PT', 's28PLA', 's28PLT'],
        templates: ['S0028_READER_GLSL'],
      },
    ],
    evidence: [
      { ...E.s0028Wall, scope: 'clasificación y normales en la banda de la pared' },
      { ...E.s0028Solids, scope: 'distancias y rótulos P1 de los dueños P3 (r3), por su resultado en la clasificación' },
      {
        kind: 'texto',
        file: 'src/validation/s0028P1Reader.test.ts',
        title: 'emite los dos atlas reales y precisión ósea, sin añadir samplers',
      },
    ],
    gap: 'El gas (`s28Gas`) y el gradiente de la piel (`s28DepthGradient`) viven en cadenas sin `/* glsl */` de `personShader` (punto 4) y se comparan por su resultado en las e2e s0028, no valor a valor.',
  },
  {
    id: 's0028-duenos',
    what: 'Dueños P3 de un punto s0028 (campos P1, banda P2 y grasa compatible D por páginas), sin orden: dos o más son conflicto y U.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/s0028Solids.ts', symbols: ['s0028Owners', 's0028CompatibleFat'] }],
    gpu: [{ file: 'src/anatomy/gpu/s0028Solids.glsl.ts', symbols: ['s28POwn', 's28PAdd', 's28PFat'], templates: ['S0028_SOLIDS_GLSL'] }],
    evidence: [
      { ...E.s0028Solids, scope: 'nodos y genéricos renales, cajas de grasa, 119 testigos de conflicto, planos renales y diez ventanas' },
    ],
  },
  {
    id: 's0028-gradiente-renal',
    what: 'Normal de la cara renal s0028: gradiente analítico de la trilineal del riñón, con los ocho nodos de su celda.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/s0028Solids.ts', symbols: ['s0028KidneyGradient'] }],
    gpu: [
      {
        file: 'src/anatomy/gpu/s0028Solids.glsl.ts',
        symbols: ['s28PGrad', 'renalAtlasFaceGradient'],
        templates: ['S0028_SOLIDS_GLSL', 'RENAL_FACE_GLSL'],
      },
    ],
    evidence: [{ ...E.s0028Solids, scope: 'normal y distancia de la cara renal en los nodos renales, D = 0' }],
  },
  {
    id: 's0028-compresion-rigida',
    what: 'Zonas rígidas por dueño en la compresión s0028: σ(d) por nodo (κ, d₁, L), interpolada bajo la pared; la reserva termina en el tramo renal que cruza el anclaje.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/anatomy/compression.ts', symbols: ['rigidDepth', 'tableAt'] }],
    gpu: [{ file: 'src/anatomy/gpu/s0028Solids.glsl.ts', symbols: [], templates: ['RIGID_PROFILE', 'RIGID_FETCH'] }],
    evidence: [
      { ...E.s0028Solids, scope: 'tejido y cara en las diez ventanas con la compresión de su contacto, D = 0/10/20 mm' },
      {
        kind: 'texto',
        file: 'src/validation/s0028WallGpu.test.ts',
        title: 'compresión rígida s0028 (r3): el perfil se evalúa sobre σ(d) con la tabla (κ, d₁, L) del tramo; el default no la lee',
      },
    ],
    gap: 'La jacobiana con σ′ (las normales bajo compresión) no se compara: la e2e compara tejido y cara en las ventanas comprimidas. rigidNode calcula la tabla en CPU; s0028RigidSector comprueba el anclaje en todo el sector. La tabla sigue en apnea (P4).',
  },

  // ——— CPU de la página ↔ Worker del corte ———
  {
    id: 'trabajador-corte',
    what: 'Activos y estado que la página instala y el Worker del corte vuelve a instalar (atlas, cuerpo, pared y sólidos s0028).',
    kind: 'cpu-worker',
    cpu: [
      { file: 'src/anatomy/loadS0028.ts', symbols: ['loadS0028'] },
      { file: 'src/anatomy/abdominalAtlas.ts', symbols: ['setAbdominalAtlas'] },
    ],
    gpu: [{ file: 'src/ui/cutMapWorker.ts', symbols: ['setAbdominalAtlas', 'setThoracicAtlas', 'setS0028Wall', 'setS0028Solids'] }],
    evidence: [
      {
        kind: 'worker',
        file: 'src/validation/s0028SolidsClassify.test.ts',
        title: 'Worker real del corte: el riñón es U rotulado «Riñón derecho · interior U» y el mapa coincide con la CPU bit a bit',
      },
      {
        kind: 'worker',
        file: 'src/validation/s0028SolidsMotion.test.ts',
        title: 'respiración: sólo los estímulos E de 10/20 mm del diseño, mismo material en CPU y Worker bit a bit',
      },
      {
        kind: 'worker',
        file: 'e2e/subcostalMovement.spec.ts',
        title: 'the anatomical worker receives the exact acquisition wall and costal atlas',
      },
      {
        kind: 'worker',
        file: 'e2e/sharedWorker.spec.ts',
        title: 'el trabajador modular conserva clasificación y estado separado al cambiar de caso',
      },
    ],
  },

  // ——— Ultrasonido: pasadas A0–K y su presentación ———
  {
    id: 'espejo-pleural',
    what: 'Dirección reflejada del espejo diafragmático/pleural.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/transmission.ts', symbols: ['mirrorDirection'] }],
    gpu: [{ file: 'src/ultrasound/transmission.ts', symbols: ['mirrorDirection'], templates: ['MIRROR_DIRECTION_GLSL'] }],
    evidence: [E.facets],
  },
  {
    id: 'transmision-a0',
    what: 'A0: marcha de la línea recta, espejo y cruce de la pleura; interpolación de la transmisión entre filas.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/transmission.ts',
        symbols: ['transmissionLerp', 'mirrorCrossing', 'transmissionHitsLine', 'pleuraCrossingLine'],
      },
    ],
    gpu: [
      { file: 'src/ultrasound/transmission.ts', symbols: ['transLerp'], templates: ['TRANSMISSION_LERP_GLSL'] },
      { file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: ['a0Reflected'], templates: ['FRAG_TRANS_HITS'] },
    ],
    evidence: [
      { kind: 'texto', file: 'src/validation/pleura.test.ts', title: 'la GLSL de A0 lleva la misma marcha que el gemelo' },
      {
        kind: 'texto',
        file: 'src/validation/transmission.test.ts',
        title: 'A0 hace la bisección con el número de pasos de TS y A2 publica el espejo exacto desde su alcance',
      },
    ],
    gap: 'La paridad e2e de A2/A lee de la GPU los segmentos que escribió A0: compara lo que viene después, no la marcha de A0.',
  },
  {
    id: 'prefijo-a2',
    what: 'A2: prefijo de atenuación de cada línea (mirada 0 y dirigida), con hueso, gas, espejo y refracción Ψ̃.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/ultrasound/transmissionTwin.ts', symbols: ['prefixDb', 'steeredPrefixDb', 'refractionPsi', 'refractionSlope'] },
      { file: 'src/ultrasound/transmission.ts', symbols: ['segmentDb'] },
    ],
    gpu: [
      {
        file: 'src/ultrasound/shaders/passes.glsl.ts',
        symbols: ['segmentDb'],
        templates: ['FRAG_TRANS_PREFIX', 'FRAG_TRANS_PREFIX_STEERED'],
      },
      { file: 'src/ultrasound/transmission.ts', symbols: ['steeredPrefix'], templates: ['STEERED_PREFIX_GLSL'] },
    ],
    evidence: [
      E.transmission,
      E.steered,
      {
        kind: 'gpu',
        file: 'e2e/dopplerTransmission.spec.ts',
        title: 'GPU acoustic prefixes integrate tissue-specific Doppler loss without altering B',
      },
      { kind: 'texto', file: 'src/validation/transmission.test.ts', title: 'el GLSL dirigido de A2 interpola sus constantes de TS' },
    ],
  },
  {
    id: 'apertura-refraccion',
    what: 'A: transmisión con apertura (conos de emisión y recepción), refracción de las luces y especulares.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/transmissionTwin.ts',
        symbols: [
          'apertureWindowIntegral',
          'apertureCones',
          'apertureEcho',
          'apertureTransmission',
          'steeredApertureEcho',
          'steeredApertureTransmission',
          'refractionGain',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/ultrasound/aperture.ts',
        symbols: ['apW', 'apCones', 'apEcho', 'apertureTransmission', 'steeredApertureTransmission', 'rfPsi', 'rfSlab', 'refractionGain'],
        templates: ['APERTURE_GLSL', 'REFRACTION_GLSL'],
      },
    ],
    evidence: [
      E.transmission,
      E.steered,
      {
        kind: 'texto',
        file: 'src/validation/aperture.test.ts',
        title: 'el GLSL dirigido es el cono de la pasada A con el prefijo dirigido y el radio R·cos θ',
      },
      {
        kind: 'texto',
        file: 'src/validation/refraction.test.ts',
        title: 'la GLSL: A1 escribe el camino de más y el aire en negativo, A2 acumula Ψ̃ y A multiplica su transmisión con apertura',
      },
    ],
  },
  {
    id: 'transmision-doppler',
    what: 'Conversión de una transmisión de la imagen B a la frecuencia Doppler, con las barreras fijas aparte.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/dopplerTransmission.ts', symbols: ['dopplerTransmission'] }],
    gpu: [{ file: 'src/ultrasound/dopplerTransmission.ts', symbols: ['dopplerTransmission'], templates: ['DOPPLER_TRANSMISSION_GLSL'] }],
    evidence: [],
    gap: 'Contrafactual de la decisión 174 conservado para pruebas históricas: ningún programa incluye `DOPPLER_TRANSMISSION_GLSL` y fuera de su prueba unitaria nadie llama a `dopplerTransmission`. El canal Doppler de A2 sí tiene paridad e2e (`prefijo-a2`).',
  },
  {
    id: 'pleura',
    what: 'Pleura y cortina en B: fracción de aire del haz, serie de reverberaciones, deslizamiento y transmisión de detrás.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/pleura.ts',
        symbols: [
          'normalCdf',
          'curtainEdgeSigmaMm',
          'curtainAirFraction',
          'curtainAirFractionAt',
          'curtainSteerWeight',
          'pleuraCapMm',
          'pleuraCoherence',
          'pleuraRoundTrip',
          'seriesPow',
          'pleuraSeriesDepths',
          'aLineOrder',
          'slidingAmplitude',
          'slidingField',
          'pleuraTerms',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/ultrasound/pleura.ts',
        symbols: [
          'normalCdf',
          'curtainEdgeSigmaMm',
          'curtainAirFraction',
          'curtainSteerWeight',
          'pleuraCapMm',
          'pleuraCoherence',
          'pleuraRoundTrip',
          'seriesPow',
          'pleuraSeriesDepths',
          'aLineOrder',
          'slidingAmplitude',
          'slidingField',
          'mediumField',
          'wallField',
        ],
        templates: ['PLEURA_GLSL', 'CURTAIN_AIR_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/pleura.test.ts',
        title: 'la GLSL calcula la fracción con el haz de dos vías y lo que ve del tejido de detrás con 1 − f',
      },
      {
        kind: 'texto',
        file: 'src/validation/pleura.test.ts',
        title: 'lleva las expresiones del gemelo: tope de la transmisión, réplicas, serie, deslizamiento y transmisión de detrás',
      },
      {
        kind: 'texto',
        file: 'src/validation/compound.test.ts',
        title: 'la GLSL de K pesa las dirigidas con la cortina de la mirada 0 (A0 h2 y la fracción de aire de B)',
      },
    ],
    gap: 'La e2e de la pleura mide la imagen (línea pleural, neblina, líneas A) contra umbrales, no la GLSL de B frente a estas funciones.',
  },
  {
    id: 'haz-psf',
    what: 'PSF de la imagen B: anchura lateral y de elevación, ganancia focal y bajada de la frecuencia central.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/ultrasound/beamEcho.ts', symbols: ['focalGain', 'frequencyRatio'] },
      { file: 'src/ultrasound/beamModel.ts', symbols: ['lateralSigmaMm'] },
    ],
    gpu: [
      {
        file: 'src/ultrasound/shaders/passes.glsl.ts',
        symbols: ['focalGain', 'echoFrequency', 'lateralSigmaMm', 'beamFwhm', 'elevSigma'],
        templates: ['LATERAL_PSF_GLSL', 'ELEV_SIGMA_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/psfDepth.test.ts',
        title: 'el GLSL lleva la misma PSF, la misma ganancia y el mismo pulso que el modelo',
      },
    ],
    gap: 'La e2e del foco mide el brillo de la banda focal en la imagen; ninguna compara la PSF de la GPU con estas funciones.',
  },
  {
    id: 'clutter-cd',
    what: 'Pasadas C y D: núcleo lateral con pedestal, réplicas de reverberación y su puerta.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/clutter.ts', symbols: ['lateralKernel', 'reverbGains', 'reverbGateWeight'] }],
    gpu: [{ file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: [], templates: ['FRAG_LATERAL', 'FRAG_AXIAL'] }],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/clutter.test.ts',
        title: 'las pasadas C y D llevan las mismas fórmulas, constantes y pantalla de fase',
      },
    ],
    gap: 'C y D solo se ejecutan dentro de la cadena de la imagen; no hay banco WebGL de sus núcleos.',
  },
  {
    id: 'composicion-k',
    what: 'Pasada K: media de las envolventes válidas de las miradas con su peso.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/compound.ts', symbols: ['compoundEnvelope', 'lookWeight'] }],
    gpu: [
      { file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: ['lookEnvelope'], templates: ['FRAG_COMPOUND'] },
      { file: 'src/ultrasound/compound.ts', symbols: ['lookWeight'], templates: ['COMPOUND_GLSL'] },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/compound.test.ts',
        title: 'el GLSL de K interpola el número de miradas y la rampa, y pesa 1 la mirada 0',
      },
    ],
    gap: 'La e2e del compuesto mide SNR y grano en la imagen; la envolvente de K no se compara con `compoundEnvelope`.',
  },
  {
    id: 'armonico',
    what: 'Acumulación del haz armónico en el campo cercano.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/harmonic.ts', symbols: ['harmonicNearGain'] }],
    gpu: [{ file: 'src/ultrasound/harmonic.ts', symbols: ['harmonicNearGain'], templates: ['HARMONIC_GLSL'] }],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/harmonic.test.ts',
        title: 'el GLSL lleva las mismas fórmulas; el color no lee el haz armónico',
      },
    ],
    gap: 'La e2e de la armónica mide el campo cercano y el ruido de la imagen, no la ganancia frente a `harmonicNearGain`.',
  },
  {
    id: 'faceta-coseno',
    what: 'Coseno de incidencia de la faceta inclinada.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/interfaceEcho.ts', symbols: ['facetCosine'] }],
    gpu: [{ file: 'src/ultrasound/interfaceEcho.ts', symbols: ['facetCosine'], templates: ['FACET_COSINE_GLSL'] }],
    evidence: [E.facets],
  },
  {
    id: 'eco-interfaz',
    what: 'Eco de interfaz en B: perfil de la cara, faceta especular, difusa, lóbulo de la cápsula del atlas y condiciones de cara.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/interfaceEcho.ts',
        symbols: [
          'interfaceEchoField',
          'facetTilt',
          'facetEchoField',
          'diffuseEchoField',
          'atlasCapsuleLobeNormal',
          'faceDelta',
          'faceLitFromProbe',
          'fatAcrossWall',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/ultrasound/interfaceEcho.ts',
        symbols: ['interfaceProfileEcho', 'facetTilt', 'faceEcho', 'faceShape', 'cachedFaceGradient', 'interfaceEcho'],
        templates: ['INTERFACE_ECHO_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/interfaceEcho.test.ts',
        title: 'GLSL: las constantes interpoladas, la faceta, la difusa y su suma en los dos programas de B',
      },
      {
        kind: 'texto',
        file: 'src/validation/interfaceEcho.test.ts',
        title: 'uIface empaqueta (β·10^(K/20)·R_ef·s_ref/s, 2k0σz, 1/(4s²), dos lados) y el gemelo lo lee igual',
      },
      {
        kind: 'texto',
        file: 'src/validation/atlasFaceNormals.test.ts',
        title: 'la GPU usa ese lóbulo solo en la cápsula del atlas, con el mismo paso; el perfil sigue a la distancia local',
      },
    ],
    gap: 'La e2e de los ecos de interfaz mide brillo y costuras en la imagen; la GLSL de B no se compara con `interfaceEchoField` punto a punto.',
  },
  {
    id: 'ruido-receptor',
    what: 'Ruido del receptor por línea de la pasada C: hash en float32 y amplitud por modo.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/receiver.ts', symbols: ['hash12b'] }],
    gpu: [{ file: 'src/ultrasound/receiver.ts', symbols: ['hash12b', 'receiverNoise'], templates: ['RECEIVER_NOISE_GLSL'] }],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/receiver.test.ts',
        title: 'la pasada B toma las constantes de TS y, antes del corte, suma el mismo transitorio que antes',
        scope: 'constantes del receptor en B; el hash de C no se inspecciona',
      },
    ],
    gap: 'El hash de la pasada C no tiene prueba frente a `hash12b`: el ruido solo se mide como estadística en la imagen.',
  },
  {
    id: 'textura-retro',
    what: 'Fascículos y septos del psoas, cuadrado lumbar y grasa retroperitoneal en B.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/retroTexture.ts', symbols: ['retroMuscleAxis', 'fascicleSeptum', 'retroTexture'] }],
    gpu: [
      {
        file: 'src/ultrasound/retroTexture.ts',
        symbols: ['retroMuscleAxis', 'fascicleSeptum', 'retroTexture'],
        templates: ['RETRO_TEXTURE_GLSL'],
      },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/retroTexture.test.ts',
        title: 'factor log-normal anclado, igual con cualquier haz, de potencia media 1 y ~3,2 dB de desviación',
        scope: 'comprueba que los dos programas de B incluyen `RETRO_TEXTURE_GLSL` con sus constantes',
      },
    ],
    gap: 'Sin banco WebGL: la textura solo se mide como estadística de la imagen.',
  },
  {
    id: 'textura-pared',
    what: 'Textura de la pared en B: orientación, septos de la grasa, estrías del músculo y eco de cara plana.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/wallTexture.ts',
        symbols: [
          'wallOrientation',
          'fatSeptum',
          'muscleStriation',
          'wallFaceGain',
          'wallTexture',
          'wallFaceEchoFlat',
          'striationNoise',
          'striationFasciaSlope',
          'wallFaceNoise',
        ],
      },
    ],
    gpu: [
      {
        file: 'src/ultrasound/wallTexture.ts',
        symbols: [
          'wallOrientation',
          'fatSeptum',
          'muscleStriation',
          'wallFaceGain',
          'wallTexture',
          'wallFaceEchoFlat',
          'striationNoise',
          'striationFasciaSlope',
          'wallFaceNoise',
        ],
        templates: ['WALL_TEXTURE_GLSL'],
      },
      { file: 'src/anatomy/gpu/s0028Wall.glsl.ts', symbols: ['muscleStriation'], templates: ['s0028WallShader'] },
    ],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/wall.test.ts',
        title: 'la GLSL: el mismo gradiente y el eco de cara plana en la pared que copia la serie, sin faceGradient',
      },
      {
        kind: 'texto',
        file: 'src/validation/wallFaceContinuity.test.ts',
        title: 'la GPU aplica el mismo tope a la variación de las caras',
      },
    ],
    gap: 'Las e2e de estrías y septos (`muscleStriationNormals`, `wallSeptumNormals`) comparan la GLSL con un oráculo GLSL, no con estas funciones TS. En s0028 `s0028WallShader` deja `muscleStriation` sin capas procedurales, tampoco comparada.',
  },
  {
    id: 'moteado-campo',
    what: 'Campo de dispersores de la pasada B por tejido: rebanada, fase de la mirada, ruido de valor, grumos y densidad.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/speckleField.ts',
        symbols: ['speckleSliceField', 'latticeValuePh', 'scattererFieldPh', 'valueNoise', 'strongScatter', 'clumpGain', 'densityGain'],
      },
    ],
    gpu: [
      { file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: ['scattererFieldSlice', 'speckleField'], templates: ['rawFieldShader'] },
      {
        file: 'src/ultrasound/speckleField.ts',
        symbols: ['latticeValuePh', 'scattererFieldPh', 'valueNoise', 'strongScatter', 'clumpGain', 'densityGain'],
        templates: ['SPECKLE_LOOK_GLSL', 'SPECKLE_TISSUE_GLSL'],
      },
    ],
    evidence: [
      { kind: 'texto', file: 'src/validation/speckleField.test.ts', title: 'el GLSL de la mirada lleva la misma fórmula que el gemelo' },
      { kind: 'texto', file: 'src/validation/parenchymaTexture.test.ts', title: 'las constantes por tejido salen de TS en float32 exacto' },
    ],
    gap: 'La e2e del moteado mide su estadística y su persistencia en la imagen, no el campo frente al gemelo.',
  },
  {
    id: 'miradas-direccion',
    what: 'Geometría de las miradas dirigidas: ángulo, elemento, fase y cobertura de cada mirada y la muestra dirigida de B.',
    kind: 'cpu-glsl',
    cpu: [
      {
        file: 'src/ultrasound/steering.ts',
        symbols: ['steerBeta', 'alongLineMm', 'steeredElement', 'lookPhase', 'lookPhaseGrad', 'lookCoverage', 'steeredSample'],
      },
    ],
    gpu: [
      {
        file: 'src/ultrasound/steering.ts',
        symbols: ['steerBeta', 'alongLineMm', 'steeredElement', 'lookPhase', 'lookPhaseGrad', 'lookCoverage'],
        templates: ['STEERING_GLSL'],
      },
      {
        file: 'src/ultrasound/shaders/passes.glsl.ts',
        symbols: ['steeredField', 'steeredT', 'steeredPleura'],
        templates: ['STEERED_FIELD_GLSL'],
      },
    ],
    evidence: [
      { kind: 'texto', file: 'src/validation/steering.test.ts', title: 'el GLSL lleva las mismas fórmulas (sin constantes de TS sueltas)' },
      { kind: 'texto', file: 'src/validation/steeredSample.test.ts', title: 'el GLSL lleva las mismas expresiones que el gemelo' },
      { kind: 'texto', file: 'src/validation/steeredSample.test.ts', title: 'el GLSL lleva la misma pleura del camino que el gemelo' },
    ],
    gap: 'La geometría dirigida de A2/A sí entra en la paridad e2e de `prefijo-a2` y `apertura-refraccion`; la muestra dirigida de B no.',
  },
  {
    id: 'triadas-portales',
    what: 'Tríadas portales: hash entero PCG3D, números de la célula y brillo de la tríada.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/portalTriads.ts', symbols: ['pcg3d', 'cellRandoms', 'portalTriadGain'] }],
    gpu: [{ file: 'src/ultrasound/portalTriads.ts', symbols: ['triadPcg', 'portalTriad'], templates: ['PORTAL_TRIADS_GLSL'] }],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/equivalence.spec.ts',
        title: 'las tríadas portales de la GPU son las del gemelo TS, punto a punto (decisión 78)',
      },
      {
        kind: 'texto',
        file: 'src/validation/portalTriads.test.ts',
        title: 'el hash es entero y sin simetrías: cada célula y cada parámetro, su número; la GPU recibe los mismos',
      },
    ],
  },
  {
    id: 'textura-reposo',
    what: 'Perfil de la pared intestinal en reposo y su textura.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/restTexture.ts', symbols: ['bowelWallProfile', 'restTexture'] }],
    gpu: [{ file: 'src/ultrasound/restTexture.ts', symbols: ['bowelWallProfile', 'restTexture'], templates: ['REST_TEXTURE_GLSL'] }],
    evidence: [
      {
        kind: 'texto',
        file: 'src/validation/restTexture.test.ts',
        title: 'el shader comparte parámetros y no genera asas con uSeed ni valueNoise',
      },
    ],
    gap: 'Sin banco WebGL del perfil.',
  },
  {
    id: 'filtro-pared-color',
    what: 'Respuesta del filtro de pared del Color (dos biquads) y su fase, la misma que la del PW.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/ultrasound/colorWallFilter.ts', symbols: ['colorWallResponseHz'] },
      { file: 'src/doppler/wallFilter.ts', symbols: ['WallFilter'] },
    ],
    gpu: [
      { file: 'src/ultrasound/colorWallFilter.ts', symbols: ['colorWallResponseHz', 'colorPhase'], templates: ['COLOR_WALL_FILTER_GLSL'] },
    ],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/colorWallFilter.spec.ts',
        title: 'GPU color filter: sampled aliases and disabled stationary signal remain finite',
      },
    ],
  },
  {
    id: 'mezcla-color',
    what: 'Mezcla sangre/clutter/ruido del Color: autocorrelación por submuestra con la ganancia de potencia.',
    kind: 'cpu-glsl',
    cpu: [
      { file: 'src/ultrasound/colorGain.ts', symbols: ['colorPowerGain'] },
      { file: 'src/doppler/wallFilter.ts', symbols: ['WallFilter'] },
    ],
    gpu: [{ file: 'src/ultrasound/colorMixture.ts', symbols: [], templates: ['COLOR_MIXTURE_GLSL'] }],
    evidence: [
      {
        kind: 'gpu',
        file: 'e2e/colorMixture.spec.ts',
        title: 'Color suma autocorrelaciones de cada submuestra antes de estimar fase y potencia',
      },
    ],
  },
  {
    id: 'mapa-color',
    what: 'Paleta del Color: la barra de la UI y la de la GPU.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/colorMap.ts', symbols: ['colorMapRgb'] }],
    gpu: [{ file: 'src/ultrasound/colorMap.ts', symbols: ['colorVelocityMap'], templates: ['COLOR_MAP_GLSL'] }],
    evidence: [{ kind: 'gpu', file: 'e2e/colorMap.spec.ts', title: 'barra CPU y paleta GPU coinciden desde cero hasta Nyquist' }],
  },
  {
    id: 'ganancia-campo-cercano',
    what: 'Recta de ganancia del campo cercano en la presentación (`displayGrey`).',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/ultrasound/renderer.ts', symbols: ['nearFieldTgcDb'] }],
    gpu: [{ file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: ['tgcAt', 'displayDb'], templates: ['DISPLAY_GREY_GLSL'] }],
    evidence: [{ kind: 'texto', file: 'src/validation/nearFieldDisplay.test.ts', title: 'la GPU usa la misma recta' }],
    gap: 'La presentación se mide en la imagen; la recta de la GPU no se lee frente a `nearFieldTgcDb`.',
  },

  // ——— Gemelos de validación: cadenas de la GPU rehechas en TS, solo para pruebas y bancos ———
  {
    id: 'gemelo-interfaz',
    what: 'Cadena B → C → D de los ecos de interfaz en 2D (banco de las caras, β y PSF).',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/validation/support/interfaceTwin.ts', symbols: ['simulate', 'lineDir', 'elevSigma', 'calibrateBeta'] }],
    gpu: [
      {
        file: 'src/ultrasound/shaders/passes.glsl.ts',
        symbols: ['lineDir', 'elevSigma'],
        templates: ['FRAG_RAWFIELD', 'FRAG_LATERAL', 'FRAG_AXIAL'],
      },
    ],
    evidence: [],
    gap: 'Banco de diseño: calibra β y la PSF en 2D; la GPU se mide aparte con el banco de fidelidad, no frente a este gemelo.',
  },
  {
    id: 'gemelo-pleura',
    what: 'Pleura y cortina en 2D: la serie, la neblina y el deslizamiento de B → C → D.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/validation/support/pleuraTwin.ts', symbols: ['simulatePleura'] }],
    gpu: [{ file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: [], templates: ['FRAG_RAWFIELD', 'FRAG_LATERAL', 'FRAG_AXIAL'] }],
    evidence: [],
    gap: 'Banco de diseño de la decisión 61; la imagen de la GPU se mide con `pleuraStats`, no frente al gemelo.',
  },
  {
    id: 'gemelo-pared',
    what: 'Eco de la pared en una línea con su textura y su PSF (banco de la decisión 62).',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/validation/support/wallTwin.ts', symbols: ['wallTwin', 'classifyModel'] }],
    gpu: [{ file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: [], templates: ['FRAG_RAWFIELD', 'FRAG_LATERAL', 'FRAG_AXIAL'] }],
    evidence: [],
    gap: 'Banco de diseño; la GPU se mide con el banco de fidelidad (`wallStats`).',
  },
  {
    id: 'gemelo-compuesto',
    what: 'Envolventes de las miradas en un parche (correlación entre miradas del compuesto).',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/validation/support/compoundTwin.ts', symbols: ['lookPatchEnvelopes', 'elevSigmaMm'] }],
    gpu: [{ file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: [], templates: ['FRAG_RAWFIELD_STEERED', 'FRAG_COMPOUND'] }],
    evidence: [],
    gap: 'Banco de diseño de la decisión 58; la GPU mide la correlación entre miradas en su propia imagen.',
  },
  {
    id: 'rejilla-segmentos',
    what: 'Rejilla de segmentos de A0/A1 construida en TS desde la escena, sobre la que suman los gemelos de A2 y A.',
    kind: 'cpu-glsl',
    cpu: [{ file: 'src/validation/support/segmentGrid.ts', symbols: ['segmentGridFromScene', 'lookTransmission'] }],
    gpu: [{ file: 'src/ultrasound/shaders/passes.glsl.ts', symbols: [], templates: ['FRAG_TRANS_HITS', 'FRAG_TRANSMISSION'] }],
    evidence: [],
    gap: 'Las pruebas unitarias de A2/A la usan como entrada; la paridad e2e lee la rejilla real de la GPU (`readSegments`) en su lugar.',
  },
];

/**
 * Pares sin ninguna prueba de paridad, congelados el 05-11-2026 (decisión 322, punto 5). Un par nuevo sin prueba rompe
 * la CI; esta lista solo puede encoger: un par que gane una prueba sale de ella.
 */
export const SIN_PARIDAD_ACEPTADA: readonly string[] = [
  'transmision-doppler',
  'gemelo-interfaz',
  'gemelo-pleura',
  'gemelo-pared',
  'gemelo-compuesto',
  'rejilla-segmentos',
];

/**
 * Funciones GLSL cuyos literales están también escritos a mano en su homónima TS, por archivo GLSL (decisión 322, punto
 * 5; clases de `tools/twins/constants.ts`, inventario del 05-11-2026): `copiados`, la secuencia ordenada de literales con
 * signo de la GLSL aparece seguida en la de la TS (55). Generarlas desde una sola fuente cuesta hoy +16…+63 B
 * minificados por función (`glslCompact` conserva el blanco junto a una interpolación) y el bundle no puede crecer: la
 * prueba exige que cada una siga en su clase y que una copia nueva se registre, hasta que la composición GLSL del punto 4
 * las interpole sin coste. Los archivos pendientes se miden pero no se congelan (ninguno desde la r3 de P3). Para regenerar:
 * `node --import tsx tools/twins/constants.ts`.
 */
export const CONSTANTES_COPIADAS: Readonly<Record<string, readonly string[]>> = {
  'src/anatomy/gpu/anatomy.glsl.ts': [
    'tubeHash',
    'spineFaceCurvature',
    'torsoNormal',
    'bodyGradient',
    'sdEllipsoid',
    'sdEllipsoidLocal',
    'smoothMin',
    'smoothMax',
    'hash13',
    'scattererField',
  ],
  'src/anatomy/compression.ts': ['warpBound', 'smoothstepSlope'],
  'src/anatomy/gpu/personShader.ts': ['registeredDomeSample', 'hepaticDomeValue'],
  'src/anatomy/gpu/s0028Wall.glsl.ts': ['visceralHeight', 'muscleStriation'],
  'src/anatomy/organs/abdomen.ts': ['digestiveWallTissue', 'digestiveGasPlane'],
  'src/anatomy/organs/bowel.ts': ['bowelGasSdf'],
  'src/anatomy/organs/wall.ts': ['wallArc', 'wallPlaneGap', 'wallFace', 'wallFaceDepth', 'wallFaceGradient', 'nearestRib'],
  'src/anatomy/organs/kidney.ts': ['sdRoundCone', 'softRamp', 'perirenalThicknessMm', 'hilumChannelSdf', 'interiorPoint', 'kidneySinusSdf'],
  'src/anatomy/organs/liver.ts': ['visceralFaceDistance', 'medialCutDistance', 'medialCutNormal'],
  'src/anatomy/organs/retroperitoneum.ts': ['retroperitoneum'],
  'src/anatomy/organs/heart.ts': ['heartShift', 'raInferiorZ'],
  'src/ultrasound/dopplerTransmission.ts': ['dopplerTransmission'],
  'src/ultrasound/pleura.ts': ['normalCdf', 'curtainSteerWeight', 'pleuraCapMm', 'seriesPow', 'pleuraSeriesDepths', 'aLineOrder'],
  'src/ultrasound/compound.ts': ['lookWeight'],
  'src/ultrasound/interfaceEcho.ts': ['facetTilt'],
  'src/ultrasound/receiver.ts': ['hash12b'],
  'src/ultrasound/retroTexture.ts': ['retroMuscleAxis'],
  'src/ultrasound/wallTexture.ts': ['wallOrientation', 'wallFaceGain', 'wallTexture'],
  'src/ultrasound/steering.ts': ['alongLineMm', 'lookPhase', 'lookPhaseGrad', 'lookCoverage'],
};

/**
 * Como `CONSTANTES_COPIADAS`, las `reordenados` (22): cada literal de la GLSL, con su signo, está en la TS pero no en
 * ese orden (`max(x, 0.0)` frente a `Math.max(0, x)`, la cuenta repartida en varias líneas). Un literal nuevo o con
 * otro signo en un solo lado las saca de su clase; un intercambio entre literales que ya están en los dos lados, no.
 */
export const CONSTANTES_REORDENADAS: Readonly<Record<string, readonly string[]>> = {
  'src/anatomy/gpu/anatomy.glsl.ts': ['spineArchSd'],
  'src/anatomy/abdominalAtlas.ts': ['registeredDomeSample'],
  'src/anatomy/thoracicAtlas.ts': ['thoracicGradient', 'boneSurfaceFrame'],
  'src/anatomy/gpu/referenceCartilage.glsl.ts': ['referenceCartilage'],
  'src/anatomy/gpu/personShader.ts': ['digestiveWallMm'],
  'src/anatomy/organs/abdomen.ts': ['digestiveWallMm', 'gastricBoundary'],
  'src/anatomy/organs/bowel.ts': ['bowelQuery'],
  'src/anatomy/organs/wall.ts': ['ribSearchDepth', 'ribCurvature'],
  'src/anatomy/organs/kidney.ts': ['atlasDepthScale'],
  'src/anatomy/organs/liver.ts': ['visceralHeight'],
  'src/ultrasound/aperture.ts': ['refractionGain'],
  'src/ultrasound/harmonic.ts': ['harmonicNearGain'],
  'src/ultrasound/retroTexture.ts': ['fascicleSeptum'],
  'src/ultrasound/wallTexture.ts': ['fatSeptum', 'striationNoise'],
  'src/ultrasound/speckleField.ts': ['scattererFieldPh', 'valueNoise', 'clumpGain'],
  'src/ultrasound/colorWallFilter.ts': ['colorWallResponseHz'],
};

/**
 * Funciones GLSL con el nombre de una función TS (exportada o no) que no son su gemela (nombre GLSL → motivo). Vacía
 * hoy: cada homónimo está en un par.
 */
export const HOMONIMOS_NO_GEMELOS: Readonly<Record<string, string>> = {};

/**
 * Archivos cuyos comentarios «gemelo» aún no llevan `@twin` y cuyos lados quedan con el marcador pendiente (decisión 322,
 * regla de colisión). Vacía desde la r3 de P3, que migró `scene.ts`, `s0028Wall.glsl.ts` y `personShader.ts` y congeló sus
 * constantes.
 */
export const ARCHIVOS_PENDIENTES: Readonly<Record<string, string>> = {};
