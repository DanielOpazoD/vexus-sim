/**
 * Renombrado de identificadores GLSL en el build (lo usa `glslMinify.ts`, que documenta el contrato completo).
 *
 * Trabaja sobre las plantillas `/* glsl *\/` ya sin comentarios, cada una como sus trozos estáticos (`parts`) con las
 * interpolaciones que quedan entre ellos. Un solo mapa para todo el bundle: los programas se montan en tiempo de
 * ejecución concatenando plantillas de muchos módulos, así que un nombre se renombra igual en todas partes (y las
 * sobrecargas siguen siéndolo: todas las funciones con ese nombre pasan al mismo nombre corto). El mapa es inyectivo y
 * ningún nombre corto coincide con un identificador existente, así que el programa renombrado es el mismo salvo por
 * los nombres.
 *
 * Solo se renombran nombres DECLARADOS en el texto estático de las plantillas (funciones, parámetros, variables,
 * `const`, `#define` y sus parámetros, structs y sus campos). Nunca: uniforms, entradas y salidas (`in`/`out`, bloques
 * de interfaz, y cualquier nombre de una sentencia global `uniform`/`in`/`out`), los campos de un struct que sea el tipo
 * de un uniform, `main`, palabras clave, tipos, funciones y variables integradas, nombres con forma reservada (`gl_`,
 * `__`, `u[A-Z]`…), lo que el llamante reserve (lo que aparece en cadenas JS) ni un nombre que pueda formarse pegado a
 * una interpolación o a un extremo de la plantilla (`uLook${i}` reserva todo lo que empiece por `uLook`). Tras un punto
 * hay un selector: se renombra solo si es un campo de un struct declarado o una macro (el preprocesador la expande
 * también ahí); un campo o una macro con forma de swizzle (`s`, `xy`) no se renombra.
 */

/**
 * Palabras clave, reservadas, tipos, funciones y variables integradas (GLSL ES 3.00, más 1.00 y 3.1/3.2 por si acaso), y
 * los campos de `gl_DepthRange` (`near`, `far`, `diff`: tras un punto, un campo con ese nombre no se puede renombrar).
 */
