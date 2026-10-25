/** Lossless transport dictionary. Decoding happens once while shader modules initialize. */
export const GLSL_MARKERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';
const GLSL_BANKS = ['', '~', '!', ':', ';', '?', '%', '=', '+', '^', '&', '<', '>'];

export const GLSL_WORDS: readonly string[] = (
  'float return vec3 uniform vec2 vec4 const normalize length texture clamp smoothstep sampler2D precision highp ' +
  'inversesqrt tissue define texelFetch int gl_FragCoord referenceCartilage min ivec2 continue max include ' +
  'material endif ifdef reflectedLight defined varying roughness direction else texture2D normal void color bool ' +
  'specularColor sqrt mat3 vViewPosition main line step depth floor tangent logdepthbuf_pars_vertex alpha ' +
  'position common scale opacity shadowBias shadow mat4 gl_FragColor true viewMatrix origin shadowCameraNear ' +
  'unroll_loop_start displacementmap_pars_vertex morphtarget_vertex logdepthbuf_vertex attenuationDistance ' +
  'UNROLLED_LOOP_INDEX shadowCameraFar iridescenceIOR batching_pars_vertex skinning_pars_vertex ' +
  'alphamap_pars_fragment unroll_loop_end alphahash_pars_fragment USE_CLEARCOAT_NORMALMAP SHADOWMAP_TYPE_PCF ' +
  'beginnormal_vertex morphnormal_vertex alphatest_fragment alphahash_fragment displacementmap_vertex ' +
  'USE_ANISOTROPY sheenRoughness USE_SHADOWMAP shadowNormalBias uv_pars_fragment ENVMAP_TYPE_CUBE_UV ' +
  'NUM_SPOT_LIGHT_COORDS skinnormal_vertex map_pars_fragment fog_pars_fragment project_vertex shadowMap ' +
  'rectCoords defaultnormal_vertex attenuationColor shadowRadius USE_NORMALMAP_TANGENTSPACE USE_RETROREFLECTION ' +
  'iridescence alphamap_fragment color_pars_fragment vWorldPosition uv_pars_vertex USE_IRIDESCENCE ' +
  'batching_vertex skinbase_vertex skinning_vertex fog_pars_vertex clearcoatRoughness colorspace_fragment ' +
  'USE_CLEARCOAT dithering_pars_fragment normalmap_pars_fragment begin_vertex color_pars_vertex morphcolor_vertex ' +
  'toneMappingExposure opaque_fragment DirectionalLightShadow NUM_POINT_LIGHT_SHADOWS USE_CLEARCOAT_ROUGHNESSMAP ' +
  'refractionCoords coupling morphTargetInfluences vWorldDirection NUM_CLIPPING_PLANES modelMatrix ' +
  'USE_IRIDESCENCE_THICKNESSMAP pragma projectionMatrix bumpmap_pars_fragment normal_fragment_begin ' +
  'UNION_CLIPPING_PLANES vClearcoatNormalMapUv diffuse gl_Position USE_SPECULAR_INTENSITYMAP USE_TANGENT ' +
  'normal_fragment_maps normal_pars_fragment premultiplied_alpha_fragment curvature morphTargetBaseInfluence ' +
  'retroreflectivity sheenColor worldpos_vertex fog_fragment map_fragment directionalLightShadows receiveShadow ' +
  'shadowmap_pars_fragment USE_DISPLACEMENTMAP vDirectionalShadowCoord vSunShadowWorldPosition ' +
  'morphinstance_vertex texelSize USE_TRANSMISSION vHighPrecisionZW color_fragment curtain tonemapping_fragment ' +
  'lightmap_pars_fragment USE_SHEEN_ROUGHNESSMAP dithering_fragment location MORPHTARGETS_COUNT ' +
  'normal_pars_vertex USE_LOGARITHMIC_DEPTH_BUFFER shadowIntensity cube_uv_reflection_fragment ' +
  'envmap_common_pars_fragment shadowmap_pars_vertex textureSize USE_ALPHAMAP USE_BUMPMAP USE_SPECULAR_COLORMAP ' +
  'vSpotLightCoord rectAreaLight USE_ENVMAP vIridescenceThicknessMapUv NUM_RECT_AREA_LIGHTS withCurtain ' +
  'clipping_planes_pars_fragment emissivemap_pars_fragment clipping_planes_pars_vertex anisotropyVector ' +
  'PointLightShadow NUM_DIR_LIGHT_SHADOWS aomap_pars_fragment USE_TRANSMISSIONMAP color_vertex fog_vertex ' +
  'reflectVec result vClearcoatRoughnessMapUv batchingTexture SpotLightShadow struct thickness USE_COLOR_ALPHA ' +
  'USE_IRIDESCENCEMAP USE_NORMALMAP USE_SHEEN_COLORMAP uv_vertex vClipPosition vSpecularIntensityMapUv ' +
  'FLAT_SHADED lights_pars_begin logdepthbuf_pars_fragment pointLightShadows USE_ANISOTROPYMAP vPointShadowCoord ' +
  'lights_fragment_begin transmission USE_SHEEN vSunShadowWorldNormal envmap_physical_pars_fragment ' +
  'NUM_POINT_LIGHTS shadowmap_vertex spotLightShadows USE_CLEARCOATMAP USE_METALNESSMAP USE_ROUGHNESSMAP ' +
  'USE_THICKNESSMAP directionalShadowMap emissivemap_fragment lights_fragment_maps SHADOWMAP_TYPE_BASIC ' +
  'vSheenRoughnessMapUv DEPTH_PACKING normal_vertex skinWeight vBumpMapUv backgroundIntensity clearcoat ' +
  'iridescenceThicknessMaximum iridescenceThicknessMinimum lights_fragment_end NUM_SPOT_LIGHT_MAPS ' +
  'NUM_SPOT_LIGHTS sampler2DShadow USE_EMISSIVEMAP USE_SPECULARMAP vSpecularColorMapUv envMap layout ' +
  'USE_BATCHING_COLOR USE_LIGHTMAP vNormalMapUv vTransmissionMapUv aomap_fragment clippingPlanes cross ' +
  'envMapRotation NUM_DIR_LIGHTS NUM_SUN_LIGHTS specularmap_pars_fragment SunLightShadow ambientLightColor ' +
  'dispersion halfHeight transmissionMapTransform vBitangent vIridescenceMapUv NUM_SUN_LIGHT_SHADOWS ' +
  'clipping_planes_fragment boneTexture gl_VertexID morphTargetsTextureSize morphtarget_pars_vertex uTissueClump4 ' +
  'uvTransform DirectionalLight ENVMAP_TYPE_CUBE refractedRayExit vAnisotropyMapUv vSheenColorMapUv value ' +
  'envMapIntensity fract halfWidth metalness modelViewMatrix NUM_HEMI_LIGHTS oColor refractionRatio ' +
  'rotatedPosition shininess thicknessMapTransform USE_BATCHING USE_SKINNING vClearcoatMapUv visible ' +
  'vMetalnessMapUv vRoughnessMapUv vThicknessMapUv distance emissive probesSH batchingColorTexture ' +
  'envmap_pars_fragment specularmap_fragment USE_INSTANCING_COLOR pointShadowMap torsoDepthGrad vEmissiveMapUv ' +
  'vIsPerspective vSpecularMapUv clipping_planes_vertex NUM_SPOT_LIGHT_SHADOWS respiratory samplerCube USE_MAP ' +
  'vLightMapUv backgroundRotation envmap_pars_vertex false field inout RectAreaLight spotShadowMap under ' +
  'USE_ALPHAHASH USE_COLOR USE_POINTS_UV vColor vDisplacementMapUv vFogDepth vLineDistance ' +
  'iridescenceThicknessMapTransform NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS batchingIdTexture bindMatrixInverse discard ' +
  'lightMapIntensity clearcoatRoughnessMapTransform DOUBLE_SIDED USE_REVERSED_DEPTH_BUFFER reflectivity ' +
  'retroViewDir sunShadowMap logdepthbuf_fragment RENAL_CAPSULE_MM retroIBLRadiance shadowMapSize ' +
  'specularIntensityMapTransform vTangent cartilage clearcoatNormalMapTransform envmap_fragment HemisphereLight ' +
  'radius roughnessFactor single sunLightShadows textureCube USE_AOMAP vAlphaMapUv sheenRoughnessMapTransform ' +
  'cameraPosition instanceMatrix isOrthographic lumen specularColorMapTransform USE_DISPERSION USE_INSTANCING ' +
  'USE_NORMALMAP_OBJECTSPACE wallWavenumber displacementMapTransform ifndef lightProbe PointLight textureLod ' +
  'vFragDepth directionalShadowMatrix envmap_vertex faceSize greaterThan iridescenceMapTransform ' +
  'iridescenceThicknessMap lessThanEqual radiance reflect rotation shape transmissionSamplerSize vNormal vReflect ' +
  'anisotropyMapTransform ENVMAP_MODE_REFLECTION sheenColorMapTransform transmissionSamplerMap alphaTest break ' +
  'bumpScale clearcoatMapTransform clearcoatRoughnessMap faceGradient metalnessMapTransform mirror nearDistance ' +
  'normalMatrix offset gradient roughnessMapTransform skinIndex SpotLight alphatest_pars_fragment uLookSalt ' +
  'USE_LIGHT_PROBES_GRID vessel backgroundBlurriness clearcoatNormalScale DECODE_VIDEO_TEXTURE ' +
  'emissiveMapTransform near specularIntensityMap specularMapTransform USE_INSTANCING_MORPH kidneyOuter ' +
  'morphTargetsTexture resMinusOne registered sampler shadow_pass transmitted USE_SIZEATTENUATION uvec3 ' +
  'classifyWith alphaMap clearcoatNormalMap cubeUV_minTileSize elif frozen normalMapTransform retroVec strong ' +
  'SunLight vAoMapUv ALPHA_TO_COVERAGE alphaMapTransform bindMatrix directionalLights displacementScale ' +
  'FLIP_SIDED fogDensity lightMapTransform peritoneum pointShadowMatrix referencePosition resolution ' +
  'retroSpecularBRDF samplerCubeShadow sheenRoughnessMap specularIntensity uLookSteer bumpMapTransform ' +
  'displacementBias hemisphereLights probesResolution refractionVector size specularColorMap sunShadowCascade ' +
  'texture2DGradEXT USE_LIGHT_PROBES USE_MORPHTARGETS bumpMap cart center displacementMap fascia gl_DrawID ' +
  'normalMap ivec3 probesMin retroperitoneum skin spotLightMatrix sunShadowMatrix transmissionMap USE_FOG ' +
  'USE_GRADIENTMAP vPosition wallMm aoMapIntensity aoMapTransform CUBEUV_MAX_MIP iridescenceMap rectAreaLights ' +
  'roughnessToMip seriesPow base Warp fLodSize gl_InstanceID gl_PointCoord lightMap logDepthBufFC sheenColorMap ' +
  'start USE_ALPHATEST uTissueAlpha4 atan label FINGER lessThan'
).split(' ');
/** Frequent static sequences; transport only, expanded byte-for-byte before compilation. */
// The table transports word codes only; no phrase dictionary is consulted during its initialization.
export const GLSL_PHRASES: readonly string[] = (
  '@G in @C`' +
  '@G in @A`' +
  '@m @t(){`' +
  '@C(0.0)`' +
  'for(@T i=0;`' +
  '0.0,1.0`' +
  '#if @f(`' +
  ') || @f(`' +
  '#@a <@2>`' +
  '(@C m){`' +
  ';for(@T`' +
  ',1)).xy;`' +
  ';@:6(@!p=`' +
  ',@X(@u,`' +
  '@E(0.0);`' +
  ',out @A`' +
  '}@j if(`' +
  '){c.@Q=`' +
  ';c.ifd=`' +
  '>=0.0&&`' +
  ')out @F`' +
  '(@C p,@T k`' +
  '(@C m,@A`' +
  ',out @C`' +
  '_fragment>\n`' +
  '@D @A @4;`' +
  '*(3.0-2.0*`' +
  '@C(0,0,1)`' +
  '#@a <@~2>`' +
  '0.0);@A`' +
  '#@a <@~f>`' +
  '+0.5)*@v`' +
  '#@!F @~M`' +
  ',0),0).`' +
  '@F h=@F(@!L,`' +
  '#@!F @~B`' +
  '++){if(`' +
  '0.0,0.0`' +
  ',1.0);}`' +
  ')/(2.0*`' +
  '@C(0.0,`' +
  ');@B `' +
  '){@B `' +
  ')@B 0.0;`' +
  '){@A `' +
  '\n#@R `' +
  ',@X(0),@=S-1),0).`' +
  '@T @u=@T(@U.`' +
  ',@A `' +
  '=@W(@W(`' +
  '(m);if(`' +
  '6.2831853*`' +
  '*2.0*0.511664*`' +
  '*2.0*0.429043*`' +
  '@C(0,1,`' +
  '=0.0;@A`' +
  ';out @F @;h;`' +
  '#@%1 @f(`' +
  '#@a <@:Q>`' +
  '@g @C @s;`' +
  ',@3,mean,`' +
  ';@B @F(`' +
  '#@a <@~D>`' +
  '#@a <@~E>`' +
  '>\n#@a <`' +
  '\n#@c\n#@d `' +
  ';\n#@c\n#`' +
  ';@D @A `' +
  ');if(`' +
  ');\n#@c\n`' +
  '\n@D @M `' +
  ';\n#@j\n`' +
  '{@A @!t;@A @5;@A @~Y;@A @~k;@E`' +
  '\n#@c\n#if `' +
  ';\n#@a <`' +
  '\n@D @A `' +
  '\n@D @r `' +
  ';@D @M `' +
  '));}@A `' +
  ';}\n#@c\n`' +
  '\n@g @E `' +
  ';@g @E `' +
  '0.0)@B `' +
  ';c.bd=@W(`' +
  ');@E `' +
  '=C(dot(`' +
  '.x);@A `' +
  ';in @E vUv`' +
  ';\n#@c\n`' +
  '));@A `' +
  ';\n#@d `' +
  ');}@A `' +
  '\n#@a <`' +
  '*(1.0-`' +
  '@G in `' +
  '@D @C `' +
  ');}@C `' +
  ',0.0);`' +
  ');\n@A `' +
  '));@C `' +
  '));@B `' +
  '@G @A `' +
  '@g @C `' +
  '>0.0&&`' +
  '.x;@A `' +
  ');}@E `' +
  '6.2831853`' +
  '@B @E(`' +
  '>=0.0?`' +
  ';}@j{`' +
  '@C dir`' +
  '.y;@A `' +
  '<0.0){`' +
  'c.@Q==`' +
  '(@C m,`' +
  '@B @C(`' +
  '));if(`' +
  ';@C `' +
  '1.0;@A `' +
  '=@?B;@o `' +
  ';@D @E `' +
  '@D @F `' +
  '\n#@d `' +
  ',s);@E`' +
  '+@C(1,`' +
  'z);@A `' +
  ';@A `' +
  ' @~X ) && `' +
  ',R,E,J,U,@b,`' +
  ' ) && @f( `' +
  '(@A a){@B(1.0/6.0)*(`' +
  ');\n@G @F `' +
  '=0.5*(lo+`' +
  ',@E(vUv.x,`' +
  '),0);@F `' +
  '))+@J(@~g,`' +
  ' @b,@?D `' +
  '=@J(@;v,@C(`' +
  '@X(@U.xy)`' +
  '.rgb*0.9478672986+@C(0.0521327014),@C(2.4)`' +
  '[i];H.@n*=(H.@;p&`' +
  ' > 0\n@:K `' +
  ');\n@G @C `' +
  '(u,z,iP)`' +
  ',spine)-`' +
  ' - 0.5) * g + 0.5)`' +
  ')),dir)-1.0)*s.w;}`' +
  ' x=j%@=S;@T y=j/@=S`' +
  ', 0.0, 1.0`' +
  '@A(c.@Q)`' +
  '(b+@%w(0u,0u,`' +
  '++) {\n@A `' +
  'spineBodySd(`' +
  '[t/4][t%4];}`' +
  ')-0.5)*@!g.xy;`' +
  '@C(q.x,q.y`' +
  '@T @u,@T `' +
  '=@H(@;B(`' +
  ' i){@T @=S=@!x(`' +
  'if(any(@=$(q,`' +
  '))||any(@?_(q,`' +
  '(p.x,p.y`' +
  '=1.0;if(`' +
  '>0.0?@F(c.n/`' +
  '*sin(phi)`' +
  '*cos(phi)`' +
  '(b.w-a.w)`' +
  ',@=y w){`' +
  '(-0.5*x*x`' +
  '[i]!=0.0)`' +
  ',0).x;@T j=@T(i)`' +
  '*(0.743125*z*z-0.247708);@:G+=`' +
  ' @b;@b.h=h.rgb;`' +
  '*@E(cos(`' +
  '((-5.55473*al-6.98316)*al`' +
  'h*h*k*0.25`' +
  ',-@w-wall`' +
  '(1.0-s.x))`' +
  'frequency[`' +
  ' j=0;j<9;j`' +
  'rawClass()`' +
  ')*@?k,o.z`' +
  '=0.0;if(`' +
  'ph0,@C g,@C s){`' +
  ' > 0 || `' +
  'o.x<=1.0&&o.y`' +
  '(1.0,@6,@!t)`' +
  '(@C p){if(`' +
  ',@y,@!S)`' +
  '(e/4.0+3.0*e*e*e/128.0`' +
  '(-1.0, 0.0, 0.0, 0.0);`' +
  '=dot(@b.`' +
  ' ) || @f ( `' +
  '(1.0+dot(`' +
  '(@C q,@T k`' +
  '(3.14159265*`' +
  ';out @F `' +
  ' s=0;s<512;s`' +
  '@C(o.xy+`' +
  '-1.0)*@W(`' +
  'rib.x+rib.y*(0.5-0.5`' +
  '(@Z(1e-6,a))`' +
  '(G,ser.x);@o series=@?G&`' +
  '@E h=@E(`' +
  'rib.z*rib.z`' +
  '(k).z>0.5){`' +
  '17.1,0.0));@o @%5=b>=1.0`' +
  ',@?D @C `' +
  '(lo,lo+1.0,`' +
  '*0.70710678`' +
  '@v / 10.0`' +
  ',0.0,0.9999`' +
  '.rgb*0.0773993808,@C(`' +
  'o.y<=1.0;@o `' +
  '+1e-3)n=`' +
  ';\n@G @E `' +
  '@F h=@S(`' +
  'blood[i]`' +
  '1.0,0.0)`' +
  '*2.0-1.0`' +
  '(c.@Q,@v);`' +
  'r=vUv.y*`' +
  'vUv*@E(ts)),@E(ts)-1.0`' +
  'd=j==1?ser.y:ser.z`' +
  'f*(j==1?(ser.x+1.0`' +
  '*0.9,0.0`' +
  '(m,h,se,`' +
  ',0.0)+o)`' +
  '.rgb,@C(0.04045)))),`' +
  '*0.429043*(x*x-y*y`' +
  ';\n#if ( `' +
  '[i]):1.0`' +
  '(@C @n){`' +
  ' @:q == `' +
  '-1));@T `' +
  '(@=8(xy.y,xy.x),p.`' +
  '(0.0,25.0,`' +
  '(@Z(0.0,`' +
  '(xy.x,xy.y`' +
  'rib.w*rib.`' +
  '=0.0;@T `' +
  'c.bd,@W(`' +
  '\nfor(@T `' +
  'd,0,last),k),0).x`' +
  '=dot(0.5*(s[j]+s[`' +
  'oGradient=`' +
  '>=1.0)@B `' +
  '\n#if @!C > 0\n`' +
  '0.25/255.0`' +
  '(@b.h);}`' +
  ' v){if(v<=`' +
  ' @~g,@E @?d`' +
  '.y)*@!g,`' +
  '@F(0.0);`' +
  '=@F(1.0,`' +
  '!=0){@E `' +
  ');\nd=@Z(d,`' +
  '#version 300 es\n`' +
  'lo=@Z(r-@v,`' +
  '(@C(1.0)`' +
  '@b.@p,@b.`' +
  ' @?d;};@D `' +
  '[i];@6*=@!a?`' +
  '(@%E)*cm.`' +
  '(v.y-v.x)`' +
  ',0.0,@A(`' +
  '=1.0-@L(`' +
  'p.x>0.0?-`' +
  ';}@B @9;}`' +
  '*0.1031);`' +
  '+0.5*cos(`' +
  '/(r.y*r.y`' +
  '+d;if(l<0||l>=@T`' +
  '.z):h.y):h.z;if`' +
  'r=(@A(s)`' +
  '<1.5){if(`' +
  'original.`' +
  '=@9;if(g.z>0.5&&!`' +
  '\nin @E vUv`' +
  '(@C(vUv.x*190.0,r`' +
  '*z;@:G+='
)
  .split('`')
  .map((phrase) => expandGlsl(phrase, GLSL_WORDS));
