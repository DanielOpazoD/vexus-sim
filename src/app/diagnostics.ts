import type { EquipmentSettings } from './simulator';
import type { ErrorEntry } from './errorLog';

/**
 * Diagnóstico exportable (Fase 3): lo que un equipo necesita para reproducir un informe de
 * fallo o de fidelidad — versión y commit, navegador y GPU, caso, estado del equipo, fps y
 * últimos errores. Solo datos técnicos y del paciente sintético; nada del usuario.
 */
export interface DiagnosticsInput {
  version: string;
  commit: string;
  buildTime: string;
  userAgent: string;
  gpu: { vendor: string; renderer: string } | null;
  viewport: { width: number; height: number; devicePixelRatio: number };
  caseId: string;
  simTimeS: number;
  fps: number;
  equipment: EquipmentSettings;
  errors: readonly ErrorEntry[];
}

export interface Diagnostics extends DiagnosticsInput {
  format: 'vexus-diagnostico/1';
  createdAt: string;
}

export function buildDiagnostics(input: DiagnosticsInput, now: Date = new Date()): Diagnostics {
  return { format: 'vexus-diagnostico/1', createdAt: now.toISOString(), ...input, errors: [...input.errors] };
}

/** Proveedor y modelo de la GPU si el navegador los expone (WEBGL_debug_renderer_info). */
export function gpuInfo(gl: WebGLRenderingContext | WebGL2RenderingContext | null): { vendor: string; renderer: string } | null {
  if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (!ext) return { vendor: String(gl.getParameter(gl.VENDOR)), renderer: String(gl.getParameter(gl.RENDERER)) };
  return {
    vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)),
    renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
  };
}

/** Nombre de archivo estable para el diagnóstico descargado. */
export function diagnosticsFileName(d: Diagnostics): string {
  return `vexus-diagnostico-${d.version}-${d.commit}-${d.createdAt.replace(/[:.]/g, '-')}.json`;
}

/** Versión y commit en una línea (barra superior). */
export function buildLabel(version: string, commit: string): string {
  return `v${version} · ${commit}`;
}