const GLSL_WORDS = `
attribute const uniform varying buffer shared coherent volatile restrict readonly writeonly atomic_uint layout centroid
flat smooth noperspective patch sample precise break continue do for while switch case default if else subroutine in
out inout float double int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2
mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 dmat2 dmat3 dmat4 dmat2x2 dmat2x3 dmat2x4 dmat3x2 dmat3x3 dmat3x4 dmat4x2 dmat4x3
dmat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 dvec2 dvec3 dvec4 uint uvec2 uvec3 uvec4 lowp mediump highp
precision sampler1D sampler2D sampler3D samplerCube sampler1DShadow sampler2DShadow samplerCubeShadow sampler1DArray
sampler2DArray sampler1DArrayShadow sampler2DArrayShadow isampler1D isampler2D isampler3D isamplerCube isampler1DArray
isampler2DArray usampler1D usampler2D usampler3D usamplerCube usampler1DArray usampler2DArray sampler2DRect
sampler2DRectShadow isampler2DRect usampler2DRect samplerBuffer isamplerBuffer usamplerBuffer sampler2DMS isampler2DMS
usampler2DMS sampler2DMSArray isampler2DMSArray usampler2DMSArray samplerCubeArray samplerCubeArrayShadow
isamplerCubeArray usamplerCubeArray samplerExternalOES sampler3DRect image1D iimage1D uimage1D image2D iimage2D uimage2D
image3D iimage3D uimage3D image2DRect iimage2DRect uimage2DRect imageCube iimageCube uimageCube imageBuffer iimageBuffer
uimageBuffer image1DArray iimage1DArray uimage1DArray image2DArray iimage2DArray uimage2DArray imageCubeArray
iimageCubeArray uimageCubeArray image2DMS iimage2DMS uimage2DMS image2DMSArray iimage2DMSArray uimage2DMSArray struct
common partition active asm class union enum typedef template this resource goto inline noinline public static extern
external interface long short half fixed unsigned superp input output hvec2 hvec3 hvec4 fvec2 fvec3 fvec4 filter
sizeof cast namespace using main defined location binding offset index component packed std140 std430 row_major
column_major early_fragment_tests origin_upper_left pixel_center_integer depth_any depth_greater depth_less
depth_unchanged local_size_x local_size_y local_size_z
radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt inversesqrt abs
sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf floatBitsToInt
floatBitsToUint intBitsToFloat uintBitsToFloat fma frexp ldexp packUnorm2x16 packSnorm2x16 packUnorm4x8 packSnorm4x8
unpackUnorm2x16 unpackSnorm2x16 unpackUnorm4x8 unpackSnorm4x8 packHalf2x16 unpackHalf2x16 packDouble2x32
unpackDouble2x32 length distance dot cross normalize faceforward reflect refract ftransform matrixCompMult outerProduct
transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not uaddCarry
usubBorrow umulExtended imulExtended bitfieldExtract bitfieldInsert bitfieldReverse bitCount findLSB findMSB textureSize
textureQueryLod textureQueryLevels textureSamples texture textureProj textureLod textureOffset texelFetch
texelFetchOffset textureProjOffset textureLodOffset textureProjLod textureProjLodOffset textureGrad textureGradOffset
textureProjGrad textureProjGradOffset textureGather textureGatherOffset textureGatherOffsets texture1D texture1DProj
texture1DLod texture1DProjLod texture2D texture2DProj texture2DLod texture2DProjLod texture2DLodEXT
texture2DProjLodEXT texture2DGradEXT texture2DProjGradEXT texture3D texture3DProj texture3DLod texture3DProjLod
textureCube textureCubeLod textureCubeLodEXT textureCubeGradEXT shadow1D shadow2D shadow1DProj shadow2DProj shadow1DLod
shadow2DLod shadow1DProjLod shadow2DProjLod texture2DRect texture2DRectProj textureVideoWEBGL atomicCounterIncrement
atomicCounterDecrement atomicCounter atomicAdd atomicMin atomicMax atomicAnd atomicOr atomicXor atomicExchange
atomicCompSwap imageSize imageSamples imageLoad imageStore imageAtomicAdd imageAtomicMin imageAtomicMax imageAtomicAnd
imageAtomicOr imageAtomicXor imageAtomicExchange imageAtomicCompSwap dFdx dFdy dFdxFine dFdyFine dFdxCoarse dFdyCoarse
fwidth fwidthFine fwidthCoarse interpolateAtCentroid interpolateAtSample interpolateAtOffset noise1 noise2 noise3
noise4 EmitStreamVertex EndStreamPrimitive EmitVertex EndPrimitive barrier memoryBarrier memoryBarrierAtomicCounter
memoryBarrierBuffer memoryBarrierShared memoryBarrierImage groupMemoryBarrier near far diff
`;
export const GLSL_BUILTINS: ReadonlySet<string> = new Set(GLSL_WORDS.split(/\s+/).filter(Boolean));

/**
 * Nombres reservados por su forma: los de la implementación (`gl_`, `GL_`, `__`), los de WebGL (`webgl_`, `_webgl_`)
 * y, como red de seguridad, la convención de los uniforms del proyecto (`uNombre`).
 */
export const GLSL_RESERVED_PATTERN = /^(?:gl_|GL_|webgl_|_webgl_)|__|^u[A-Z]/;

/** Un selector que puede ser un swizzle. */
export const GLSL_SWIZZLE = /^(?:[xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})$/;

/** Calificadores que pueden preceder al tipo en una declaración. */
const QUALIFIERS = new Set(
  `const uniform in out inout attribute varying buffer shared centroid flat smooth noperspective invariant precise
  highp mediump lowp coherent volatile restrict readonly writeonly patch sample`.split(/\s+/),
);
/** Calificadores de la interfaz del shader: el nombre lo ven el enlazador o la API. */
const INTERFACE_QUALIFIERS = new Set(['uniform', 'in', 'out', 'inout', 'attribute', 'varying', 'buffer', 'shared']);
const BUILTIN_TYPE =
  /^(?:void|bool|int|uint|float|double|[bdiu]?vec[234]|d?mat[234](?:x[234])?|[iu]?sampler\w+|[iu]?image\w+|atomic_uint)$/;