const GLSL_DICTIONARY = [...GLSL_WORDS, ...GLSL_PHRASES];
/** Stable short codes for the first bank; a prefix selects subsequent banks without changing existing codes. */
export function glslMarker(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= GLSL_BANKS.length * GLSL_MARKERS.length)
    throw new RangeError('Invalid GLSL marker index');
  return '@' + GLSL_BANKS[Math.floor(index / GLSL_MARKERS.length)] + GLSL_MARKERS[index % GLSL_MARKERS.length];
}
/** One pass over either the word dictionary at initialization or the complete runtime dictionary. */
function expandGlsl(s: string, dictionary: readonly string[]): string {
  return s.replace(/@([~!:;?%=+^&<>]?)([A-Za-z0-9_$])/g, (original, bank: string, c: string) => {
    const index = GLSL_MARKERS.indexOf(c) + GLSL_BANKS.indexOf(bank) * GLSL_MARKERS.length;
    return dictionary[index] ?? original;
  });
}
export function unpackGlsl(s: string): string {
  let out = '';
  let end = 0;
  for (const m of s.matchAll(/`([0-9a-z]+),([0-9a-z]+);/g)) {
    out += s.slice(end, m.index);
    const distance = parseInt(m[1], 36);
    const length = parseInt(m[2], 36);
    if (!(distance > 0 && distance <= out.length && length >= 8 && length <= distance)) throw new Error('Invalid GLSL back reference');
    out += out.slice(out.length - distance, out.length - distance + length);
    end = m.index + m[0].length;
  }
  return expandGlsl(out + s.slice(end), GLSL_DICTIONARY);
}
