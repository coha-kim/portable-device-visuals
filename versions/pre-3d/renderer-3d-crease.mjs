// 3D jelly drawing for the exhibition web page only (the device keeps the flat renderer.mjs). The physics
// is unchanged and 2D; only the drawing gives each body depth, like the blobjects the devices are.
// Two WebGL2 passes:
// 1. Height: each body is drawn as a band from its inner edge (its centre while solid, the hole's edge
//    once it hollows) out to its outline, and the fragment shader turns the band into a height in px:
//    a dome while solid, a rounded rim as it thins (see the profile below). Overlapping bodies keep the
//    higher surface (MAX blending), so touching blobs meet in a crease and still read as separate.
// 2. Shading: normals from the height's slope, lit from the top left: diffuse, a specular highlight,
//    a little rim light, thin jelly slightly see-through, and a soft warm contact shadow on the glass.
// Same draw(bodies, interactSeconds) as JellyRenderer, so either can be used.
import { BACKGROUND, FILL, outlineWidth } from './renderer.mjs?exhibit-2';

const SIZE = 480, SAMPLES = 4;            // physics px; curve samples per node (16 nodes → 64 points)
const HEIGHT = .75;                       // dome height as a share of the band's width (squashed jelly)
const rgb = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255);

const HEIGHT_VS = `#version 300 es
in vec2 aPos; in vec3 aShape; out vec3 vShape;
void main(){ vShape = aShape; gl_Position = vec4(aPos.x / 240. - 1., 1. - aPos.y / 240., 0., 1.); }`;
// u runs 0 at the band's inner edge to 1 at the outline; H is the band's peak height, a how much of the
// band the inner lip rounds over (0 while solid). Solid: H·√(1 − u²), a dome on the whole body. As the
// hole opens the lip rounds the inner side too, so a thin outline becomes a small rounded tube.
const HEIGHT_FS = `#version 300 es
precision highp float; in vec3 vShape; out vec4 o;
void main(){
  float u = clamp(vShape.x, 0., 1.), H = vShape.y, a = vShape.z;
  float outer = sqrt(max(0., 1. - u * u));
  float lip = a > .001 ? max(0., a - u) / a : 0.;
  o = vec4(H * outer * sqrt(max(0., 1. - lip * lip)), 0., 0., 1.);
}`;
const SHADE_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
const SHADE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uH; uniform vec2 uTexel; uniform float uPx, uScale; uniform vec3 uFill, uBg;
float h(vec2 p){ return texture(uH, p).r * uScale; }
void main(){
  vec2 d = vUv - .5; if (dot(d, d) > .25) { o = vec4(uBg, 1.); return; }
  float c = h(vUv);
  // Contact shadow: the jelly a few px up and to the left of this point, averaged, darkens the glass.
  vec2 off = vec2(5., -6.) / 480.; float s = 0.;
  for (int i = 0; i < 8; i++) { float a = float(i) * 2.39996; s += h(vUv - off + vec2(cos(a), sin(a)) * float(i) * .55 / 480.); }
  float shadow = clamp(s / 8. / 14., 0., 1.) * .3;
  vec3 glass = uBg * mix(vec3(1.), vec3(.86, .8, .76), shadow / .3) * (1. - shadow * .35);
  if (c <= 0.) { o = vec4(glass, 1.); return; }
  float hx = (h(vUv + vec2(uTexel.x, 0.)) - h(vUv - vec2(uTexel.x, 0.))) / (2. * uPx);
  float hy = (h(vUv + vec2(0., uTexel.y)) - h(vUv - vec2(0., uTexel.y))) / (2. * uPx);
  vec3 n = normalize(vec3(-hx, -hy, 1.)), L = normalize(vec3(-.45, .55, .7)), half_ = normalize(L + vec3(0., 0., 1.));
  float diffuse = max(dot(n, L), 0.), spec = pow(max(dot(n, half_), 0.), 60.), rim = pow(1. - n.z, 2.);
  float thick = 1. - exp(-c / 9.);
  vec3 jelly = uFill * (.66 + .42 * diffuse);
  jelly = mix(uFill * 1.03, jelly * .94, thick);           // thin jelly a touch lighter, thick is deeper
  jelly += vec3(1., .86, .74) * rim * .14 + spec * .5;
  float cover = clamp(c / (.9 * uPx), 0., 1.), opacity = mix(.9, .97, thick);
  o = vec4(mix(glass, min(jelly, 1.), cover * opacity), 1.);
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
  // Returns null where WebGL2 is missing, so the caller can fall back to the flat JellyRenderer.
  static create(canvas, options) {
    try { const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false }); return gl ? new Jelly3DRenderer(canvas, gl, options) : null; }
    catch (error) { console.warn('3D renderer unavailable:', error); return null; }
  }
  constructor(canvas, gl, { pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1) } = {}) {
    this.canvas = canvas; this.gl = gl; this.kind = 'webgl2';
    this.size = Math.round(SIZE * Math.max(1, pixelRatio));
    canvas.width = canvas.height = this.size;
    this.heightProgram = program(gl, HEIGHT_VS, HEIGHT_FS); this.shadeProgram = program(gl, SHADE_VS, SHADE_FS);
    // Height target: half-float where the GPU can render to it, else 8-bit scaled to 0..1.
    const half = !!gl.getExtension('EXT_color_buffer_float');
    this.heightScale = half ? 1 : 48;
    this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, this.size, this.size, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Body bands: x, y, u, H, a per vertex, two triangles per outline sample.
    this.bodyVao = gl.createVertexArray(); gl.bindVertexArray(this.bodyVao);
    this.bodyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuffer);
    const posH = gl.getAttribLocation(this.heightProgram, 'aPos'), shapeH = gl.getAttribLocation(this.heightProgram, 'aShape');
    gl.enableVertexAttribArray(posH); gl.vertexAttribPointer(posH, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(shapeH); gl.vertexAttribPointer(shapeH, 3, gl.FLOAT, false, 20, 8);
    this.vertices = new Float32Array(0);
    this.quadVao = gl.createVertexArray(); gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posS = gl.getAttribLocation(this.shadeProgram, 'aPos');
    gl.enableVertexAttribArray(posS); gl.vertexAttribPointer(posS, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const u = name => gl.getUniformLocation(this.shadeProgram, name);
    gl.useProgram(this.shadeProgram);
    gl.uniform1i(u('uH'), 0); gl.uniform2f(u('uTexel'), 1 / this.size, 1 / this.size);
    gl.uniform1f(u('uPx'), SIZE / this.size); gl.uniform1f(u('uScale'), this.heightScale);
    gl.uniform3fv(u('uFill'), rgb(FILL)); gl.uniform3fv(u('uBg'), rgb(BACKGROUND));
  }
  get fill() { return FILL; }
  set() {}
  // interactSeconds: how long the user has been interacting (0 = solid jelly).
  draw(bodies, interactSeconds = 0) {
    const gl = this.gl, perBody = bodies.length ? 16 * SAMPLES * 6 * 5 : 0;
    if (this.vertices.length < bodies.length * perBody) this.vertices = new Float32Array(bodies.length * perBody);
    const v = this.vertices; let i = 0;
    const put = (x, y, u, H, a) => { v[i++] = x; v[i++] = y; v[i++] = u; v[i++] = H; v[i++] = a; };
    for (const body of bodies) {
      const outline = smoothOutline(body.nodes), c = body.centroid, R = body.radius;
      const w = Math.min(R, outlineWidth(R, interactSeconds)), H = w * HEIGHT / this.heightScale, a = 1 - w / R;
      const inner = outline.map(p => { const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, d - w) / d; return { x: c.x + dx * k, y: c.y + dy * k }; });
      for (let k = 0, n = outline.length; k < n; k++) {
        const p0 = outline[k], p1 = outline[(k + 1) % n], q0 = inner[k], q1 = inner[(k + 1) % n];
        put(q0.x, q0.y, 0, H, a); put(p0.x, p0.y, 1, H, a); put(p1.x, p1.y, 1, H, a);
        put(q0.x, q0.y, 0, H, a); put(p1.x, p1.y, 1, H, a); put(q1.x, q1.y, 0, H, a);
      }
    }
    // Pass 1: heights, the higher surface winning where bodies overlap.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.viewport(0, 0, this.size, this.size);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.heightProgram); gl.bindVertexArray(this.bodyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuffer); gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, i), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, i / 5);
    gl.disable(gl.BLEND);
    // Pass 2: light it onto the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.size, this.size);
    gl.useProgram(this.shadeProgram); gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