/** Directivas cuya línea no se toca. */
const OPAQUE_DIRECTIVES = new Set(['version', 'extension', 'pragma', 'line', 'error']);

export interface GlslToken {
  kind: 'id' | 'num' | 'punct' | 'expr';
  text: string;
  /** Trozo estático y posición en él (una `expr` es la interpolación que precede al trozo `part`). */
  part: number;
  start: number;
  end: number;
  /** Tras un `.`: selector de campo o swizzle. */
  dot: boolean;
  /** Directiva de la línea (`define`, `if`…) o null fuera de una directiva. */
  directive: string | null;
  /** Es la palabra de la directiva (`define` en `#define`). */
  directiveWord: boolean;
  /** Dentro de `layout(…)`. */
  layout: boolean;
  /** Pegado por delante / por detrás a una interpolación, a un escape o a un extremo de la plantilla: al ejecutar puede ser otro nombre. */
  glueBefore: boolean;
  glueAfter: boolean;
}

const isIdStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isIdChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/**
 * Tokens de una plantilla, sin espacios. Una secuencia de escape del literal JS (`\n`, `\``…) es opaca y pega a sus
 * vecinos; un número se lee entero, con sufijo y exponente (el `e5` de `1e5` no es un identificador).
 */
export function tokenizeGlsl(parts: readonly string[]): GlslToken[] {
  const out: GlslToken[] = [];
  let lineStart = true;
  let directive: string | null = null;
  let expectDirective = false;
  const push = (kind: GlslToken['kind'], text: string, part: number, start: number, end: number): GlslToken => {
    const t: GlslToken = {
      kind,
      text,
      part,
      start,
      end,
      dot: false,
      directive,
      directiveWord: false,
      layout: false,
      glueBefore: false,
      glueAfter: false,
    };
    out.push(t);
    return t;
  };
  for (let p = 0; p < parts.length; p++) {
    const s = parts[p];
    if (p > 0) {
      push('expr', '', p, 0, 0);
      lineStart = false;
      expectDirective = false;
    }
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') {
        lineStart = true;
        directive = null;
        expectDirective = false;
        i++;
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
        i++;
      } else if (c === '\\') {
        // escape del literal JS: opaco (`\` + salto de línea es una continuación: la línea sigue)
        push('punct', s.slice(i, i + 2), p, i, i + 2);
        lineStart = false;
        i += 2;
      } else if (isIdStart(c)) {
        let j = i + 1;
        while (isIdChar(s[j])) j++;
        const prev = out[out.length - 1];
        const t = push('id', s.slice(i, j), p, i, j);
        if (expectDirective) {
          t.directiveWord = true;
          t.directive = directive = t.text;
          expectDirective = false;
        }
        // pegado a una interpolación, a un escape o a un extremo de la plantilla (que se interpola junto a otro texto)
        t.glueBefore = i === 0 || (!!prev && prev.part === p && prev.end === i && prev.text[0] === '\\');
        t.glueAfter = j === s.length || s[j] === '\\';
        lineStart = false;
        i = j;
      } else if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
        // número de preprocesador: dígitos, letras, `_`, `.` y el signo de un exponente decimal
        const hex = c === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X');
        let j = i + 1;
        while (j < s.length && (isIdChar(s[j]) || s[j] === '.' || (!hex && (s[j] === '+' || s[j] === '-') && /[eE]/.test(s[j - 1])))) j++;
        // `${a}1` puede acabar un nombre formado al ejecutar
        push('num', s.slice(i, j), p, i, j).glueBefore = i === 0;
        lineStart = false;
        i = j;
      } else {
        // `#` abre una directiva a principio de línea y también tras una interpolación (su texto puede acabar en salto)
        if (c === '#' && (lineStart || out[out.length - 1]?.kind === 'expr')) expectDirective = true;
        push('punct', c, p, i, i + 1);
        lineStart = false;
        i++;
      }
    }
  }
  // selectores tras un punto y contenido de layout(…)
  let layoutDepth = 0;
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    const prev = out[k - 1];
    if (t.kind === 'id' && prev?.text === '.') t.dot = true;
    if (layoutDepth > 0) {
      if (t.text === '(') layoutDepth++;
      else if (t.text === ')') layoutDepth--;
      else if (t.kind === 'id') t.layout = true;
    } else if (t.text === '(' && prev?.kind === 'id' && prev.text === 'layout' && !prev.dot) layoutDepth = 1;
  }
  return out;
}

