// Bounded low-resolution scalar field: no SVG filters, blur passes, or DOM shapes.
// Arrays are reused; every output pixel (including the background) is overwritten.
export function paintPixels(width, height, blobs, opacity, background, field, light, pixels) {
  field.fill(0); light.fill(0);
  for (const b of blobs) {
    const r2 = b.r * b.r;
    const support = b.r * 2;
    const left = Math.max(0, Math.floor(b.x - support));
    const right = Math.min(width - 1, Math.ceil(b.x + support));
    const top = Math.max(0, Math.floor(b.y - support));
    const bottom = Math.min(height - 1, Math.ceil(b.y + support));
    for (let y = top; y <= bottom; y++) {
      const dy2 = (y + .5 - b.y) ** 2;
      for (let x = left; x <= right; x++) {
        const d2 = ((x + .5 - b.x) ** 2 + dy2) / r2;
        if (d2 >= 4) continue;
        const u = 1 - d2 * .25;
        const value = u * u * u;
        const index = y * width + x;
        field[index] += value;
        light[index] += value * Math.max(0, 1 - Math.sqrt(d2));
      }
    }
  }
  // A lone blob crosses this threshold at its nominal radius: (1 - 1/4)^3.
  const threshold = .421875;
  const feather = .065;
  for (let i = 0; i < field.length; i++) {
    const t = Math.max(0, Math.min(1, (field[i] - threshold) / feather + .5));
    const alpha = t * t * (3 - 2 * t) * opacity;
    const center = field[i] > 0 ? light[i] / field[i] : 0;
    const p = i * 4;
    pixels[p] = background[0] + (42 + 141 * center - background[0]) * alpha;
    pixels[p + 1] = background[1] + (146 + 72 * center - background[1]) * alpha;
    pixels[p + 2] = background[2] + (132 + 81 * center - background[2]) * alpha;
    pixels[p + 3] = 255;
  }
}
export class MetaballRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.buffer = document.createElement('canvas');
    this.bufferContext = this.buffer.getContext('2d', { alpha: false });
    this.points = Array.from({ length: 8 }, () => ({ x: 0, y: 0, r: 0 }));
  }
  resize(width, height) {
    // One visible pixel per CSS pixel; do not pay 4–9x cost on Retina displays.
    this.canvas.width = width; this.canvas.height = height;
    const scale = Math.min(.5, Math.sqrt(90000 / (width * height)));
    this.buffer.width = Math.max(1, Math.round(width * scale));
    this.buffer.height = Math.max(1, Math.round(height * scale));
    this.scaleX = this.buffer.width / width;
    this.scaleY = this.buffer.height / height;
    const count = this.buffer.width * this.buffer.height;
    this.field = new Float32Array(count);
    this.light = new Float32Array(count);
    this.image = this.bufferContext.createImageData(this.buffer.width, this.buffer.height);
    this.context.imageSmoothingEnabled = true;
  }
  draw(blobs, opacity, background) {
    for (let i = 0; i < blobs.length; i++) {
      const p = this.points[i], b = blobs[i];
      p.x = b.x * this.buffer.width;
      p.y = b.y * this.buffer.height;
      p.r = b.radius * this.scaleX;
    }
    paintPixels(this.buffer.width, this.buffer.height, this.points, opacity, background, this.field, this.light, this.image.data);
    this.bufferContext.putImageData(this.image, 0, 0);
    // Opaque, full-canvas replacement on EVERY frame; nothing can accumulate.
    this.context.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
  }
}
