// 3D bubble drawing for the exhibition web page only (the device keeps the flat renderer.mjs). The physics
// is unchanged and 2D; only the drawing gives each body depth: glossy orange bubbles that, when they
// touch, join in a smooth rounded neck (high surface tension) instead of meeting in a crease.
// Two WebGL2 passes:
// 1. Field: each body is drawn as a fan from its centre to its smoothed outline plus a skirt a little
//    beyond it, carrying the signed distance to its outline (negative inside). Two channels blend at
//    once: red adds exp(−K·d) over the bodies (a smooth union: near each other the bodies' fields add,
//    so the surface bridges small gaps and fills the corner where two meet), alpha keeps the deepest
//    point (MAX) for the inside.
// 2. Shading: the joined signed distance becomes a dome height, normals come from its slope, lit from
//    the top left with a sharp highlight, a faint second reflection and a deeper edge, over a soft warm
//    shadow on the glass. As the user interacts the bubbles hollow: inside the outline width the jelly
//    turns to a clear film, so a drained bubble is an orange wall with its highlight still on it, and two
//    touching ones share a wall, like soap bubbles.
// Same draw(bodies, interactSeconds) as JellyRenderer, so either can be used.
import { BACKGROUND, FILL, outlineWidth } from './renderer.mjs?exhibit-10';

const SIZE = 480, SAMPLES = 4;            // physics px; curve samples per node (16 nodes → 64 points)
const K = .3;                             // smooth-union sharpness (1/px): gaps under ~2 ln 2 / K ≈ 4.6 px bridge
const DEPTH_CAP = 12, SKIRT = 10;         // px: depth the union term covers; how far beyond the outline it reaches
const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255);

const FIELD_VS = `#version 300 es
in vec2 aPos; in float aD; out float vD;
void main(){ vD = aD; gl_Position = vec4(aPos.x / 240. - 1., 1. - aPos.y / 240., 0., 1.); }`;
const FIELD_FS = `#version 300 es
precision highp float; in float vD; out vec4 o;
void main(){
  float union_ = exp(-${K.toFixed(2)} * max(vD, -${DEPTH_CAP.toFixed(1)})) * (1. - smoothstep(${(SKIRT * .5).toFixed(1)}, ${SKIRT.toFixed(1)}, vD));
  o = vec4(union_, 0., 0., max(0., -vD));
}`;
const SHADE_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
const SHADE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uF; uniform vec2 uTexel; uniform float uPx, uR, uWall; uniform vec3 uFill, uBg;
// Signed depth inside the joined surface, px (negative outside).
float depth(vec2 p){ vec4 f = texture(uF, p); float u = log(max(f.r, 1e-4)) / ${K.toFixed(2)}; return f.a > 0. ? max(f.a, u) : u; }
// Dome height of a bubble of radius uR at that depth, a little squashed.
float height(float s){ float q = clamp(s, 0., uR); return sqrt(q * (2. * uR - q)) * .85; }
void main(){
  vec2 d = vUv - .5; if (dot(d, d) > .25) { o = vec4(uBg, 1.); return; }
  float s = depth(vUv);
  // Soft shadow: the bubbles a few px up and to the left of this point darken the glass, warmly.
  vec2 off = vec2(4., -5.) / 480.; float sh = 0.;
  for (int i = 0; i < 8; i++) { float a = float(i) * 2.39996; sh += clamp(depth(vUv - off + vec2(cos(a), sin(a)) * float(i) * .6 / 480.) / 8., 0., 1.); }
  sh = sh / 8. * .22;
  vec3 glass = uBg * mix(vec3(1.), vec3(.88, .8, .74), sh / .22) * (1. - sh * .3);
  float cover = clamp(s / uPx + .5, 0., 1.);
  if (cover <= 0.) { o = vec4(glass, 1.); return; }
  float hx = (height(depth(vUv + vec2(uTexel.x, 0.))) - height(depth(vUv - vec2(uTexel.x, 0.)))) / (2. * uPx);
  float hy = (height(depth(vUv + vec2(0., uTexel.y))) - height(depth(vUv - vec2(0., uTexel.y)))) / (2. * uPx);
  vec3 n = normalize(vec3(-hx, -hy, 1.)), L = normalize(vec3(-.5, .6, .62)), V = vec3(0., 0., 1.);
  float diffuse = max(dot(n, L), 0.), edge = pow(1. - n.z, 2.2);
  float spec = pow(max(dot(n, normalize(L + V)), 0.), 140.) * .95;               // the window highlight
  float glint = pow(max(dot(n, normalize(vec3(.55, -.6, .3))), 0.), 10.) * .2;   // a faint reflection, lower right
  // Wall: within uWall of the surface the bubble is jelly; deeper in it is clear film (all jelly while solid).
  float wall = uWall >= uR ? 1. : 1. - smoothstep(uWall - uPx, uWall + uPx, s);
  vec3 jelly = uFill * (.74 + .34 * diffuse);
  jelly = mix(jelly, uFill * vec3(.86, .74, .7), edge * .55);                     // deeper colour toward the edge
  // The clear film lets the glass through, a little brighter and warmer, and keeps its own shadow off.
  vec3 film = mix(uBg, vec3(1.), .05 + .12 * diffuse) * mix(vec3(1.), uFill * 1.2, .1);
  vec3 col = mix(glass, mix(film, jelly, wall * .96), cover);
  col += (spec + glint) * cover * mix(.75, 1., wall);
  o = vec4(min(col, 1.), 1.);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// The same smooth outline as tracePath: quadratic curves between edge midpoints, sampled.
export function smoothOutline(nodes, samples = SAMPLES) {
  const n = nodes.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = nodes[(i + n - 1) % n], p = nodes[i], b = nodes[(i + 1) % n];
    const s0x = (a.x + p.x) / 2, s0y = (a.y + p.y) / 2, s1x = (p.x + b.x) / 2, s1y = (p.y + b.y) / 2;
    for (let k = 0; k < samples; k++) {
      const t = k / samples, m = 1 - t;
      out.push({ x: m * m * s0x + 2 * m * t * p.x + t * t * s1x, y: m * m * s0y + 2 * m * t * p.y + t * t * s1y });
    }
  }
  return out;
}