export type DeclKind = 'function' | 'variable' | 'param' | 'field' | 'struct' | 'macro' | 'macroParam' | 'uniform' | 'interface';

export interface GlslDecl {
  name: string;
  kind: DeclKind;
  /** Tipo declarado (variables, campos, uniforms…). */
  type?: string;
  /** Struct al que pertenece un campo. */
  owner?: string;
}

const isInterface = (q: ReadonlySet<string>): DeclKind | null =>
  q.has('uniform') ? 'uniform' : [...q].some((x) => INTERFACE_QUALIFIERS.has(x)) ? 'interface' : null;

/** Nombres de struct declarados (`struct Nombre`). */
export function glslStructNames(tokens: readonly GlslToken[]): string[] {
  const out: string[] = [];
  const code = tokens.filter((t) => t.directive === null);
  for (let k = 0; k + 1 < code.length; k++) {
    if (code[k].kind === 'id' && code[k].text === 'struct' && !code[k].dot && code[k + 1].kind === 'id') out.push(code[k + 1].text);
  }
  return out;
}

/**
 * Declaraciones: `tipo nombre` (también `tipo[n] nombre`), las listas `tipo a = …, b`, los campos de los structs, los
 * parámetros, las funciones, los bloques de interfaz y los `#define` (con sus parámetros). Lo que no se reconoce no se
 * declara, y lo no declarado no se renombra: un fallo aquí solo cuesta bytes.
 */
