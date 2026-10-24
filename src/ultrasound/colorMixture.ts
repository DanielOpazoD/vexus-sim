import { COLOR_WALL_FILTER_GLSL } from './colorWallFilter';

/** Expected lag-one correlations of the five spatial samples, not acquired IQ ensembles.
 * Each component retains its own sampled phase and wall-filter response before mixing.
 * The estimated width and stationary filter model are unchanged. */
export const COLOR_MIXTURE_GLSL = /* glsl */ `
${COLOR_WALL_FILTER_GLSL}
vec4 colorMixture(float frequency[5], bool blood[5], float bloodPower, float tissuePower,
                  float width, float cutoff, float prf, out vec2 tissueR1) {
  vec4 result = vec4(0.0);
  tissueR1 = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float f = frequency[i];
    float power = colorWallResponseHz(f, cutoff, prf) * (blood[i] ? bloodPower : tissuePower) / 5.0;
    float phase = 6.2831853 * f / prf;
    vec2 r1 = power * vec2(cos(phase), sin(phase));
    if (blood[i]) {
      float rho = exp(-2.0 * pow(3.14159265 * abs(f) * width / prf, 2.0));
      result.xy += rho * r1;
      result.z += power;
    } else {
      tissueR1 += r1;
      result.w += power;
    }
  }
  return result;
}
`;
