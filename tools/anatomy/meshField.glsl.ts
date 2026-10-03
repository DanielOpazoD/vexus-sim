/** WebGL2 twin of the experimental CPU mesh query. Not imported by the renderer. */
export const MESH_FIELD_QUERY_GLSL = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uVertices;
uniform sampler2D uFaces;
uniform sampler2D uAdjacent;
uniform sampler2D uNodes;
uniform sampler2D uPoints;
uniform int uWidth;
uniform int uPointCount;
uniform int uNodeCount;
layout(location=0) out vec4 fieldResult;
layout(location=1) out vec4 diagnostics;
vec4 fetch(sampler2D t, int i) { return texelFetch(t, ivec2(i % uWidth, i / uWidth), 0); }
float boxDistance(vec3 p, int i) {
  vec3 lo=fetch(uNodes,2*i).xyz, hi=fetch(uNodes,2*i+1).xyz;
  vec3 d=max(max(lo-p,vec3(0.0)),p-hi);
  return dot(d,d);
}
void triangleClosest(vec3 p, vec3 a, vec3 b, vec3 c, out vec3 q, out int feature, out float d2) {
  q=a; feature=0; vec3 delta=p-a; d2=dot(delta,delta);
  for(int e=0;e<3;e++) {
    vec3 u=e==0?a:(e==1?b:c), w=e==0?b:(e==1?c:a), d=w-u;
    float t=clamp(dot(p-u,d)/dot(d,d),0.0,1.0);
    vec3 candidate=u+t*d, diff=p-candidate;
    float r2=dot(diff,diff);
    if(r2<d2) { q=candidate; d2=r2; feature=t==0.0?e:(t==1.0?(e+1)%3:3+e); }
  }
  vec3 ab=b-a, ac=c-a, ap=p-a, n=cross(ab,ac);
  float n2=dot(n,n);
  if(n2>1e-30) {
    float u=dot(cross(ap,ac),n)/n2, w=dot(cross(ab,ap),n)/n2;
    if(u>0.0 && w>0.0 && u+w<1.0) {
      vec3 candidate=a+u*ab+w*ac, diff=p-candidate;
      float r2=dot(diff,diff);
      if(r2<d2) { q=candidate; d2=r2; feature=6; }
    }
  }
}
void main() {
  int sampleIndex=int(gl_FragCoord.y)*uWidth+int(gl_FragCoord.x);
  fieldResult=vec4(0.0); diagnostics=vec4(0.0);
  if(sampleIndex>=uPointCount) return;
  vec3 p=fetch(uPoints,sampleIndex).xyz, bestPoint=vec3(0.0);
  int stack[32]; stack[0]=0;
  int top=1, visited=0, bestFace=-1, bestFeature=-1, error=0;
  float best=3.402823e38;
  for(int step=0;step<uNodeCount;step++) {
    if(top==0) break;
    int id=stack[--top]; visited++;
    if(boxDistance(p,id)>best) continue;
    vec4 lo=fetch(uNodes,2*id), hi=fetch(uNodes,2*id+1);
    int left=int(lo.w+0.5);
    if(hi.w<0.0) {
      int count=int(-hi.w+0.5);
      if(count<1 || count>8) { error=1; break; }
      for(int j=0;j<8;j++) {
        if(j>=count) break;
        int f=left+j; vec3 ids=fetch(uFaces,2*f).xyz;
        vec3 a=fetch(uVertices,2*int(ids.x+0.5)).xyz;
        vec3 b=fetch(uVertices,2*int(ids.y+0.5)).xyz;
        vec3 c=fetch(uVertices,2*int(ids.z+0.5)).xyz;
        vec3 q; int feature; float d2;
        triangleClosest(p,a,b,c,q,feature,d2);
        if(d2<best) { best=d2; bestFace=f; bestFeature=feature; bestPoint=q; }
      }
    } else {
      int right=int(hi.w+0.5);
      if(left<0 || right<0 || left>=uNodeCount || right>=uNodeCount) { error=2; break; }
      if(top+2>32) { error=3; break; }
      if(boxDistance(p,left)<boxDistance(p,right)) { stack[top++]=right; stack[top++]=left; }
      else { stack[top++]=left; stack[top++]=right; }
    }
  }
  if(top>0 && error==0) error=4;
  if(bestFace<0 && error==0) error=5;
  if(error!=0) { diagnostics=vec4(-1.0,float(visited),float(error),0.0); return; }
  vec3 pseudo;
  if(bestFeature<3) {
    int vertex=int(fetch(uFaces,2*bestFace)[bestFeature]+0.5);
    pseudo=fetch(uVertices,2*vertex+1).xyz;
  } else if(bestFeature<6) {
    int other=int(fetch(uAdjacent,bestFace)[bestFeature-3]+0.5);
    pseudo=fetch(uFaces,2*bestFace+1).xyz+fetch(uFaces,2*other+1).xyz;
  } else pseudo=fetch(uFaces,2*bestFace+1).xyz;
  if(length(pseudo)<=1e-20) { diagnostics=vec4(-1.0,float(visited),6.0,0.0); return; }
  vec3 delta=p-bestPoint;
  float orientation=dot(delta,pseudo)<0.0?-1.0:1.0, d=sqrt(best);
  vec3 normal=d>1e-12?orientation*delta/d:normalize(pseudo);
  fieldResult=vec4(orientation*d,normal);
  diagnostics=vec4(fetch(uFaces,2*bestFace).w,float(visited),0.0,0.0);
}
`;