export function glslDeclarations(tokens: readonly GlslToken[], structs: ReadonlySet<string>): GlslDecl[] {
  const decls: GlslDecl[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (!t.directiveWord || t.text !== 'define') continue;
    const name = tokens[k + 1];
    if (!name || name.kind !== 'id' || name.directive !== 'define') continue;
    decls.push({ name: name.text, kind: 'macro' });
    // macro con parámetros: el paréntesis va pegado al nombre
    const open = tokens[k + 2];
    if (open && open.text === '(' && open.part === name.part && open.start === name.end) {
      for (let j = k + 3; j < tokens.length && tokens[j].directive === 'define' && tokens[j].text !== ')'; j++) {
        if (tokens[j].kind === 'id') decls.push({ name: tokens[j].text, kind: 'macroParam' });
      }
    }
  }
  const code = tokens.filter((t) => t.directive === null);
  const isType = (t: GlslToken): boolean => t.kind === 'id' && !t.dot && (BUILTIN_TYPE.test(t.text) || structs.has(t.text));
  const qualifiersBefore = (k: number): Set<string> => {
    const q = new Set<string>();
    let j = k - 1;
    while (j >= 0) {
      const t = code[j];
      if (t.kind === 'id' && QUALIFIERS.has(t.text)) {
        q.add(t.text);
        j--;
        continue;
      }
      if (t.text !== ')') break;
      // layout(…)
      let d = 1;
      let i = j - 1;
      for (; i >= 0 && d > 0; i--) {
        if (code[i].text === ')') d++;
        else if (code[i].text === '(') d--;
      }
      if (i < 0 || code[i].text !== 'layout') break;
      q.add('layout');
      j = i - 1;
    }
    return q;
  };
  interface Brace {
    kind: 'struct' | 'block' | 'code';
    name?: string;
    /** Clase del nombre de instancia que puede seguir a la llave de cierre. */
    instance?: DeclKind;
  }
  const braces: Brace[] = [];
  let pending: Brace | null = null;
  let paren = 0;
  let brackets = 0;
  /** Lista de declaración abierta: una coma a su profundidad declara otro nombre. */
  let list: { kind: DeclKind; type?: string; owner?: string; paren: number; brackets: number; braces: number } | null = null;
  const atList = (): boolean => !!list && paren === list.paren && brackets === list.brackets && braces.length === list.braces;
  /** Tras cerrar un struct o un bloque: la clase y el tipo del nombre de instancia que puede seguir. */
  let instance: { kind: DeclKind; type?: string } | null = null;
  for (let k = 0; k < code.length; k++) {
    const t = code[k];
    const afterClose = instance;
    instance = null;
    if (t.kind === 'punct') {
      if (t.text === '(') paren++;
      else if (t.text === ')') {
        if (paren > 0) paren--;
        if (list && paren < list.paren) list = null;
      } else if (t.text === '[') brackets++;
      else if (t.text === ']') {
        if (brackets > 0) brackets--;
      } else if (t.text === '{') {
        braces.push(pending ?? { kind: 'code' });
        pending = null;
        list = null;
      } else if (t.text === '}') {
        const closed = braces.pop();
        instance = closed?.instance ? { kind: closed.instance, type: closed.name } : null;
        list = null;
      } else if (t.text === ';') {
        if (atList()) list = null;
      } else if (t.text === ',' && atList() && list) {
        const next = code[k + 1];
        if (next && next.kind === 'id' && !next.dot) decls.push({ name: next.text, kind: list.kind, type: list.type, owner: list.owner });
      }
      continue;
    }
    if (t.kind !== 'id' || t.dot) continue;
    if (afterClose) {
      // `struct S { … } s, t;` o `uniform B { … } b;`
      decls.push({ name: t.text, kind: afterClose.kind, type: afterClose.type });
      list = { kind: afterClose.kind, type: afterClose.type, paren, brackets, braces: braces.length };
      continue;
    }
    const top = braces[braces.length - 1];
    if (t.text === 'struct') {
      const name = code[k + 1];
      const hasName = name?.kind === 'id';
      if (hasName) decls.push({ name: name.text, kind: 'struct' });
      pending = { kind: 'struct', name: hasName ? name.text : undefined, instance: isInterface(qualifiersBefore(k)) ?? 'variable' };
      if (hasName) k++;
      continue;
    }
    if (braces.length === 0 && paren === 0 && code[k + 1]?.text === '{' && !isType(t) && !QUALIFIERS.has(t.text)) {
      // bloque de interfaz: `uniform Nombre { … }`
      if (isInterface(qualifiersBefore(k))) {
        decls.push({ name: t.text, kind: 'interface' });
        pending = { kind: 'block', instance: 'interface' };
      }
      continue;
    }
    if (top?.kind === 'struct' && brackets === 0 && !isType(t) && !QUALIFIERS.has(t.text) && !GLSL_BUILTINS.has(t.text)) {
      // en un struct, un nombre que no es tipo es un campo aunque su tipo no se vea (`${T} campo;`, un tipo por macro)
      decls.push({ name: t.text, kind: 'field', owner: top.name });
      continue;
    }
    if (!isType(t)) continue;
    let j = k + 1;
    if (code[j]?.text === '[') {
      // `tipo[n] nombre`
      for (let d = 0; j < code.length; j++) {
        if (code[j].text === '[') d++;
        else if (code[j].text === ']' && --d === 0) break;
      }
      j++;
    }
    const name = code[j];
    if (!name || name.kind !== 'id' || name.dot) continue;
    let kind: DeclKind;
    let owner: string | undefined;
    if (top?.kind === 'struct') {
      kind = 'field';
      owner = top.name;
    } else if (top?.kind === 'block') kind = 'interface';
    else if (top) kind = 'variable';
    else if (paren > 0) kind = 'param';
    else if (code[j + 1]?.text === '(') kind = 'function';
    else kind = isInterface(qualifiersBefore(k)) ?? 'variable';
    decls.push({ name: name.text, kind, type: t.text, owner });
    if (kind !== 'param' && kind !== 'function') list = { kind, type: t.text, owner, paren, brackets, braces: braces.length };
    k = j;
  }
  return decls;
}

