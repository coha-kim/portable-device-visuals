// Camera view for the exhibition page: the visitor, mirrored, cut out from the room behind them, drawn at
// an opacity that follows their social battery (full at Harvey's baseline, fading as they shake).
// Person segmentation is Google's MediaPipe selfie segmenter, run in the browser; nothing is recorded or
// sent anywhere. The room behind the person is learned as they move (each frame's background pixels are
// kept, over the plain panel colour), so a fading person reveals the room where it has been seen, and
// the plain panel where they have stood all along, never a ghost of themselves.
// Without segmentation (offline, or it fails) the whole camera image fades instead.
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const SEGMENT_FPS = 20;

const layer = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export class PresenceMirror {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    this.person = layer(w, h); this.room = layer(w, h); this.plate = layer(w, h); this.mask = null;
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    this.live = false; this.segmenter = null; this.lastSegment = -Infinity; this.plateReady = false;
  }
  // Ask for the camera (only on the visitor's tap) and load the segmenter alongside.
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    this.video.srcObject = stream; await this.video.play(); this.live = true;
    this.loadSegmenter().catch(error => console.warn('Person segmentation unavailable, fading the whole image:', error));
  }
  async loadSegmenter() {
    const { FilesetResolver, ImageSegmenter } = await import(`${VISION}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    this.segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO',
      outputConfidenceMasks: true, outputCategoryMask: false
    });
  }
  // Draw an image into (w, h) like object-fit: cover, mirrored like a mirror.
  cover(ctx, source, sw, sh) {
    const { width: w, height: h } = this.canvas, k = Math.max(w / sw, h / sh), dw = sw * k, dh = sh * k;
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh); ctx.restore();
  }
  segment(now) {
    if (!this.segmenter || now - this.lastSegment < 1000 / SEGMENT_FPS || this.video.readyState < 2) return;
    this.lastSegment = now;
    this.segmenter.segmentForVideo(this.video, now, result => {
      const m = result.confidenceMasks?.[0]; if (!m) return;
      const values = m.getAsFloat32Array();
      if (!this.mask || this.mask.width !== m.width) { this.mask = layer(m.width, m.height); this.maskData = new ImageData(m.width, m.height); }
      const d = this.maskData.data;
      // Sharpen the confidence a little so the edge of the person is clean.
      for (let i = 0; i < values.length; i++) d[i * 4 + 3] = 255 * Math.min(1, Math.max(0, (values[i] - .25) / .5));
      this.mask.getContext('2d').putImageData(this.maskData, 0, 0);
      result.close?.();
    });
  }
  // presence: 1 at the baseline (person fully there), toward 0 as the battery drains.
  draw(presence, now = performance.now()) {
    if (!this.live) return;
    const { ctx, video } = this, { width: w, height: h } = this.canvas, vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    this.segment(now);
    const alpha = Math.max(0, Math.min(1, presence));
    if (!this.mask) {
      ctx.fillStyle = getComputedStyle(this.canvas.parentElement).backgroundColor; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = alpha; this.cover(ctx, video, vw, vh); ctx.globalAlpha = 1; return;
    }
    // The person: the frame kept only where the mask is.
    const p = this.person.getContext('2d'); p.globalCompositeOperation = 'copy'; this.cover(p, video, vw, vh);
    p.globalCompositeOperation = 'destination-in'; this.cover(p, this.mask, this.mask.width, this.mask.height);
    // The room: the frame without the person, laid over what has been seen of the room so far.
    const plate = this.plate.getContext('2d');
    if (!this.plateReady) { plate.fillStyle = getComputedStyle(this.canvas.parentElement).backgroundColor; plate.fillRect(0, 0, w, h); this.plateReady = true; }
    const r = this.room.getContext('2d'); r.globalCompositeOperation = 'copy'; this.cover(r, video, vw, vh);
    r.globalCompositeOperation = 'destination-out'; this.cover(r, this.mask, this.mask.width, this.mask.height);
    plate.drawImage(this.room, 0, 0);
    ctx.globalCompositeOperation = 'copy'; ctx.drawImage(this.plate, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = alpha; ctx.drawImage(this.person, 0, 0); ctx.globalAlpha = 1;
  }
}
