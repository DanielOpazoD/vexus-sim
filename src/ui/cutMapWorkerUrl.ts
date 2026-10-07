/** Desarrollo sirve el módulo TS; producción lo emite en el grafo compartido. */
export default new URL('./cutMapWorker.ts', import.meta.url).href;