/**
 * Nombres de las sentencias globales de la interfaz (`uniform …;`, `in …;`, `layout(…) out …;`, `uniform B {`): todos sus
 * identificadores fuera de paréntesis y corchetes, aunque el tipo no se reconozca (`uniform ${T} gain;`, un tipo o una
 * precisión por macro). Un uniform no se renombra nunca por no haberse entendido su declaración.
 */
export function glslInterfaceStatementNames(tokens: readonly GlslToken[]): string[] {
  const out: string[] = [];
  let depth = 0;
  let paren = 0;
  let brackets = 0;
  let stmt: string[] = [];
  let iface = false;
  const flush = (): void => {
    if (iface) out.push(...stmt);
    stmt = [];
    iface = false;
  };
  for (const t of tokens) {
    if (t.directive !== null) continue;
    if (t.text === '{') {
      if (depth === 0) flush();
      depth++;
    } else if (t.text === '}') {
      if (depth > 0) depth--;
      stmt = [];
      iface = false;
    } else if (depth > 0) continue;
    else if (t.text === ';') flush();
    else if (t.text === '(') paren++;
    else if (t.text === ')') paren = Math.max(0, paren - 1);
    else if (t.text === '[') brackets++;
    else if (t.text === ']') brackets = Math.max(0, brackets - 1);
    else if (t.kind === 'id' && !t.dot && paren === 0 && brackets === 0) {
      if (INTERFACE_QUALIFIERS.has(t.text)) iface = true;
      stmt.push(t.text);
    }
  }
  flush();
  return out;
}

export interface MangleOptions {
  /** Nombres que nunca se renombran (los que aparecen en cadenas JS, por ejemplo). */
  reserved?: ReadonlySet<string>;
  /** Fragmentos que pueden empezar un nombre formado en tiempo de ejecución: se reservan los nombres que empiezan así. */
  reservedPrefixes?: ReadonlySet<string>;
  /** Ídem para el final de un nombre. */
  reservedSuffixes?: ReadonlySet<string>;
  /** Identificadores que existen fuera de las plantillas (JS, cadenas): los nombres cortos los evitan. */
  taken?: ReadonlySet<string>;
}

export interface MangleMap {
  /** nombre → nombre corto */
  names: ReadonlyMap<string, string>;
  /**
   * Lo que se renombra también tras un punto: los campos de struct y las macros con sus parámetros (el preprocesador
   * las expande en cualquier sitio). Tras un punto, lo demás es un swizzle o un campo de algo que no se renombra.
   */
  afterDot: ReadonlySet<string>;
}

/** Análisis de todas las plantillas del bundle. */
export interface GlslAnalysis {
  /** Nombre → clases con que se declara. */
  declared: Map<string, Set<DeclKind>>;
  /** Nombres declarados que no se pueden renombrar, con el motivo. */
  reserved: Map<string, string>;
  /** Apariciones renombrables de cada nombre renombrable (su peso en el reparto de nombres cortos). */
  uses: Map<string, number>;
  /** Todos los identificadores del texto estático. */
  seen: Set<string>;
  /** Lo que se renombra también tras un punto (campos y macros renombrables). */
  afterDot: Set<string>;
  /** Fragmentos pegados a una interpolación o a un escape (inicio o final de un nombre formado al ejecutar). */
  prefixes: Set<string>;
  suffixes: Set<string>;
}

/** Un identificador de la plantilla que el renombrado puede tocar (fuera de directivas opacas, layout y la palabra de la directiva). */
const renamable = (t: GlslToken): boolean =>
  t.kind === 'id' && !t.directiveWord && !t.layout && !(t.directive !== null && OPAQUE_DIRECTIVES.has(t.directive));

