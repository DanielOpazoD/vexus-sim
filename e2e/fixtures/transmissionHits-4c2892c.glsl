#version 300 es
precision highp float;precision highp int;
const int T_AIR=0,T_SOFT=1,T_LUNG=2,T_BONE=3,T_GAS=4;
uniform float uDepth;uniform vec4 uFixture;
struct Cls{int tissue;vec3 n;};
vec3 toMaterial(vec3 p){return p;}
float lineTheta(float x){return (x-.5)*1.1;}
vec3 lineDir(float a){return vec3(sin(a),0,cos(a));}
vec3 pointOnLine(vec3 dir,float r){return vec3(0)+dir*r;}
float insideWallMm(vec3 p){return p.z-6.0;}
float lungCurtainEdgeMm(vec3 p){return uFixture.w>0.0?1.0:-100.0;}
float lungCurtainDistance(vec3 p,float inside){return uFixture.w>0.0&&p.z>=6.0&&p.z<=(uFixture.w>1.5?360.0:10.0)?1.0:-1.0;}
bool inLungRecess(vec3 p,float inside){return uFixture.w>0.0&&p.z>=6.0&&p.z<=(uFixture.w>1.5?360.0:10.0);}
Cls classifyWith(vec3 p,bool curtain){Cls c;c.n=vec3(0,0,-1);c.tissue=p.z<2.0?T_AIR:T_SOFT;
if(uFixture.y>0.0&&p.z>=uFixture.y&&p.z<uFixture.y+2.0)c.tissue=T_BONE;
if(uFixture.z>0.0&&p.z>=uFixture.z&&p.z<uFixture.z+3.0)c.tissue=T_GAS;
if(uFixture.x>0.0&&p.z>=uFixture.x)c.tissue=T_LUNG;
if(curtain&&lungCurtainDistance(p,insideWallMm(p))>=0.0)c.tissue=T_LUNG;return c;}
Cls classify(vec3 p){return classifyWith(p,true);}
float tissueFlag(int t){return t==T_BONE?2.0:(t==T_LUNG||t==T_GAS?1.0:0.0);}
float tissueAlpha(int t){return t==T_AIR?0.0:0.5;}
mat3 anatomyWarpAt(vec3 a,vec3 b){return mat3(1.0);}
vec3 mirrorDirection(vec3 d,vec3 n,mat3 warp){return d-2.0*dot(d,n)*n;}
uniform float uCoarseN;
in vec2 vUv;
layout(location = 0) out vec4 h0; // (segmento del espejo, del primer gas, del primer hueso, tipo de gas)
layout(location = 1) out vec4 h1; // (dirección reflejada, r del espejo)
layout(location = 2) out vec4 h2; // pleura parietal (decisión 61): (D, dz, ΔL dB, 3 + 4·(último seg. de la cortina + 1))
// dB ida y vuelta del segmento con la regla de A1
float segmentDb(int t, float step) {
  float flag = tissueFlag(t);
  return flag > 0.5 && flag < 1.5 ? 60.0 * step / 10.0 : 2.0 * tissueAlpha(t) * (step / 10.0);
}
void main() {
  vec3 dir0 = lineDir(lineTheta(vUv.x));
  float step = uDepth / uCoarseN;
  int n = int(uCoarseN);
  vec3 origin = pointOnLine(dir0, 0.0);
  vec3 dir = dir0;
  vec3 hitPoint = origin;
  float hitR = 0.0;
  float mirrorSeg = -1.0, gasSeg = -1.0, boneSeg = -1.0, gasKind = 0.0;
  float pleuraD = -1.0, pleuraDz = 0.0, curtainDb = 0.0, prevInside = -1.0, curtainLast = -1.0;
  bool entered = false;
  bool curtainRun = false;
  bool crossed = false;
  // Una sola clasificación por vuelta (classifyWith inlineado una vez, como classify antes de la decisión 61):
  // tras una muestra de la lámina de la cortina, la vuelta siguiente (behind) clasifica la misma muestra sin la
  // cortina, lo de detrás de la lámina, y suma su ΔL. Hasta 2·512 vueltas para 512 muestras.
  bool behind = false;
  float lungDb = 0.0;
  int s = -1;
  for (int it = 0; it < 1024; it++) {
    if (!behind) s++;
    if (s >= n) break;
    float r = (float(s) + 0.5) * step;
    vec3 p = mirrorSeg >= 0.0 ? hitPoint + dir * (r - hitR) : origin + dir * r;
    vec3 m = toMaterial(p);
    Cls c = classifyWith(m, !behind);
    if (behind) {
      // ΔL: lo que el gas de la cortina cuesta de más frente al tejido de detrás
      curtainDb += lungDb - segmentDb(c.tissue, step);
      behind = false;
      continue;
    }
    // Pleura parietal: primer cruce exacto de la cara interna de la pared, si cae en el receso cerca del borde
    if (mirrorSeg < 0.0 && !crossed) {
      float inside = insideWallMm(m);
      if (inside >= 0.0 && prevInside < 0.0) {
        crossed = true;
        float lo = max(r - step, 0.0);
        float hi = r;
        for (int it = 0; it < 6; it++) {
          float mid = 0.5 * (lo + hi);
          if (insideWallMm(toMaterial(origin + dir0 * mid)) >= 0.0) hi = mid; else lo = mid;
        }
        float rp = 0.5 * (lo + hi);
        float dz = lungCurtainEdgeMm(toMaterial(origin + dir0 * rp));
        if (dz > -20.0) { pleuraD = rp; pleuraDz = dz; }
      }
      prevInside = inside;
    }
    // Hueco entre la cara convexa y la piel: gel de acoplamiento (el acoplamiento va aparte).
    if (c.tissue == T_AIR && !entered) continue;
    entered = true;
    float flag = tissueFlag(c.tissue);
    // pulmón que toca la pared en el receso (la cortina o el tórax) y el que le sigue pegado (aire con aire),
    // solo si su pleura está registrada y el pulmón empieza pegado a ella (si el cruce cae fuera de la huella, o
    // la línea roza el borde y llega al pulmón del receso mucho más hondo, el modelo de antes: el espejo)
    curtainRun = c.tissue == T_LUNG && mirrorSeg < 0.0 && (curtainRun || (pleuraD >= 0.0 && float(s) * step <= pleuraD + 1.0 * step && inLungRecess(m, insideWallMm(m))));
    if (flag > 0.5 && flag < 1.5) {
      if (curtainRun) {
        // ni espejo ni impacto de gas; en la lámina, la vuelta siguiente clasifica lo de detrás (ΔL). Fuera de ella
        // (el pulmón del tórax que le sigue pegado) classifyWith sin la cortina da el mismo pulmón: ΔL 0, sin vuelta
        lungDb = segmentDb(c.tissue, step);
        curtainLast = float(s);
        behind = lungCurtainDistance(m, insideWallMm(m)) >= 0.0;
        continue;
      }
      if (c.tissue == T_LUNG && mirrorSeg < 0.0) {
        // Cruce exacto con la pleura (decisión 57): bisección entre la muestra gruesa anterior (que no es
        // pulmón) y esta. Antes el espejo quedaba en el centro de la primera celda de pulmón (0–1,1 mm
        // dentro) y dejaba una costura negra entre el diafragma y su imagen especular.
        float lo = max(r - step, 0.0);
        float hi = r;
        vec3 nn = c.n;
        for (int it = 0; it < 6; it++) {
          float mid = 0.5 * (lo + hi);
          Cls cm = classify(toMaterial(origin + dir * mid));
          if (cm.tissue == T_LUNG) { hi = mid; nn = cm.n; } else lo = mid;
        }
        mirrorSeg = float(s); hitR = 0.5 * (lo + hi); hitPoint = origin + dir * hitR;
        dir = mirrorDirection(dir, nn, anatomyWarpAt(hitPoint, toMaterial(hitPoint)));
        if (gasSeg < 0.0) { gasSeg = float(s); gasKind = 1.0; }
        continue;
      }
      if (gasSeg < 0.0) { gasSeg = float(s); gasKind = 2.0; }
      continue;
    }
    if (flag > 1.5 && boneSeg < 0.0) boneSeg = float(s);
  }
  h0 = vec4(mirrorSeg, gasSeg, boneSeg, gasKind);
  h1 = vec4(dir, hitR);
  h2 = pleuraD >= 0.0 ? vec4(pleuraD, pleuraDz, curtainDb, 3.0 + 4.0 * (curtainLast + 1.0)) : vec4(-1.0, 0.0, 0.0, 0.0);
}