export class Jelly3DRenderer {
  // Returns null where WebGL2 or half-float render targets are missing (or a shader fails), so the caller
  // can fall back to the flat JellyRenderer. A canvas keeps the first context it gave out, so after a
  // failure the canvas is swapped for a fresh copy in the page: look it up again before drawing flat.
  static create(canvas, options) {
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
      if (gl && gl.getExtension('EXT_color_buffer_float')) return new Jelly3DRenderer(canvas, gl, options);
    } catch (error) { console.warn('3D renderer unavailable:', error); }
    if (gl) canvas.replaceWith(canvas.cloneNode());
    return null;
  }
  constructor(canvas, gl, { pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1) } = {}) {
    this.canvas = canvas; this.gl = gl; this.kind = 'webgl2';
    this.size = Math.round(SIZE * Math.max(1, pixelRatio));
    canvas.width = canvas.height = this.size;
    this.fieldProgram = program(gl, FIELD_VS, FIELD_FS); this.shadeProgram = program(gl, SHADE_VS, SHADE_FS);
    this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.size, this.size, 0, gl.RGBA, gl.HALF_FLOAT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Bodies: x, y, signed distance per vertex; a fan triangle and a skirt quad per outline sample.
    this.bodyVao = gl.createVertexArray(); gl.bindVertexArray(this.bodyVao);
    this.bodyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuffer);
    const pos = gl.getAttribLocation(this.fieldProgram, 'aPos'), dist = gl.getAttribLocation(this.fieldProgram, 'aD');
    gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(dist); gl.vertexAttribPointer(dist, 1, gl.FLOAT, false, 12, 8);
    this.vertices = new Float32Array(0);
    this.quadVao = gl.createVertexArray(); gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const quad = gl.getAttribLocation(this.shadeProgram, 'aPos');
    gl.enableVertexAttribArray(quad); gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const u = name => gl.getUniformLocation(this.shadeProgram, name);
    this.uniforms = { radius: u('uR'), wall: u('uWall') };
    gl.useProgram(this.shadeProgram);
    gl.uniform1i(u('uF'), 0); gl.uniform2f(u('uTexel'), 1 / this.size, 1 / this.size);
    gl.uniform1f(u('uPx'), SIZE / this.size);
    gl.uniform3fv(u('uFill'), rgb(FILL)); gl.uniform3fv(u('uBg'), rgb(BACKGROUND));
  }
  get fill() { return FILL; }
  set() {}
  // interactSeconds: how long the user has been interacting (0 = solid jelly).
  draw(bodies, interactSeconds = 0) {
    const gl = this.gl, perBody = 16 * SAMPLES * 9 * 3;
    if (this.vertices.length < bodies.length * perBody) this.vertices = new Float32Array(bodies.length * perBody);
    const v = this.vertices; let i = 0, radius = 0;
    const put = (p, d) => { v[i++] = p.x; v[i++] = p.y; v[i++] = d; };
    for (const body of bodies) {
      const outline = smoothOutline(body.nodes), c = body.centroid, R = body.radius; radius += R;
      const skirt = outline.map(p => { const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1; return { x: p.x + dx / d * SKIRT, y: p.y + dy / d * SKIRT }; });
      for (let k = 0, n = outline.length; k < n; k++) {
        const p0 = outline[k], p1 = outline[(k + 1) % n], s0 = skirt[k], s1 = skirt[(k + 1) % n];
        put(c, -R); put(p0, 0); put(p1, 0);
        put(p0, 0); put(s0, SKIRT); put(s1, SKIRT);
        put(p0, 0); put(s1, SKIRT); put(p1, 0);
      }
    }
    radius = bodies.length ? radius / bodies.length : 22;
    // Pass 1: the field (union adds, depth keeps the deepest).
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.viewport(0, 0, this.size, this.size);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.fieldProgram); gl.bindVertexArray(this.bodyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuffer); gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, i), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND); gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, i / 3);
    gl.disable(gl.BLEND);
    // Pass 2: light it onto the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.size, this.size);
    gl.useProgram(this.shadeProgram); gl.bindVertexArray(this.quadVao);
    gl.uniform1f(this.uniforms.radius, radius); gl.uniform1f(this.uniforms.wall, outlineWidth(radius, interactSeconds));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