export function analyzeGlsl(templates: ReadonlyArray<readonly string[]>, options: MangleOptions = {}): GlslAnalysis {
  const tokenized = templates.map((parts) => tokenizeGlsl(parts));
  const structs = new Set<string>();
  for (const toks of tokenized) for (const s of glslStructNames(toks)) structs.add(s);
  const declared = new Map<string, Set<DeclKind>>();
  const typesOf = new Map<string, Set<string>>();
  /** struct → campo → tipos del campo (vacío si no se ve) */
  const fieldsOf = new Map<string, Map<string, Set<string>>>();
  const interfaceNames = new Set<string>();
  const seen = new Set<string>();
  const reserved = new Map<string, string>();
  const reserve = (name: string, why: string): void => {
    if (!reserved.has(name)) reserved.set(name, why);
  };
  const prefixes = new Set(options.reservedPrefixes ?? []);
  const suffixes = new Set(options.reservedSuffixes ?? []);
  const add = <K, V>(m: Map<K, Set<V>>, k: K, v: V): void => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(v);
  };
  for (const toks of tokenized) {
    for (const t of toks) {
      const run = t.kind === 'num' && t.glueBefore ? /^[A-Za-z0-9_]+/.exec(t.text) : null;
      if (run) suffixes.add(run[0]);
      if (t.kind !== 'id') continue;
      seen.add(t.text);
      if (!renamable(t) && !t.directiveWord) reserve(t.text, t.layout ? 'dentro de layout(…)' : `en una directiva #${t.directive}`);
      if (t.glueAfter) prefixes.add(t.text);
      if (t.glueBefore) suffixes.add(t.text);
    }
    for (const d of glslDeclarations(toks, structs)) {
      add(declared, d.name, d.kind);
      if (d.type) add(typesOf, d.name, d.type);
      if (d.kind === 'field' && d.owner) {
        let fs = fieldsOf.get(d.owner);
        if (!fs) fieldsOf.set(d.owner, (fs = new Map<string, Set<string>>()));
        add(fs, d.name, d.type ?? '');
      }
    }
    for (const n of glslInterfaceStatementNames(toks)) interfaceNames.add(n);
  }
  /** Los campos de un struct que ve la API (el tipo de un uniform o de una entrada/salida), también los anidados. */
  const protectFields = (ty: string, via: string, done: Set<string>): void => {
    if (done.has(ty)) return;
    done.add(ty);
    for (const [f, fieldTypes] of fieldsOf.get(ty) ?? []) {
      reserve(f, `campo de ${ty}, el tipo de ${via}`);
      for (const ft of fieldTypes) protectFields(ft, via, done);
    }
  };
  const afterDot = new Set<string>();
  for (const [name, kinds] of declared) {
    if (kinds.has('uniform')) reserve(name, 'uniform');
    if (kinds.has('interface')) reserve(name, 'entrada/salida del shader');
    if (kinds.has('uniform') || kinds.has('interface')) for (const ty of typesOf.get(name) ?? []) protectFields(ty, name, new Set());
  }
  for (const n of interfaceNames) reserve(n, 'en una declaración uniform/in/out');
  for (const [name, kinds] of declared) {
    if (kinds.has('field') || kinds.has('macro') || kinds.has('macroParam')) {
      if (GLSL_SWIZZLE.test(name)) reserve(name, kinds.has('field') ? 'campo con forma de swizzle' : 'macro con forma de swizzle');
      else afterDot.add(name);
    }
    if (GLSL_BUILTINS.has(name)) reserve(name, 'palabra de GLSL');
    else if (GLSL_RESERVED_PATTERN.test(name)) reserve(name, 'forma reservada');
    if (options.reserved?.has(name)) reserve(name, 'aparece en una cadena JS');
    for (const p of prefixes) if (name.startsWith(p)) reserve(name, `empieza por «${p}», pegado a una interpolación`);
    for (const s of suffixes) if (name.endsWith(s)) reserve(name, `acaba en «${s}», pegado a una interpolación`);
  }
  for (const f of afterDot) if (reserved.has(f)) afterDot.delete(f);
  const uses = new Map<string, number>();
  for (const toks of tokenized) {
    for (const t of toks) {
      if (!renamable(t) || !declared.has(t.text) || reserved.has(t.text)) continue;
      if (t.dot && !afterDot.has(t.text)) continue;
      uses.set(t.text, (uses.get(t.text) ?? 0) + 1);
    }
  }
  return { declared, reserved, uses, seen, afterDot, prefixes, suffixes };
}

