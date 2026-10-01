import { setReferenceBody } from './referenceBody';

export async function loadReferenceBody(): Promise<void> {
  const response = await fetch(new URL('./reference-body.bin', import.meta.url));
  if (!response.ok) throw new Error(`Referencia corporal: HTTP ${response.status}`);
  setReferenceBody(new Float32Array(await response.arrayBuffer()));
}
