import { abdominalAtlas } from '../anatomy/abdominalAtlas';
import { ABDOMINAL_ATLAS } from '../anatomy/abdominalAtlasData';

/** One bounded source volume; historical renderers do not allocate an abdominal texture. */
export function createAbdominalTexture(gl: WebGL2RenderingContext, enabled: boolean): WebGLTexture {
  if (enabled && !abdominalAtlas) throw new Error('Campo abdominal CPU ausente');
  const dimensions = enabled ? ABDOMINAL_ATLAS.textureDimensions : [1, 1, 1];
  if (dimensions.some((d) => d > gl.getParameter(gl.MAX_3D_TEXTURE_SIZE))) throw new Error('GPU sin capacidad para el atlas abdominal');
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture: atlas abdominal');
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RG16F,
    dimensions[0],
    dimensions[1],
    dimensions[2],
    0,
    gl.RG,
    gl.HALF_FLOAT,
    enabled ? abdominalAtlas! : new Uint16Array([0x4c00, 0]),
  );
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
  if (gl.getError() !== gl.NO_ERROR) {
    gl.deleteTexture(texture);
    throw new Error('No se pudo subir el atlas abdominal');
  }
  return texture;
}