/** Nombres cortos en orden: longitud creciente; primera letra [a-zA-Z], resto [a-zA-Z0-9] (nunca `_`, nunca `__`). */
function* shortNames(): Generator<string> {
  const first = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rest = first + '0123456789';
  for (let len = 1; ; len++) {
    const count = first.length * rest.length ** (len - 1);
    for (let i = 0; i < count; i++) {
      let n = i;
      let tail = '';
      for (let k = 1; k < len; k++) {
        tail = rest[n % rest.length] + tail;
        n = Math.floor(n / rest.length);
      }
      yield first[n] + tail;
    }
  }
}

/**
 * Mapa de renombrado determinista: los nombres renombrables, de más a menos apariciones (a igualdad, por orden
 * alfabético), reciben el siguiente nombre corto libre; un nombre que no sale más corto se queda como está.
 * Un nombre corto está libre si no es palabra de GLSL, no tiene forma reservada ni de swizzle y no coincide con ningún
 * identificador del texto estático ni con nada de `taken`/`reserved` ni empieza/acaba como un fragmento pegado.
 */
export function buildMangleMap(
  templates: ReadonlyArray<readonly string[]>,
  options: MangleOptions = {},
): MangleMap & { analysis: GlslAnalysis } {
  const analysis = analyzeGlsl(templates, options);
  const order = [...analysis.uses].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const free = (n: string): boolean =>
    !analysis.seen.has(n) &&
    !analysis.declared.has(n) &&
    !GLSL_BUILTINS.has(n) &&
    !GLSL_RESERVED_PATTERN.test(n) &&
    !GLSL_SWIZZLE.test(n) &&
    !options.taken?.has(n) &&
    !options.reserved?.has(n) &&
    ![...analysis.prefixes].some((p) => n.startsWith(p)) &&
    ![...analysis.suffixes].some((s) => n.endsWith(s));
  const gen = shortNames();
  const nextFree = (): string => {
    for (;;) {
      const n = gen.next().value as string;
      if (free(n)) return n;
    }
  };
  const names = new Map<string, string>();
  let candidate = nextFree();
  for (const [name] of order) {
    if (candidate.length >= name.length) continue;
    names.set(name, candidate);
    candidate = nextFree();
  }
  return { names, afterDot: analysis.afterDot, analysis };
}

/**
 * Renombra los trozos de una plantilla con el mapa. Un identificador pegado a una interpolación o a un escape no se
 * puede renombrar (el análisis reserva esos nombres): si el mapa lo incluye, la plantilla no pasó por el análisis y se
 * lanza en lugar de producir un shader roto.
 */
export function mangleGlslParts(parts: readonly string[], map: MangleMap): string[] {
  const edits: Array<Array<{ start: number; end: number; text: string }>> = parts.map(() => []);
  for (const t of tokenizeGlsl(parts)) {
    if (!renamable(t)) continue;
    const to = map.names.get(t.text);
    if (to === undefined || (t.dot && !map.afterDot.has(t.text))) continue;
    if (t.glueBefore || t.glueAfter) throw new Error(`glslMangle: «${t.text}» está pegado a una interpolación y el mapa lo renombra`);
    edits[t.part].push({ start: t.start, end: t.end, text: to });
  }
  return parts.map((s, p) => {
    let out = '';
    let last = 0;
    for (const e of edits[p]) {
      out += s.slice(last, e.start) + e.text;
      last = e.end;
    }
    return out + s.slice(last);
  });
}
