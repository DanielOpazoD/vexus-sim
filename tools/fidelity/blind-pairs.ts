/**
 * Prueba ciega de fidelidad (decisión 52, docs/fidelity/juez-ciego.md): captura las vistas del
 * simulador y monta cada recorte junto a una ecografía real de licencia libre (Wikimedia Commons)
 * con la misma normalización; sortea el orden y escribe las claves aparte.
 *
 *   npm run dev
 *   npm run fidelity:blind -- --out /tmp/ciego
 *
 * Salida: <out>/pares/parN.png y <out>/sueltas/imgNN.jpg (lo único que ven los jueces) y
 * <out>/claves/{pares,sueltas}.json (lo que no ven). Las reales se cargan desde Commons en el
 * navegador (hace falta red) y solo se guardan como recorte derivado, en gris.
 */
import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const URL = args.get('url') ?? 'http://localhost:6600';
const OUT = args.get('out') ?? 'test-results/fidelity-blind';

type Case = 'normal-adult' | 'severe-congestion';
type View = 'subxiphoid' | 'intercostal' | 'flank' | 'renal';
/** Recorte [x0, y0, ancho] en píxeles nativos; alto = ancho · 3/4. */
type Crop = readonly [number, number, number];
interface Pair {
  id: number;
  tema: string;
  sim: { scene: `${Case}/${View}`; crop: Crop };
  real: { file: string; crop: Crop; cred: string };
}

/**
 * Captura del lienzo a 1440 × 900 con densidad 2: 1720 × 1228 px, 63,5 px/cm a 18 cm (`sectorLayout`;
 * las marcas de la regla van por el borde inclinado 34°: 5 cm = 263 px en vertical).
 */
const SIM_SIZE = [1720, 1228] as const;
/**
 * Recortes enteros dentro del abanico (vértice ≈ (860, −308), borde derecho x ≈ 1115 + 0,676·(y − 75))
 * y, en las reales, dentro de su sector y lejos de rótulos; escala física parecida (6–11 cm de ancho).
 * Ronda 2 (25-09-2026, tras las decisiones 58–63): el intercostal nuevo (8.º espacio) ya no muestra el
 * riñón, así que la pareja 2 sale de la ventana renal, y la compresión (63) acerca las estructuras a la
 * sonda; los recortes se movieron para que cada pareja siga mostrando su tema.
 */
const PAIRS: readonly Pair[] = [
  {
    id: 1,
    tema: 'hígado con vena hepática',
    sim: { scene: 'normal-adult/intercostal', crop: [680, 520, 440] },
    real: { file: 'Ultrasonography_of_a_normal_liver.jpg', crop: [290, 160, 440], cred: 'Mikael Häggström, CC0' },
  },
  {
    id: 2,
    tema: 'hígado y riñón derecho',
    sim: { scene: 'normal-adult/renal', crop: [520, 300, 520] },
    real: { file: 'Ultrasound_liver_right_lobe_and_right_kidney.jpg', crop: [335, 200, 290], cred: 'Ptrump16, CC BY-SA 4.0' },
  },
  {
    id: 3,
    tema: 'riñón en eje largo',
    sim: { scene: 'normal-adult/renal', crop: [500, 260, 640] },
    real: { file: 'MorisonNoText.png', crop: [450, 300, 640], cred: 'Drahreg01, CC BY-SA 3.0' },
  },
  {
    id: 4,
    tema: 'VCI en eje largo (normal)',
    sim: { scene: 'normal-adult/subxiphoid', crop: [880, 500, 520] },
    real: { file: 'Ultrasound_image_IVC_110321140522_1406460.jpg', crop: [160, 205, 340], cred: 'Nevit Dilmen, CC BY-SA 3.0' },
  },
  {
    id: 5,
    tema: 'VCI ancha (congestión)',
    sim: { scene: 'severe-congestion/subxiphoid', crop: [840, 480, 540] },
    real: { file: 'Ultrasound_image_IVC_110317193740_1949000.jpg', crop: [140, 200, 360], cred: 'Nevit Dilmen, CC BY-SA 3.0' },
  },
  {
    id: 6,
    tema: 'campo cercano: pared e hígado',
    sim: { scene: 'normal-adult/flank', crop: [640, 90, 380] },
    real: { file: 'Ultrasound_image_IVC_110316103934_1043260.jpg', crop: [205, 120, 250], cred: 'Nevit Dilmen, CC BY-SA 3.0' },
  },
  {
    id: 7,
    tema: 'venas hepáticas anchas',
    sim: { scene: 'severe-congestion/intercostal', crop: [640, 500, 480] },
    real: { file: 'Ultrasound_image_IVC_110318083647_0841470.jpg', crop: [200, 190, 250], cred: 'Nevit Dilmen, CC BY-SA 3.0' },
  },
];
const PANEL = [600, 450] as const;
/** Fracción de píxeles casi negros tolerada en una esquina de 24 × 24 (más = borde del sector). */
const CORNER_MAX = 0.3;

