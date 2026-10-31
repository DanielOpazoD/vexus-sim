import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type * as TS from 'typescript';
import type { Plugin } from 'vite';

// Three 0.186.1. Subsistemas sin ningún consumidor en el producto: la app no entra en XR, no proyecta sombras, no usa
// mapas de entorno ni bloques de uniformes. El renderizador los construye siempre, así que el empaquetador no puede
// retirarlos. Una actualización de Three exige repasarlos: un módulo cambiado falla en vez de perder algo en silencio.
const STUBS: Record<string, { sha256: string; code: string }> = {
  'renderers/webxr/WebXRManager.js': {
    sha256: '828834acbac95ab4236af9f23061049686f84d9b66a7bfae27ae92a68af97040',
    code: `import { EventDispatcher } from '../../core/EventDispatcher.js';
export class WebXRManager extends EventDispatcher {
  enabled = false;
  isPresenting = false;
  cameraAutoUpdate = true;
  setAnimationLoop() {}
  getEnvironmentBlendMode() {}
  hasDepthSensing() { return false; }
  dispose() {}
}`,
  },
  'renderers/webgl/WebGLShadowMap.js': {
    sha256: '88669e97ab02b2132a175eb94f9bfeea2a705d5f6c59e677bcb6421f258ff696',
    code: `import { PCFShadowMap } from '../../constants.js';
export function WebGLShadowMap() {
  this.enabled = false;
  this.autoUpdate = true;
  this.needsUpdate = false;
  this.type = PCFShadowMap;
  this.render = () => {};
}`,
  },
  'extras/PMREMGenerator.js': {
    sha256: '78f7cc24a9aa22852f4c46052f39e5fe5507bee6313a824851ba899ed2219ecc',
    code: `export class PMREMGenerator {
  constructor() { throw new Error('PMREMGenerator retirado del build: el producto no usa mapas de entorno'); }
}`,
  },
  'renderers/webgl/WebGLUniformsGroups.js': {
    sha256: 'ef8e5dabfbf4fb57dabd09614a9482c2e2b691004669e0d6a8ecec58b24a8800',
    code: `export function WebGLUniformsGroups() {
  return { dispose() {} };
}`,
  },
};

const SERIALIZATION = new Set(['toJSON', 'fromJSON']);

let ts: typeof TS | undefined;
const typescript = (): typeof TS => (ts ??= createRequire(import.meta.url)('typescript') as typeof TS);

/** Sustituye un subsistema sin consumidores; null si `id` no es uno de ellos. */
export function stubThreeSubsystem(code: string, id: string): string | null {
  const match = /\/node_modules\/three\/src\/(.+)$/.exec(id.replaceAll('\\', '/'));
  const stub = match && STUBS[match[1]];
  if (!stub) return null;
  if (createHash('sha256').update(code).digest('hex') !== stub.sha256)
    throw new Error(`Three 0.186.1 cambió ${match[1]}: repasa sus consumidores antes de actualizar el contrato`);
  return stub.code;
}

/** Quita `toJSON`/`fromJSON` de las clases de Three: nada serializa escenas, y arrastran cargadores y curvas enteras. */
export function stripThreeSerialization(code: string, id: string): string | null {
  if (!/\/node_modules\/three\/(?:src|examples\/jsm)\/.+\.js$/.test(id.replaceAll('\\', '/'))) return null;
  if (!/\b(?:toJSON|fromJSON)\b/.test(code)) return null;
  const t = typescript();
  const source = t.createSourceFile(id, code, t.ScriptTarget.Latest, true, t.ScriptKind.JS);
  const spans: Array<[number, number]> = [];
  const visit = (node: TS.Node): void => {
    if (t.isClassLike(node))
      for (const member of node.members)
        if (t.isMethodDeclaration(member) && SERIALIZATION.has(member.name.getText(source)))
          spans.push([member.getFullStart(), member.end]);
    t.forEachChild(node, visit);
  };
  visit(source);
  if (!spans.length) return null;
  let out = code;
  for (const [start, end] of spans.reverse()) out = out.slice(0, start) + out.slice(end);
  return out;
}

/** Va antes de los demás transformadores de Three: el resto de la cadena ya no ve lo retirado. */
export function threeUnusedSubsystems(): Plugin {
  return {
    name: 'three-unused-subsystems',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const out = stubThreeSubsystem(code, id) ?? stripThreeSerialization(code, id);
      return out === null ? null : { code: out, map: null };
    },
  };
}
