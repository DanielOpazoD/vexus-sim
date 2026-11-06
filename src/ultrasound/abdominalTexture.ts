import type { InstalledCpuPerson, PersonGpuPlan } from '../anatomy/person';
/** One bounded source volume; historical renderers bind a complete 4-byte dummy texture. */
export function createAbdominalTexture(
  gl: WebGL2RenderingContext,
  enabled: boolean,
  thoracic = false,
  person?: InstalledCpuPerson,
  gpu?: PersonGpuPlan,
): WebGLTexture {
  const data = thoracic ? person?.assets.buffers.thoracic : person?.assets.buffers.abdominal,
    meta = thoracic ? person?.assets.descriptor.thoracic : person?.assets.descriptor.abdominal;
  if (enabled && !data) throw new Error('Campo abdominal CPU ausente');
  const dimensions = enabled ? meta!.textureDimensions : [1, 1, 1];
  if (dimensions.some((d) => d > gl.getParameter(gl.MAX_3D_TEXTURE_SIZE))) throw new Error('GPU sin capacidad para el atlas abdominal');
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture: atlas abdominal');
  gl.bindTexture(gl.TEXTURE_3D, texture);
  if (enabled) {
    const [width, height, depth] = dimensions;
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RG16F, width, height, depth);
    const plane = width * height * 2;
    // Limita el staging del command buffer sin otra copia CPU ni alterar un texel.
    const slices = Math.max(1, Math.floor((4 * 1024 * 1024) / (plane * 2)));
    for (let z = 0; z < depth; z += slices) {
      const count = Math.min(slices, depth - z);
      gl.texSubImage3D(
        gl.TEXTURE_3D,
        0,
        0,
        0,
        z,
        width,
        height,
        count,
        gl.RG,
        gl.HALF_FLOAT,
        data!.subarray(z * plane, (z + count) * plane),
      );
    }
    if (!thoracic)
      for (const { offset, size, data } of gpu?.uploads ?? [])
        gl.texSubImage3D(gl.TEXTURE_3D, 0, offset[0], offset[1], offset[2], size[0], size[1], size[2], gl.RG, gl.HALF_FLOAT, data);
  } else {
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG16F, 1, 1, 1, 0, gl.RG, gl.HALF_FLOAT, new Uint16Array([0x4c00, 0]));
  }
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
  if (gl.getError() !== gl.NO_ERROR) {
    gl.deleteTexture(texture);
    throw new Error('No se pudo subir el atlas abdominal');
  }
  return texture;
}