const dataUrl = (png: Buffer, type = 'image/png'): string => `data:${type};base64,${png.toString('base64')}`;
const allLoaded = (page: Page) =>
  page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60_000 });

async function captureScene(browser: Browser, scene: Pair['sim']['scene']): Promise<Buffer> {
  const [cs, view] = scene.split('/') as [Case, View];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${URL}/?e2e=1&docente=1`);
  await page.waitForFunction(
    () => /\d+ fps/.test(document.querySelector('#status')?.textContent ?? '') && typeof window.__vexusTest === 'object',
    null,
    {
      timeout: 60_000,
    },
  );
  await page.selectOption('#case-select', cs);
  await page.waitForTimeout(1500);
  await page
    .locator('button', { hasText: /Apnea\s*esp/ })
    .first()
    .click();
  await page.evaluate((id) => {
    window.__vexusTest!.goToStartPoint(id);
    window.__vexusTest!.advance(0.5);
  }, view);
  await page.waitForTimeout(2500); // persistencia y cuadros en tiempo real
  const png = await page.locator('#gl').screenshot();
  const size = await page.evaluate(() => {
    const c = document.getElementById('gl') as HTMLCanvasElement;
    return [c.width, c.height];
  });
  await page.close();
  if (size[0] !== SIM_SIZE[0] || size[1] !== SIM_SIZE[1])
    throw new Error(`lienzo de ${size.join('×')} px: los recortes están definidos para ${SIM_SIZE.join('×')}`);
  return png;
}

/** Recorte en gris a `tw` píxeles de ancho (la resolución nativa común de la pareja). */
async function nativeCrop(page: Page, src: string, crop: Crop, tw: number): Promise<Buffer> {
  const [x0, y0, cw] = crop;
  const s = tw / cw;
  const th = Math.round(tw * 0.75);
  await page.setContent(
    `<body style="margin:0"><div id="c" style="position:relative;overflow:hidden;width:${tw}px;height:${th}px;background:#000"><img id="i" src="${src}" style="position:absolute;filter:grayscale(1);left:${-x0 * s}px;top:${-y0 * s}px;transform-origin:0 0"></div></body>`,
  );
  await allLoaded(page);
  await page.evaluate((scale) => {
    const img = document.getElementById('i') as HTMLImageElement;
    img.style.width = `${img.naturalWidth * scale}px`;
    img.style.height = `${img.naturalHeight * scale}px`;
  }, s);
  return page.locator('#c').screenshot();
}

/** Panel de 600 × 450 con la misma recompresión JPEG, y fracción negra de sus cuatro esquinas. */
async function panel(page: Page, native: Buffer): Promise<{ jpg: Buffer; corners: number[] }> {
  await page.setContent(
    `<body style="margin:0"><img id="p" src="${dataUrl(native)}" style="display:block;width:${PANEL[0]}px;height:${PANEL[1]}px"></body>`,
  );
  await allLoaded(page);
  const jpg = await page.locator('#p').screenshot({ type: 'jpeg', quality: 90 });
  await page.setContent(`<body style="margin:0"><img id="q" src="${dataUrl(jpg, 'image/jpeg')}"></body>`);
  await allLoaded(page);
  const corners = await page.evaluate(([W, H]) => {
    const img = document.getElementById('q') as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    // sin funciones con nombre: tsx (esbuild con keepNames) las envuelve en `__name(…)`, que no existe en la página
    return [
      [0, 0],
      [W - 24, 0],
      [0, H - 24],
      [W - 24, H - 24],
    ].map(([cx, cy]) => {
      let n = 0;
      for (let y = cy; y < cy + 24; y++) for (let x = cx; x < cx + 24; x++) if (d[(y * W + x) * 4] < 6) n++;
      return n / (24 * 24);
    });
  }, PANEL);
  return { jpg, corners };
}

for (const d of ['pares', 'sueltas', 'claves']) mkdirSync(join(OUT, d), { recursive: true });
const gpuArgs =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: true, args: gpuArgs });
try {
  const scenes = new Map<string, Buffer>();
  for (const p of PAIRS) if (!scenes.has(p.sim.scene)) scenes.set(p.sim.scene, await captureScene(browser, p.sim.scene));

  // 3 o 4 reales en A, al azar
  let realInA: boolean[];
  do realInA = PAIRS.map(() => randomInt(2) === 0);
  while (realInA.filter(Boolean).length < 3 || realInA.filter(Boolean).length > 4);

  const page = await browser.newPage({ viewport: { width: 1260, height: 520 } });
  const keyPairs: Record<number, unknown> = {};
  const singles: { pair: number; kind: 'sim' | 'real'; jpg: Buffer }[] = [];
  for (const [i, p] of PAIRS.entries()) {
    const tw = Math.min(p.sim.crop[2], p.real.crop[2]);
    const sim = await panel(page, await nativeCrop(page, dataUrl(scenes.get(p.sim.scene)!), p.sim.crop, tw));
    const real = await panel(
      page,
      await nativeCrop(page, `https://commons.wikimedia.org/wiki/Special:FilePath/${p.real.file}`, p.real.crop, tw),
    );
    const leaks = [...sim.corners, ...real.corners].some((c) => c > CORNER_MAX);
    if (leaks) console.warn(`par ${p.id}: una esquina es negra (¿borde del sector?): revisa el recorte`, sim.corners, real.corners);
    const [a, b] = realInA[i] ? [real, sim] : [sim, real];
    keyPairs[p.id] = {
      tema: p.tema,
      real: realInA[i] ? 'A' : 'B',
      resolucionNativa: tw,
      fuenteReal: `${p.real.file} (${p.real.cred})`,
      esquinasSospechosas: leaks,
    };
    await page.setContent(
      `<body style="margin:0;background:#111;color:#ddd;font:20px sans-serif;display:flex;gap:20px;padding:20px">${[a, b]
        .map(
          (x, k) =>
            `<div style="display:flex;flex-direction:column;gap:8px"><div>${'AB'[k]}</div><img src="${dataUrl(x.jpg, 'image/jpeg')}" width="${PANEL[0]}" height="${PANEL[1]}"></div>`,
        )
        .join('')}</body>`,
    );
    await allLoaded(page);
    writeFileSync(join(OUT, 'pares', `par${p.id}.png`), await page.screenshot());
    singles.push({ pair: p.id, kind: 'sim', jpg: sim.jpg }, { pair: p.id, kind: 'real', jpg: real.jpg });
  }
  for (let i = singles.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [singles[i], singles[j]] = [singles[j], singles[i]];
  }
  const keySingles: Record<string, unknown> = {};
  singles.forEach((s, i) => {
    const name = `img${String(i + 1).padStart(2, '0')}`;
    keySingles[name] = { par: s.pair, tipo: s.kind };
    writeFileSync(join(OUT, 'sueltas', `${name}.jpg`), s.jpg);
  });
  writeFileSync(join(OUT, 'claves', 'pares.json'), `${JSON.stringify(keyPairs, null, 1)}\n`);
  writeFileSync(join(OUT, 'claves', 'sueltas.json'), `${JSON.stringify(keySingles, null, 1)}\n`);
  console.log(`prueba ciega → ${OUT} (${PAIRS.length} pares, ${singles.length} sueltas; claves en ${join(OUT, 'claves')})`);
} finally {
  await browser.close();
}
