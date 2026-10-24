// CONTRAFACTUAL DE PRUEBA: producto proyectado histórico, omitía la Hessiana mixta.
// Fuente: 7d94244fb9cae1d8abe3c17ed0644cd32e05fe6a, src/ultrasound/interfaceEcho.ts, tubeCurvature.
// SHA256 del cuerpo original conservado: a53dd73f314ef2c423f03c4d777e5234b2eb9587adc2e3719832ed5e57994d10
// No importar en producción; debe fallar contra la cuadratura en el cilindro isotrópico a45 grados.
float tubeCurvature(Cls c, vec3 n, vec3 dir, float r, float se) {
  vec3 circ = cross(n, c.tangent);
  float cl = length(circ);
  if (cl < 1e-4) return 1.0;
  circ /= cl;
  vec3 lat = normalize(cross(uElev, dir));
  float sl = lateralSigmaMm(r);                       // dos vías (beamModel)
  float sE = se * 0.70710678;                         // elevSigma es de una vía
  float kl = dot(lat, circ); kl = kl * kl * c.kc;
  float ke = dot(uElev, circ); ke = ke * ke * c.kc;
  float k = uIfaceK0 * echoFrequency(r);              // el número de onda del eco (decisión 84)
  float al = 2.0 * k * sl * sl * kl;
  float ae = 2.0 * k * sE * sE * ke;
  return inversesqrt(sqrt((1.0 + al * al) * (1.0 + ae * ae)));
}
