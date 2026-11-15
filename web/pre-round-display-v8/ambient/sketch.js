// ambient-device-visuals -- wax drops in a lava lamp for multiple populations.
// v21: surface tension drives how same-population wax merges and splits; where
// DIFFERENT populations meet, a temporary, fully-reversible metaball MERGE
// (or bounce) is still set by the portable-controlled attraction.
//
// Three logic domains are kept deliberately separate -- this boundary is what
// later sensor mapping depends on:
//
//   AUTONOMOUS (fixed, never sensor-exposed) -- Drop.wander()
//     Each drop wanders on its OWN Perlin-noise walk (seeded per drop). Nothing
//     a drop does here depends on any other drop. Movement SPEED is per population
//     (see speedByPop); the noise walk itself is fixed.
//
//   WAX (fixed, never sensor-exposed) -- Drop.deform(), coalesceDrops(), splitDrops()
//     Surface tension acts between touching drops of any colour (see coalesceDrops()).
//     Each drop holds a conserved area of its population's wax and is shaped as
//     two lobes on an axis: coincident lobes are a round drop, separated lobes a
//     peanut with a neck. A slow background flow stretches the lobes apart;
//     surface tension pulls them back, harder for small drops (Laplace pressure
//     ~ 1/R), so big drops wobble and neck while small ones stay round. A drop
//     stretched to its pinch point splits into two smaller drops at its lobes.
//     Same-population drops that stay in contact long enough to drain the film
//     between them coalesce into one larger drop, which then rounds up. Total
//     wax per population never changes; the drop count is emergent.
//
//   BUOYANCY (fixed, never sensor-exposed) -- Drop.heat()
//     Like a lava lamp: wax only warms in the heater zone at the bottom and only
//     cools in the top zone, so each drop heats, rises, lingers at the top while
//     cooling, sinks and reheats. Moving drops are drawn out along their travel.
//     The water circulates: rising wax drifts toward the centre, sinking wax
//     toward the walls (Drop.convection()).
//
//   INTER-POPULATION (sensor-exposed: per-population attractionStrength; also
//   overallSize / per-population speed) -- Drop.applyCrossPopulationForces()
//     attractionStrength is set by the PULLED drop's own population, so it can be
//     asymmetric (pop 1 can chase the others harder than they chase it), and it
//     sweeps that population's contact with the others from a clean BOUNCE (weak
//     -- a firm repulsion shell held outside metaball fusion range) to a MERGE
//     (strong -- the shell recedes and attraction pulls drops deep enough to
//     fuse). Different populations never exchange wax, so colours stay distinct.
//
// RENDER: one shared scalar field. Each lobe stamps a smooth (1 - d^2)^2 kernel
// carrying its population colour into accumulation buffers; the iso-surface of
// the summed field is the wax outline, so contact grows a genuine neck and a
// stretched drop shows its waist. Colours blend where fields overlap, lighten
// toward white in the thick middle, and keep a restrained coloured ring.
//
// Each population has its own `speed` slider: it scales that population's
// wander-clock advance and its per-frame step size (see speedByPop).

// ---- fixed config (set at init, NOT live-adjustable) ----
// The Pi's 1024x600 display is mounted vertically, so the lamp is portrait:
// buoyancy runs along the long side.
const CANVAS_W = 600;
const CANVAS_H = 1024;
// The canvas is a window onto a wider lamp: the world is WORLD_SCALE screens wide
// (looping at its far ends) and the canvas shows its middle. Wax exists all
// across it, so drops drift out of view and others drift in.
const WORLD_SCALE = 3;
const WORLD_W = CANVAS_W * WORLD_SCALE;
const VIEW_X = (WORLD_W - CANVAS_W) / 2; // world x of the canvas's left edge
const POP_COUNT = 3;
const MIN_INDIVIDUALS_PER_POP = 2;
const MAX_INDIVIDUALS_PER_POP = 4;
const POP_COLORS = Object.freeze(['#8DD644', '#00E2B7', '#009AE2']);

// ---- drop shape ----
// Field colour is the base colour at the rim, lightened toward white where the
// field is thick; nothing is darker than the base colour.
const CENTER_LIGHTEN = 0.66;

// ---- autonomous wander (fixed) ----
const MOVE_BASE_PX = 0.9;    // px/frame at speed 1; speed envelope adds variation
const NOISE_BASE   = 0.005;  // wander-time advance per frame at speed 1
const WANDER_SPEED_MIN = 0.35;
const WANDER_SPEED_MAX = 1.10;
const WANDER_SPEED_OFFSET = 8441;
// vx = noise(seed+off0) - noise(seed+off1), vy likewise with off2/off3. Four
// far-apart offsets so the channels are mutually decorrelated; a difference of
// two noise samples is zero-mean whatever noise()'s own mean is (see wander()).
const WANDER_NOISE_OFFSETS = [0, 2113, 4229, 6337];
const EDGE_MARGIN  = 110;
const EDGE_STEER   = 2.6;

// ---- wax surface tension (v21, fixed) ----
// Areas are relative to a base blob (effectiveBlobSize() squared), so overallSize
// still scales everything.
// TENSION_RELAX, COALESCE_PULL, HEAT_RATE and BUOYANCY_PX live in `tuning` below
// so they can be adjusted on the page (open it with ?tune).
const FLOW_SCALE = 1 / 300;      // spatial scale of the background flow (1/px)
const FLOW_TIME_STEP = 0.0018;   // how fast the flow pattern evolves per frame
const FLOW_STRAIN = 8;           // how strongly flow differences stretch a drop
const STRAIN_PROBE = 0.6;        // flow is sampled this * R beyond each lobe
const SPLIT_SEPARATION = 1.0;    // lobes this * (sum of child radii) apart = pinch-off
// Drops per colour are capped by tuning.MAX_DROPS_PER_COLOUR per screen width of the world (maxDropsPerColour()).
function maxDropsPerColour() { return tuning.MAX_DROPS_PER_COLOUR * WORLD_SCALE; }
const MAX_DROP_AREA_FACTOR = 3.6; // drops this * the minimum size no longer coalesce (they stay touching); a whole colour can gather into one
const WAX_PER_COLOUR = 2.988;     // each colour's wax, in minimum drops (enough for drops of varied sizes)
const SPLIT_SHARE_EASE = 0.004;   // per-frame drift of a drop's wax between its lobes, toward its own split point (each split makes new sizes)
// The smallest drop: no split may leave a drop smaller than tuning.MIN_DROP_AREA,
// drops start at least this big, and drops may coalesce up to MAX_DROP_AREA_FACTOR
// times it, so a drop can always grow big enough to split into two minimum drops.
function maxDropArea() { return Math.max(1.8, tuning.MIN_DROP_AREA * MAX_DROP_AREA_FACTOR); }
const UNSPLITTABLE_STRETCH = 0.5; // a drop that may not split stretches at most this share of its pinch (oval, no neck)
const UNSPLITTABLE_EASE = 0.06;  // per-frame easing back to that limit when it starts to apply
const SPLIT_KICK = 0.5;          // px/frame that fresh siblings move apart
const DRIFT_DECAY = 0.97;        // per-frame decay of that kick
const LOBE_EASE = 0.06;          // per-frame easing of lobe size toward the stretch
const CONTACT_REACH = 0.95;      // same-pop contact when centres are closer than this * (R1 + R2)
const DRAIN_FRAMES = 40;         // contact time before two drops coalesce (film drainage)
const SEPARATING_SPEED = 0.05;   // px/frame: drops moving apart faster than this never finish draining
const FUSE_REACH = 0.8;          // ...and centres within this * (R1 + R2)
const ROUND_TO_FUSE = 0.35;      // ...and neither drop stretched past this share of its pinch
const SIBLING_COOLDOWN = 240;    // frames before freshly split siblings may re-fuse

// ---- lava-lamp buoyancy (v22, fixed) ----
// Wax only gains heat touching the heater zone at the bottom and only loses it
// in the cool zone at the top; in between it mostly keeps its temperature. Warm
// wax is lighter than the water and rises, cold wax sinks, so each drop cycles:
// heat at the bottom, rise, linger at the top while cooling, sink, reheat.
// Bigger drops heat and cool more slowly (less surface per volume) but rise and
// sink faster. Speeds also follow each population's speed setting.
const HEATER_ZONE = 0.30;        // bottom share of the canvas that heats wax
const COOL_ZONE = 0.30;          // top share of the canvas that cools wax
const MID_EXCHANGE = 0.0001;     // very slow drift toward neutral elsewhere
const NEUTRAL_TEMP = 0.5;        // warmer than this rises, cooler sinks
const BUOYANCY_TEMP_EXPONENT = 0.5; // <1: a drop just past neutral already moves decisively
const BUOYANCY_SIZE_EXPONENT = 0.5; // speed grows with radius^this
const BUOYANCY_INERTIA = 0.025;  // per-frame easing toward the buoyant speed
const BUOYANT_STRETCH = 0.6;     // moving drops stretch along their travel (teardrops, columns)

// ---- tunable wax and buoyancy values (fixed for the exhibition; ?tune adds sliders) ----
const TUNING_DEFAULTS = Object.freeze({
  TENSION_RELAX: 0.014,   // surface tension: per-frame pull back to round for a base-size drop (scales with base/R)
  COALESCE_PULL: 0,       // colour attraction: 0 bounce (colours never merge), > 0 attract and merge
  BUOYANCY_PX: 0.8,       // buoyancy: px/frame at the hottest/coldest temperature for a base-size drop
  HEAT_RATE: 0.004,       // buoyancy: per-frame heating/cooling in the zones (lower = lingers longer)
  CONVECTION: 0.5,        // sideways circulation: rising wax drifts to the centre, sinking wax to the walls
  WANDER: 0.5,            // share of the free Perlin wander kept alongside buoyancy
  MIN_DROP_AREA: 1.57,    // smallest drop, as area relative to a base blob (1.57 = about 195 px across)
  MAX_DROPS_PER_COLOUR: 2, // at most this many drops of each colour per screen width of the lamp
  MAX_MERGE_GROUP: 3,     // at most this many drops of different colours merge together
  MAX_MERGE_SECONDS: 2.5, // two colours stay merged at most this long, then let go
  SHAPE_IRREGULARITY: 1,  // 0 = drops rest as circles; higher = irregular, slowly changing blobs
  ACCELERATION: 0.04      // per frame, how quickly a drop's speed and direction follow what acts on it (1 = instant)
});
const REST_STRETCH = 0.2;         // resting lobe separation at irregularity 1, * radius (before noise)
const WAVE_2_AMPLITUDE = 0.13;    // 2-fold outline bump (stretch) at irregularity 1, share of radius
const WAVE_3_AMPLITUDE = 0.12;    // 3-fold outline bump (lopsided corners, flatter sides) at irregularity 1
const SHAPE_DRIFT = 0.0025;       // how fast resting shapes change per frame
const tuning = { ...TUNING_DEFAULTS };

// ---- attraction forces ----
// Inter-population strength is exposed to the portable device. Same-population
// behaviour is the fixed wax model above, so portable input cannot change it.
const BASE_INTER_ATTRACTION = 0.8;
const COLLISION_REACH_FACTOR = 1.05;
const INTER_ATTRACTION_SCALE_BY_POP = Object.freeze([1.0, 1.0, 1.0]);
const ZERO_ATTRACTION_SEPARATION = 1.02;
const WALL_MIRROR_FACTOR = 0.65;
const VISIBLE_EDGE = Math.sqrt(1 - Math.sqrt(0.20)); // a round kernel's visible outline, as a share of its radius (FIELD_ISO 0.2)
const WALL_EASE = 0.15;           // per call, share of a wall overshoot corrected (eases drops back instead of snapping)
// Radii scale with overallSize so the behaviour looks the same at any drop size.
//
// attractionStrength sweeps a population's cross-population contact from a clean
// BOUNCE to a MERGE:
//   weak  -> a firm repulsion shell sits OUTSIDE metaball fusion range, so
//            different-population drops deflect off each other and never fuse.
//   strong-> the shell recedes to a small anti-collapse core AND attraction
//            pulls drops deep past fusion range, so a fat coloured neck forms.
// mergeT in [0,1] is how far along that sweep this population sits (0 below
// MERGE_THRESHOLD, 1 at ATTR_MAX); it lerps both the shell radius and its gain.
const MERGE_THRESHOLD    = 0.6;   // attractionStrength at/below this = pure bounce, no merge
const MERGE_RESPONSE     = 0.68;  // <1 makes mid-range portable changes more visible
const INTERACTION_FACTOR = 2.6;   // attraction reaches this * overallSize
const MERGE_FULL_FACTOR  = 1.4;   // mergeAmount reaches 1 at this * overallSize (deep overlap)
const REPEL_DIST_BOUNCE = 2.8;    // soft-shell onset at mergeT 0 (* overallSize) -- beyond fusion range
const REPEL_DIST_MERGE  = 1.3;    // soft-shell onset at mergeT 1 (* overallSize) -- anti-collapse core only
const REPULSION_BOUNCE  = 3.0;    // px/frame max soft repel at mergeT 0 -- cushions the approach
const REPULSION_MERGE   = 0.9;    // px/frame max soft repel at mergeT 1 -- a light cushion
// HARD floor on different-population spacing, enforced as a position correction
// (resolveCrossPopulationSeparation). This is the actual guarantee that a weak
// pair BOUNCES: at mergeT 0 it holds them BOUNCE_SEPARATION * overallSize apart,
// just outside metaball fusion range; it shrinks to 0 as mergeT -> 1 so strong
// pairs are free to overlap and MERGE. The soft shell above just smooths it.
const BOUNCE_SEPARATION  = 2.5;   // * overallSize, at mergeT 0
const SEPARATION_ITERS   = 2;     // relaxation passes per frame (keeps 3-population shoves stable)
// Anti-collapse core for merging pairs: without it attraction pulls different
// colours onto the same point and they average into one flat colour.
const MERGE_CORE_FACTOR = 0.55;   // core reaches this * (R1 + R2)
// Colour attraction: 0 = colours bounce and never merge (see keepColoursApart()), above 0 they merge.
const MERGE_BLEND_FULL = 0.4;     // colour attraction at which different colours render fully fused
const BOUNDARY_SOFTNESS = 0.35;   // width of the soft edge where two unmerged colours meet (share of an even split)
const CONTACT_STIFFNESS = 0.25;   // per frame, share of an outline overlap pushed back out
const MAX_CONTACT_PUSH = 2.5;     // px/frame cap on that push
const BOUNCE_RESTITUTION = 0.35;  // share of the closing speed kept when two unmerged colours bounce off each other
const BOUNCE_MIN_SPEED = 0.15;    // px/frame: slower presses just stop instead of bouncing
const MERGE_FADE_FRAMES = 30;     // a merge cross-fades over this many frames (half a second)
const PRESENCE_PULL = 1.2;        // px/frame sideways drift that keeps each colour on screen
const MERGE_RAMP_FRAMES = 30;     // two colours blend in or out over this many frames when a merge link starts or ends
function mergeBlend() { return constrain(tuning.COALESCE_PULL / MERGE_BLEND_FULL, 0, 1); }
const TENSION_SHARE = 0.5;        // tension may move a drop at most this * its own speed (bends paths, never captures)
const CORE_SLIDE = 1.0;           // share of two drops' push into each other that turns into sideways slip
const CROSS_TENSION = 0.5;        // tension between different waxes, relative to same-colour (interfacial tension is weaker)
const MAX_TENSION_SCALE = 2;      // cross-colour tension grows with attraction up to this * CROSS_TENSION

// ---- metaball rendering ----
// The field is calculated at the display's native resolution (600x1024 portrait).
const ATTR_MAX = 4;              // attraction slider max; the per-population sliders use this directly
const DISPLAY_SIZE_SCALE = 1.40; // existing base-size tuning
const BLOB_SIZE_MULTIPLIER = 1.15; // v19: scale every full blob radius by 15%
const FIELD_ISO = 0.20;
const FIELD_EDGE = 0.10;
const FIELD_RENDER_INTERVAL = 2; // update the expensive full-resolution field at 30Hz
// v22 colour blending: colour is weighted by a broader, linear falloff than the
// shape, so where populations merge their colours grade smoothly across the
// whole blob instead of meeting at a seam. Lightening grows smoothly with wax
// thickness (no plateau edge), and the coloured ring only shows near the outer
// edge, not where one drop's rim lies inside another's wax.
const CENTER_LIGHT_RATE = 1.1;   // how quickly thicker wax lightens toward CENTER_LIGHTEN
const RING_MIX = 0.18;
const RING_EDGE_SPAN = 0.35;     // ring fades out over this much field above FIELD_ISO

// 0 at/below MERGE_THRESHOLD (pure bounce), ramping to 1 at ATTR_MAX (full
// merge). Drives the repulsion shell, the hard separation floor, and the
// mergeAmount, so one number moves a population along bounce<->merge.
function mergeTFor(pop) {
  const attraction = effectiveInterAttractionFor(pop);
  const normalized = constrain(
    (attraction - MERGE_THRESHOLD) / (ATTR_MAX - MERGE_THRESHOLD),
    0,
    1
  );
  return Math.pow(normalized, MERGE_RESPONSE);
}

function effectiveInterAttractionFor(pop) {
  return attractionStrengthByPop[pop] * INTER_ATTRACTION_SCALE_BY_POP[pop];
}

function effectiveBlobSize() {
  return overallSize * DISPLAY_SIZE_SCALE * BLOB_SIZE_MULTIPLIER;
}

// ---- live params (sliders now; updateParamsFromSensor() later) ----
let overallSize = 65; // v7: 25% larger blobs
// per-population, indexed by pop. Attraction on a drop uses ITS OWN population's
// value, so pop 1 chasing pop 2 need not equal pop 2 chasing pop 1.
let attractionStrengthByPop = Array(POP_COUNT).fill(BASE_INTER_ATTRACTION);
let speedByPop = Array(POP_COUNT).fill(1.0);

let drops = [];
// Drops that just fused, still drawn while they fade out and the merged drop
// fades in, so a merge morphs instead of snapping (see fadeMerges()).
let fadingDrops = [];
let nextDropId = 1;
let itemStore = new Float32Array(0); // renderField(): each drawn drop's stamped field, reused between its passes
let individualsPerPop = [];
let popColors = [];              // fixed p5.Color per population (rim)
let popRgb = [];                 // the same colours as [r, g, b] for the field
let levelBuffer;                 // metaball field buffer
let fieldImageData;
let field = null;                // per-pixel accumulation buffers, see renderField()
let WHITE;

let noiseAccumByPop = Array(POP_COUNT).fill(0);  // advanced by each pop's speed -> wander time
let flowTime = 0;
let waxFrame = 0;
const waxEvents = { splits: 0, merges: 0 };
let sliderRefs = {};

function setup() {
  const holder = document.getElementById('canvas-holder');
  pixelDensity(1);
  const cnv = createCanvas(CANVAS_W, CANVAS_H);
  cnv.parent(holder);
  cnv.style('display', 'block');
  WHITE = color(255);
  popColors = POP_COLORS.map(hex => color(hex));
  popRgb = popColors.map(c => [red(c), green(c), blue(c)]);
  levelBuffer = createGraphics(CANVAS_W, CANVAS_H);
  levelBuffer.pixelDensity(1);
  fieldImageData = levelBuffer.drawingContext.createImageData(
    levelBuffer.canvas.width,
    levelBuffer.canvas.height
  );
  const n = levelBuffer.width * levelBuffer.height;
  // Per-pixel buffers for renderField(): the combined field and colour, and the
  // strongest and runner-up drop at each pixel.
  const buffer = () => new Float32Array(n);
  field = {
    value: buffer(), colorWeight: buffer(), red: buffer(), green: buffer(), blue: buffer(),
    topValue: buffer(), topIndex: new Int16Array(n), secondValue: buffer(), secondIndex: new Int16Array(n),
    ringWeight: buffer(), ringRed: buffer(), ringGreen: buffer(), ringBlue: buffer()
  };

  if (new URLSearchParams(location.search).has('tune')) buildTuningPanel(); // before initDrops: saved minimum size applies
  initDrops();

  console.log(
    `[orbmerge] ${POP_COUNT} populations x ${individualsPerPop.join('/')} = ${drops.length} wax drops, ` +
    `shared scalar field at ${levelBuffer.width}x${levelBuffer.height} (pixel density 1).`
  );
}

function initDrops() {
  drops = [];
  fadingDrops = [];
  mergeLinks.clear();
  individualsPerPop = Array.from(
    { length: POP_COUNT },
    () => floor(random(MIN_INDIVIDUALS_PER_POP, MAX_INDIVIDUALS_PER_POP + 1))
  );
  const cy = height / 2;
  for (let section = 0; section < WORLD_SCALE; section++) { // one screen's worth of wax per screen-width of world
    const cx = section * CANVAS_W + CANVAS_W / 2;
    for (let p = 0; p < POP_COUNT; p++) {
      // Each population starts loosely gathered around its own point, so the
      // first cross-population contact is a genuine approach (a merge event)
      // rather than everything spawning in one pile.
      const a = (p / POP_COUNT) * TWO_PI - HALF_PI;
      const gx = cx + Math.cos(a) * CANVAS_W * 0.38;
      const gy = cy + Math.sin(a) * height * 0.38;
      // Each colour holds WAX_PER_COLOUR minimum drops' worth of wax, shared
      // unevenly between its starting drops, none below the minimum.
      const total = WAX_PER_COLOUR * tuning.MIN_DROP_AREA;
      individualsPerPop[p] = Math.min(individualsPerPop[p], Math.floor(WAX_PER_COLOUR), tuning.MAX_DROPS_PER_COLOUR);
      const weights = Array.from({ length: individualsPerPop[p] }, () => random(0.2, 1));
      const weightSum = weights.reduce((sum, w) => sum + w, 0);
      const spare = total - individualsPerPop[p] * tuning.MIN_DROP_AREA;
      for (const w of weights) {
        const area = tuning.MIN_DROP_AREA + spare * w / weightSum;
        const edge = effectiveBlobSize() * Math.sqrt(area) * VISIBLE_EDGE; // start clear of the top and bottom
        drops.push(new Drop(
          wrapX(gx + random(-0.2, 0.2) * CANVAS_W),
          constrain(gy + random(-0.25, 0.25) * height, edge, height - edge),
          p,
          area));
      }
    }
  }
}

// STUB -- later WebSocket / sensor rig. Only the sensor-controllable params are
// reachable here (inter-population attractionStrength + speed, overallSize);
// the wax model and autonomous wander constants are intentionally out of reach.
// speeds / attractionStrengths are arrays indexed by population; undefined or
// missing entries are left untouched.
function updateParamsFromSensor(data) {
  if (data.overallSize !== undefined) setParam('overallSize', data.overallSize, (v) => { overallSize = v; });
  if (Array.isArray(data.speeds)) data.speeds.forEach((s, p) => {
    if (p < POP_COUNT && s !== undefined) setParam('speed' + p, s, (v) => { speedByPop[p] = v; });
  });
  if (Array.isArray(data.attractionStrengths)) data.attractionStrengths.forEach((a, p) => {
    if (p < POP_COUNT && a !== undefined) setParam('attract' + p, a, (v) => { attractionStrengthByPop[p] = v; });
  });

}

function setParam(key, value, assign) {
  const ref = sliderRefs[key];
  const v = ref ? constrain(value, ref.min, ref.max) : value;
  assign(v);
  if (ref) { ref.slider.value(v); ref.valSpan.html(String(v)); }
}

function draw() {
  window.harveyAmbientV1?.update();
  background('#2F302F');
  stepWax();
  if (frameCount % FIELD_RENDER_INTERVAL === 0) {
    renderField();
  } else {
    image(levelBuffer, 0, 0, width, height);
  }
}

// One physics frame. Also driven without rendering by window.harveyWax.simulate().
function stepWax() {
  waxFrame++;
  for (let p = 0; p < POP_COUNT; p++) {
    noiseAccumByPop[p] += NOISE_BASE * speedByPop[p];
  }
  flowTime += FLOW_TIME_STEP;

  // --- AUTONOMOUS: each drop on its own seed, on its population's clock ---
  for (const d of drops) d.wander(noiseAccumByPop[d.pop]);
  for (const d of drops) d.heat();

  // --- INTER-POPULATION: local collision attraction and merge proximity ---
  for (const d of drops) d.applyCrossPopulationForces(drops);

  keepColoursOnScreen();
  for (const d of drops) d.update();

  // --- WAX: stretch and relax, coalesce on contact, pinch off when stretched ---
  for (const d of drops) d.deform();
  updateMergeLinks();
  coalesceDrops();
  fadeMerges();
  splitDrops();

  resolveZeroAttractionSeparation(drops);
  for (const d of drops) d.keepInside();
}

function resolveZeroAttractionSeparation(all) {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.pop === b.pop) continue;
      const pairAttraction = Math.min(
        effectiveInterAttractionFor(a.pop),
        effectiveInterAttractionFor(b.pop)
      );
      if (pairAttraction > 0) continue;

      let dx = wrapDx(b.pos.x - a.pos.x);
      let dy = b.pos.y - a.pos.y;
      let d = Math.hypot(dx, dy);
      const minDistance = (a.visualRadius() + b.visualRadius()) * ZERO_ATTRACTION_SEPARATION;
      if (d >= minDistance) continue;
      if (d < 1e-4) { dx = 1; dy = 0; d = 1e-4; }
      const push = (minDistance - d) / 2;
      const ux = dx / d, uy = dy / d;
      a.pos.x -= ux * push;
      a.pos.y -= uy * push;
      b.pos.x += ux * push;
      b.pos.y += uy * push;
    }
  }
}

// Background flow: smooth in space and slowly changing, zero-mean per axis.
// Only DIFFERENCES across a drop are used, so it stretches and turns drops
// without carrying them (their transport is still wander()).
// The lamp wraps around left/right, so the flow is blended into a seamless loop in x.
function flowAt(x, y) {
  x = wrapX(x);
  const sample = x0 => {
    const sx = x0 * FLOW_SCALE, sy = y * FLOW_SCALE;
    return [
      noise(sx, sy, flowTime) - noise(sx + 31.7, sy + 47.3, flowTime),
      noise(sx + 71.1, sy + 13.9, flowTime) - noise(sx + 97.5, sy + 59.1, flowTime)
    ];
  };
  const t = x / WORLD_W, [ax, ay] = sample(x), [bx, by] = sample(x + WORLD_W);
  return [ax * (1 - t) + bx * t, ay * (1 - t) + by * t];
}

// ---- the world loops sideways (WORLD_W), walls only top and bottom ----
function wrapX(x) {
  return ((x % WORLD_W) + WORLD_W) % WORLD_W;
}

// Shortest horizontal offset from one point to another, around the loop.
function wrapDx(dx) {
  return dx - WORLD_W * Math.round(dx / WORLD_W);
}

// Contact between any two drops, of the same or different colours. Drops move
// only by their own motion unless the merge pull (default 0) draws touching
// drops together; rounding shapes each drop in deform() and never pulls drops.
// Different colours keep their own wax (a small core stops them collapsing onto
// one point), so the flow and buoyancy can pinch them apart again; their tension
// follows the portable-controlled attraction (1x at the baseline, none at 0,
// where the bounce in applyCrossPopulationForces() takes over). Same-colour
// drops, once the film between them has drained, fuse into one drop whose lobes
// start exactly where the two drops were, then round up as tension relaxes it.
function coalesceDrops() {
  const fused = new Set();
  const added = [];
  for (const d of drops) { d.tension.set(0, 0); d.contactPush.set(0, 0); }
  for (let i = 0; i < drops.length; i++) {
    for (let j = i + 1; j < drops.length; j++) {
      const a = drops[i], b = drops[j];
      if (fused.has(a) || fused.has(b)) continue;
      const sameWax = a.pop === b.pop;
      if (sameWax && (a.sibling === b || b.sibling === a) && waxFrame < Math.max(a.siblingUntil, b.siblingUntil)) continue;
      let scale = 1;
      if (!sameWax) {
        const pairAttraction = Math.min(effectiveInterAttractionFor(a.pop), effectiveInterAttractionFor(b.pop));
        if (pairAttraction <= 0) continue;
        scale = CROSS_TENSION * Math.min(pairAttraction / BASE_INTER_ATTRACTION, MAX_TENSION_SCALE);
      }
      const reach = a.visualRadius() + b.visualRadius();
      let dx = wrapDx(b.pos.x - a.pos.x), dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy) || 1e-4;
      // Different colours merge only through an active merge link (see
      // updateMergeLinks()); otherwise they bounce off each other where their
      // visible outlines meet, like off the top and bottom.
      if (!sameWax && !isLinked(a, b)) {
        keepColoursApart(a, b, dx / d, dy / d, d, reach);
        continue;
      }
      if (d >= reach * CONTACT_REACH) { a.contact.delete(b); continue; }

      const total = a.area + b.area;
      const canFuse = sameWax && total <= maxDropArea();
      const core = reach * MERGE_CORE_FACTOR;
      // Both pulls fade as the neck thins toward the contact edge, so a pair
      // drifting or rising apart fast enough pinches off instead of being held forever.
      const neck = 1 - d / (reach * CONTACT_REACH);
      // Only the merge pull steers drops toward each other; rounding (TENSION_RELAX)
      // shapes each drop in deform() and never moves drops together.
      const move = tuning.COALESCE_PULL * neck * scale;
      const ux = dx / d, uy = dy / d;
      a.tension.x += ux * move * b.area / total; a.tension.y += uy * move * b.area / total;
      b.tension.x -= ux * move * a.area / total; b.tension.y -= uy * move * a.area / total;
      if (!canFuse && d < core) { // each drop is pushed out of the core
        const push = 2 * REPULSION_MERGE * (1 - d / core);
        a.contactPush.x -= ux * push * b.area / total; a.contactPush.y -= uy * push * b.area / total;
        b.contactPush.x += ux * push * a.area / total; b.contactPush.y += uy * push * a.area / total;
      }
      // Drops pushing into each other slide around each other instead of
      // deadlocking head-on: the motion that is blocked turns sideways, so both
      // carry on in their own directions.
      const pushing = a.heading(ux, uy) + b.heading(-ux, -uy);
      if (!canFuse && pushing > 0) {
        const px = -uy, py = ux; // perpendicular to the line between them
        const lateral = (a.ownVel.x - b.ownVel.x) * px + (a.ownVel.y - b.ownVel.y) * py;
        const side = Math.abs(lateral) > 1e-3 ? Math.sign(lateral) : (a.noiseSeed < b.noiseSeed ? 1 : -1);
        const slide = CORE_SLIDE * pushing * side;
        a.contactPush.x += px * slide * b.area / total; a.contactPush.y += py * slide * b.area / total;
        b.contactPush.x -= px * slide * a.area / total; b.contactPush.y -= py * slide * a.area / total;
      }
      if (!canFuse) continue;

      // The film between them only drains while they are not moving apart:
      // drops that brush past each other keep their own way instead of fusing.
      const closing = a.heading(ux, uy) + b.heading(-ux, -uy);
      const frames = closing < -SEPARATING_SPEED ? 0 : (a.contact.get(b) || 0) + 1;
      a.contact.set(b, frames);
      const round = a.sep <= ROUND_TO_FUSE * a.pinchSeparation() && b.sep <= ROUND_TO_FUSE * b.pinchSeparation();
      if (frames < DRAIN_FRAMES || d > reach * FUSE_REACH || !round) continue;

      const bx = a.pos.x + dx; // b as seen from a, across the seam if that is shorter
      const merged = new Drop(wrapX((a.pos.x * a.area + bx * b.area) / total), (a.pos.y * a.area + b.pos.y * b.area) / total, a.pop, total, {
        axis: Math.atan2(b.pos.y - a.pos.y, dx),
        sep: Math.hypot(dx, b.pos.y - a.pos.y),
        frac: a.area / total,
        lobeT: 1,
        noiseSeed: a.area >= b.area ? a.noiseSeed : b.noiseSeed,
        // each half keeps the outline wave its drop showed most of
        shapeSeeds: [a.dominantShapeSeed(), b.dominantShapeSeed()],
        temp: (a.temp * a.area + b.temp * b.area) / total,
        buoyVel: (a.buoyVel * a.area + b.buoyVel * b.area) / total,
        vel: createVector((a.vel.x * a.area + b.vel.x * b.area) / total, (a.vel.y * a.area + b.vel.y * b.area) / total)
      });
      merged.fade = 0;
      inheritLinks([a, b], merged);
      for (const source of [a, b]) {
        fadingDrops.push({ drop: source, into: merged, life: source.fade,
          offsetX: wrapDx(source.pos.x - merged.pos.x), offsetY: source.pos.y - merged.pos.y });
      }
      fused.add(a); fused.add(b); added.push(merged);
      waxEvents.merges++;
    }
  }
  // A drop's own motion (wander, convection, buoyancy) is never held back:
  // whatever tension adds up to from all its neighbours, any part pushing
  // against the drop's own direction is dropped, and the rest is capped at
  // TENSION_SHARE of the drop's own speed, so tension bends a path but never
  // captures a drop. The core cushion and sideways slip act on top.
  for (const d of drops) {
    const speed = d.ownVel.mag();
    if (speed > 1e-6) {
      const against = (d.tension.x * d.ownVel.x + d.tension.y * d.ownVel.y) / speed;
      if (against < 0) { d.tension.x -= against * d.ownVel.x / speed; d.tension.y -= against * d.ownVel.y / speed; }
    }
    d.tension.limit(TENSION_SHARE * speed);
    d.move(d.ownVel.x + d.collisionForce.x + d.tension.x + d.contactPush.x,
           d.ownVel.y + d.collisionForce.y + d.tension.y + d.contactPush.y);
  }
  if (fused.size) drops = drops.filter(d => !fused.has(d)).concat(added);
}

// ---- every colour stays on screen ----
// The world is wider than the canvas, so a colour could drift entirely out of
// view. A colour's last drop on screen is gently held in as it nears the edge,
// and a colour with no drop on screen has its nearest drop drift in. The pull is
// part of the drop's own motion, so it eases in and out with momentum.
function onScreenOffset(d) {
  return wrapDx(d.pos.x - VIEW_X - CANVAS_W / 2); // world x relative to the middle of the screen
}

function keepColoursOnScreen() {
  for (const d of drops) d.presencePull = 0;
  for (let p = 0; p < POP_COUNT; p++) {
    const own = drops.filter(d => d.pop === p);
    if (!own.length) continue;
    const inside = d => Math.abs(onScreenOffset(d)) < CANVAS_W / 2; // centre on screen
    const showing = own.filter(inside);
    if (showing.length > 1) continue;
    if (showing.length === 1) {
      // The last one on screen: hold it in as its centre nears the edge.
      const d = showing[0], offset = onScreenOffset(d);
      const margin = d.visualRadius() * VISIBLE_EDGE;
      const nearEdge = constrain((Math.abs(offset) - (CANVAS_W / 2 - margin)) / margin, 0, 1);
      d.presencePull = -Math.sign(offset) * PRESENCE_PULL * nearEdge * nearEdge;
    } else {
      // None on screen: the nearest drifts in.
      const nearest = own.reduce((a, b) => Math.abs(onScreenOffset(a)) <= Math.abs(onScreenOffset(b)) ? a : b);
      nearest.presencePull = -Math.sign(onScreenOffset(nearest)) * PRESENCE_PULL;
    }
  }
}

// ---- merge links between different colours ----
// A pair of different colours merges only while linked. Links form on contact
// when colour attraction is above 0 and the resulting group of linked drops stays
// within MAX_MERGE_GROUP; a link lets go after MAX_MERGE_SECONDS, and the pair
// cannot relink until it has separated. Each link's `amount` ramps in and out
// over MERGE_RAMP_FRAMES, and the renderer blends the pair by it.
const mergeLinks = new Map(); // pairKey -> { a, b, amount, frames, active, expired }

function pairKey(a, b) {
  return a.id < b.id ? a.id * 1e6 + b.id : b.id * 1e6 + a.id;
}

function isLinked(a, b) {
  const link = mergeLinks.get(pairKey(a, b));
  return !!link && link.active;
}

// How merged two drops are drawn: same colour always fully, different colours by their link.
function linkAmount(a, b) {
  if (a.pop === b.pop) return 1;
  const link = mergeLinks.get(pairKey(a, b));
  return link ? link.amount : 0;
}

function updateMergeLinks() {
  const target = mergeBlend();
  const maxFrames = tuning.MAX_MERGE_SECONDS * 60;
  // Different-colour pairs in contact this frame, where the portable allows merging.
  const touching = new Map();
  if (target > 0) {
    for (let i = 0; i < drops.length; i++) {
      for (let j = i + 1; j < drops.length; j++) {
        const a = drops[i], b = drops[j];
        if (a.pop === b.pop || Math.min(effectiveInterAttractionFor(a.pop), effectiveInterAttractionFor(b.pop)) <= 0) continue;
        const d = Math.hypot(wrapDx(b.pos.x - a.pos.x), b.pos.y - a.pos.y);
        if (d < (a.visualRadius() + b.visualRadius()) * CONTACT_REACH) touching.set(pairKey(a, b), { a, b, d });
      }
    }
  }
  // Age links; they let go when apart, or when their time is up (then stay blocked while still touching).
  for (const [key, link] of mergeLinks) {
    if (!touching.has(key)) { link.active = false; link.expired = false; }
    else if (link.active && ++link.frames > maxFrames) { link.active = false; link.expired = true; }
  }
  // Groups of drops joined by active links, so a new link never makes a group too big.
  const parent = new Map(drops.map(d => [d, d])), size = new Map(drops.map(d => [d, 1]));
  const root = d => { while (parent.get(d) !== d) d = parent.get(d); return d; };
  const join = (a, b) => { const ra = root(a), rb = root(b); if (ra === rb) return; parent.set(rb, ra); size.set(ra, size.get(ra) + size.get(rb)); };
  // Existing links, oldest first, while groups stay within the cap; a split can hand one drop's
  // links to both pieces, so any link that would overfill its group lets go (newest first).
  const existing = [...mergeLinks.values()].filter(link => link.active && parent.has(link.a) && parent.has(link.b))
    .sort((x, y) => y.frames - x.frames);
  for (const link of existing) {
    const ra = root(link.a), rb = root(link.b);
    if (ra !== rb && size.get(ra) + size.get(rb) > tuning.MAX_MERGE_GROUP) { link.active = false; link.expired = true; continue; }
    join(link.a, link.b);
  }
  const candidates = [...touching.entries()].filter(([key]) => { const link = mergeLinks.get(key); return !link || (!link.active && !link.expired); })
    .sort((x, y) => x[1].d - y[1].d);
  for (const [key, { a, b }] of candidates) {
    const ra = root(a), rb = root(b);
    if (ra !== rb && size.get(ra) + size.get(rb) > tuning.MAX_MERGE_GROUP) continue;
    const link = mergeLinks.get(key) || { a, b, amount: 0, frames: 0 };
    Object.assign(link, { active: true, expired: false, frames: 0 });
    mergeLinks.set(key, link);
    join(a, b);
  }
  // Ramp each link's drawn amount, and forget links that are finished or whose drops are gone.
  const alive = new Set([...drops, ...fadingDrops.map(f => f.drop)]);
  const step = 1 / MERGE_RAMP_FRAMES;
  for (const [key, link] of mergeLinks) {
    link.amount = link.active ? Math.min(target, link.amount + step) : Math.max(0, link.amount - step);
    if (!alive.has(link.a) || !alive.has(link.b) || (link.amount === 0 && !link.active && !link.expired)) mergeLinks.delete(key);
  }
}

// A drop made by fusing or splitting carries on the merge links of the drops it came from.
function inheritLinks(sources, target) {
  for (const link of [...mergeLinks.values()]) {
    const fromA = sources.includes(link.a), fromB = sources.includes(link.b);
    if (fromA === fromB) continue;
    const other = fromA ? link.b : link.a;
    const key = pairKey(target, other), existing = mergeLinks.get(key);
    if (!existing || existing.amount < link.amount) {
      mergeLinks.set(key, { a: target, b: other, amount: link.amount, frames: link.frames, active: link.active, expired: link.expired });
    }
  }
}

// Different colours that may not merge treat each other like the canvas's top
// and bottom: where their visible outlines meet they are eased apart (no
// springing back and forth through momentum) and bounce off -- the velocity
// heading into each other is reversed and softened, shared by size. Shapes are
// never forced: each drop keeps its own slowly morphing outline, and the
// boundary where two colours press together flattens on its own.
function keepColoursApart(a, b, ux, uy, d, reach) {
  const contact = VISIBLE_EDGE * reach; // visible outlines just touch
  if (d >= contact) return;
  const total = a.area + b.area;
  const ease = Math.min((contact - d) * CONTACT_STIFFNESS, MAX_CONTACT_PUSH); // separate over a few frames, never jump
  a.pos.x -= ux * ease * b.area / total; a.pos.y -= uy * ease * b.area / total;
  b.pos.x += ux * ease * a.area / total; b.pos.y += uy * ease * a.area / total;
  const closing = (a.vel.x - b.vel.x) * ux + (a.vel.y - b.vel.y) * uy; // > 0: moving into each other
  if (closing <= 0) return;
  // A real impact bounces; a slow press (resting together) just stops, like a drop resting on the floor.
  const restitution = closing > BOUNCE_MIN_SPEED ? BOUNCE_RESTITUTION : 0;
  const impulse = (1 + restitution) * closing; // bigger drops are pushed less
  a.vel.x -= ux * impulse * b.area / total; a.vel.y -= uy * impulse * b.area / total;
  b.vel.x += ux * impulse * a.area / total; b.vel.y += uy * impulse * a.area / total;
}

// Cross-fade after a merge: the two original drops ride along with the merged
// drop (keeping their place relative to it) while fading out, and the merged drop
// fades in. The wax field adds up linearly, so the outline morphs smoothly
// from the two drops to the merged one instead of changing shape in one frame.
function fadeMerges() {
  const step = 1 / MERGE_FADE_FRAMES;
  for (const d of drops) if (d.fade < 1) d.fade = Math.min(1, d.fade + step);
  for (const f of fadingDrops) {
    f.life -= step;
    f.drop.pos.set(wrapX(f.into.pos.x + f.offsetX), f.into.pos.y + f.offsetY);
  }
  fadingDrops = fadingDrops.filter(f => f.life > 0);
}

// A drop stretched to its pinch point splits at its lobes. Each child carries
// exactly its lobe's wax and is drawn the same size the lobe was, so the
// pinch-off is continuous; the siblings drift apart and may not re-fuse at once.
function splitDrops() {
  const next = [];
  const count = Array(POP_COUNT).fill(0);
  for (const d of drops) count[d.pop]++;
  for (const d of drops) {
    const tooSmall = Math.min(d.frac, 1 - d.frac) * d.area < tuning.MIN_DROP_AREA;
    if (d.sep < d.pinchSeparation() || d.lobeT < 0.97 || tooSmall || count[d.pop] >= maxDropsPerColour()) { next.push(d); continue; }
    const [l1, l2] = d.lobes();
    const ax = Math.cos(d.axis), ay = Math.sin(d.axis);
    // each child keeps the outline wave of the half it came from
    const a = new Drop(l1.x, l1.y, d.pop, d.area * d.frac, { noiseSeed: d.noiseSeed, temp: d.temp, buoyVel: d.buoyVel, vel: d.vel.copy(), shapeSeeds: [d.shapeSeeds[0], d.shapeSeeds[0]] });
    const b = new Drop(l2.x, l2.y, d.pop, d.area * (1 - d.frac), { temp: d.temp, buoyVel: d.buoyVel, vel: d.vel.copy(), shapeSeeds: [d.shapeSeeds[1], d.shapeSeeds[1]] });
    a.drift.set(-ax * SPLIT_KICK, -ay * SPLIT_KICK);
    b.drift.set(ax * SPLIT_KICK, ay * SPLIT_KICK);
    a.fade = b.fade = d.fade; // a split during a merge's cross-fade carries on fading in
    inheritLinks([d], a); inheritLinks([d], b);
    a.sibling = b; b.sibling = a;
    a.siblingUntil = b.siblingUntil = waxFrame + SIBLING_COOLDOWN;
    next.push(a, b);
    count[d.pop]++;
    waxEvents.splits++;
  }
  drops = next;
}

// Evaluate the wax field drop by drop. Each drop (its lobes and their wall
// reflections) is stamped once into its own store over its bounding box, so the
// cost follows the wax area on screen. Pass 1 finds the strongest drop at each
// pixel (and the runner-up); pass 2 lets every other drop add to that pixel only
// as much as it is merged with the strongest one: same colour fully, different
// colours by their merge link (linkAmount()). Unmerged drops therefore keep their
// own outlines and meet at a clean boundary; merged ones fuse and grade into each other.
function renderField() {
  const w = levelBuffer.width;
  const h = levelBuffer.height;
  const F = field;
  for (const buffer of [F.value, F.colorWeight, F.red, F.green, F.blue, F.topValue, F.secondValue,
    F.ringWeight, F.ringRed, F.ringGreen, F.ringBlue]) buffer.fill(0);
  F.topIndex.fill(-1);
  F.secondIndex.fill(-1);

  // Everything drawn this frame: drops (fading in after a merge) and fused drops fading out.
  const items = [];
  const addItem = (d, strength) => {
    // Lobes always stamp; coincident ones add up exactly to one round drop, so
    // there is no switch between drawing modes (which made centres flicker).
    const [k1, k2] = d.lobeRadii(), [a1, a2] = d.lobeAmounts();
    const [l1, l2] = d.lobes(), [s1, s2] = d.lobeShapes();
    // World -> screen x (nearest copy around the loop); lobes out of view are skipped.
    const lobes = [
      { x: wrapDx(l1.x - VIEW_X - w / 2) + w / 2, y: l1.y, k: k1, amount: a1 * strength, shape: s1 },
      { x: wrapDx(l2.x - VIEW_X - w / 2) + w / 2, y: l2.y, k: k2, amount: a2 * strength, shape: s2 }
    ].filter(l => l.amount > 0 && l.x + l.k * 1.5 > 0 && l.x - l.k * 1.5 < w);
    if (!lobes.length) return;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (const l of lobes) {
      const reach = l.k * (1 + l.shape.maxWave);
      minX = Math.min(minX, Math.floor(l.x - reach)); maxX = Math.max(maxX, Math.ceil(l.x + reach));
      minY = Math.min(minY, Math.floor(l.y - reach)); maxY = Math.max(maxY, Math.ceil(l.y + reach));
    }
    items.push({ d, rgb: popRgb[d.pop], lobes,
      minX: Math.max(0, minX), maxX: Math.min(w - 1, maxX), minY: Math.max(0, minY), maxY: Math.min(h - 1, maxY) });
  };
  for (const d of drops) addItem(d, d.fade);
  for (const f of fadingDrops) addItem(f.drop, f.life);

  const n = items.length;
  const merged = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) merged[i * n + j] = i === j ? 1 : linkAmount(items[i].d, items[j].d);

  // Each drop is stamped once; its field, colour weight and ring over its bounding
  // box are kept in itemStore so pass 2 can reuse them.
  let needed = 0;
  for (const item of items) {
    item.width = item.maxX - item.minX + 1;
    item.area = item.width * (item.maxY - item.minY + 1);
    item.offset = needed;
    needed += item.area * 3;
  }
  if (itemStore.length < needed) itemStore = new Float32Array(Math.ceil(needed * 1.25));
  const store = itemStore;

  // Pass 1: stamp each drop into its own store, and find the strongest drop at each pixel (and the runner-up).
  const { topValue, topIndex, secondValue, secondIndex } = F;
  items.forEach((item, j) => {
    store.fill(0, item.offset, item.offset + item.area * 3);
    for (const l of item.lobes) stampWithWalls(l.x, l.y, l.k, l.amount, l.shape, h, item);
    let k = item.offset;
    for (let y = item.minY; y <= item.maxY; y++) {
      for (let i = y * w + item.minX, end = y * w + item.maxX; i <= end; i++, k++) {
        const f = store[k];
        if (f <= 0) continue;
        if (f > topValue[i]) { secondValue[i] = topValue[i]; secondIndex[i] = topIndex[i]; topValue[i] = f; topIndex[i] = j; }
        else if (f > secondValue[i]) { secondValue[i] = f; secondIndex[i] = j; }
      }
    }
  });

  // Pass 2: each drop adds in proportion to how merged it is with the strongest drop there.
  const { value, colorWeight, red, green, blue, ringWeight, ringRed, ringGreen, ringBlue } = F;
  items.forEach((item, j) => {
    const [r, g, b] = item.rgb;
    let k = item.offset;
    const colorAt = item.area, ringAt = 2 * item.area;
    for (let y = item.minY; y <= item.maxY; y++) {
      for (let i = y * w + item.minX, end = y * w + item.maxX; i <= end; i++, k++) {
        const f = store[k];
        if (f <= 0) continue;
        const top = topIndex[i];
        const m = top === j ? 1 : merged[top * n + j];
        if (m <= 0) continue;
        value[i] += f * m;
        const c = store[k + colorAt] * m;
        colorWeight[i] += c; red[i] += r * c; green[i] += g * c; blue[i] += b * c;
        const ring = store[k + ringAt] * m;
        if (ring > 0) { ringWeight[i] += ring; ringRed[i] += r * ring; ringGreen[i] += g * ring; ringBlue[i] += b * ring; }
      }
    }
  });

  const pixels = fieldImageData.data;
  for (let i = 0, count = w * h; i < count; i++) {
    const v = value[i];
    const index = i * 4;
    const edgePosition = (v - (FIELD_ISO - FIELD_EDGE)) / (FIELD_EDGE * 2);
    if (edgePosition <= 0) { pixels[index + 3] = 0; continue; }
    const t = edgePosition >= 1 ? 1 : edgePosition;
    const alpha = t * t * (3 - 2 * t);
    const centerLight = v > FIELD_ISO ? CENTER_LIGHTEN * (1 - Math.exp(-(v - FIELD_ISO) * CENTER_LIGHT_RATE)) : 0;
    const inv = 1 / colorWeight[i];
    let blendedRed = red[i] * inv, blendedGreen = green[i] * inv, blendedBlue = blue[i] * inv;
    // Where an unmerged drop is nearly as strong, soften the boundary between them.
    const second = secondIndex[i];
    if (second >= 0) {
      const apart = 1 - merged[topIndex[i] * n + second];
      const share = (secondValue[i] / topValue[i] - (1 - BOUNDARY_SOFTNESS)) / BOUNDARY_SOFTNESS; // 0..1 approaching an even split
      if (apart > 0 && share > 0) {
        const mix = 0.5 * share * share * (3 - 2 * share) * apart, other = items[second].rgb;
        blendedRed += (other[0] - blendedRed) * mix; blendedGreen += (other[1] - blendedGreen) * mix; blendedBlue += (other[2] - blendedBlue) * mix;
      }
    }
    const ring = ringWeight[i];
    const nearEdge = 1 - (v - FIELD_ISO) / RING_EDGE_SPAN;
    if (ring > 0 && nearEdge > 0) {
      const ringMix = RING_MIX * Math.min(nearEdge, 1) * Math.min(ring / v, 1);
      blendedRed += (ringRed[i] / ring - blendedRed) * ringMix;
      blendedGreen += (ringGreen[i] / ring - blendedGreen) * ringMix;
      blendedBlue += (ringBlue[i] / ring - blendedBlue) * ringMix;
    }
    pixels[index] = blendedRed + (255 - blendedRed) * centerLight;
    pixels[index + 1] = blendedGreen + (255 - blendedGreen) * centerLight;
    pixels[index + 2] = blendedBlue + (255 - blendedBlue) * centerLight;
    pixels[index + 3] = alpha * 255;
  }

  levelBuffer.drawingContext.putImageData(fieldImageData, 0, 0);
  image(levelBuffer, 0, 0, width, height);
}

// Near the top and bottom a reflected kernel slightly deforms the drop instead
// of leaving a perfect clipped circle; at the left/right edges the drop simply
// continues out of view (the world is wider than the canvas).
function stampWithWalls(x, y, radius, amount, shape, h, item) {
  stamp(x, y, radius, shape, amount, true, item);
  // Reflection of the outline wave in the floor/ceiling: theta -> -theta.
  if (y < radius * 1.2 || y > h - radius * 1.2) {
    const end = { ...shape, s2: -shape.s2, s3: -shape.s3 };
    stamp(x, y < h / 2 ? -y : 2 * h - y, radius, end, amount * WALL_MIRROR_FACTOR, false, item);
  }
}

// One kernel, stamped into a drawn drop's store (field, colour weight, ring over
// its bounding box; see renderField()), whose edge radius varies around
// it: radius * (1 + wave(theta)), where wave = c2 cos 2θ + s2 sin 2θ + c3 cos 3θ
// + s3 sin 3θ. The 2-fold part stretches, the 3-fold part makes lopsided,
// pebble-like corners and flatter sides.
function stamp(cx, cy, radius, shape, factor, withRing, item) {
  const store = itemStore, colorAt = item.area, ringAt = 2 * item.area;
  const reach = radius * (1 + shape.maxWave);
  const minX = Math.max(item.minX, Math.floor(cx - reach)), maxX = Math.min(item.maxX, Math.ceil(cx + reach));
  const minY = Math.max(item.minY, Math.floor(cy - reach)), maxY = Math.min(item.maxY, Math.ceil(cy + reach));
  if (minX > maxX || minY > maxY) return;
  const invRadiusSquared = 1 / (radius * radius);
  const { c2, s2, c3, s3 } = shape;
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy;
    const row = item.offset + (y - item.minY) * item.width - item.minX;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= reach * reach) continue;
      const inv = distanceSquared > 1e-6 ? 1 / Math.sqrt(distanceSquared) : 0;
      const cos1 = dx * inv, sin1 = dy * inv;
      const cos2 = cos1 * cos1 - sin1 * sin1, sin2 = 2 * sin1 * cos1;
      const cos3 = cos2 * cos1 - sin2 * sin1, sin3 = sin2 * cos1 + cos2 * sin1;
      const edge = 1 + c2 * cos2 + s2 * sin2 + c3 * cos3 + s3 * sin3;
      const normalizedDistanceSquared = distanceSquared * invRadiusSquared / (edge * edge);
      if (normalizedDistanceSquared >= 1) continue;
      const falloff = 1 - normalizedDistanceSquared;
      const influence = factor * falloff * falloff;
      const k = row + x;
      store[k] += influence;
      store[k + colorAt] += factor * falloff;
      if (withRing && normalizedDistanceSquared > 0.42) store[k + ringAt] += influence * Math.min((normalizedDistanceSquared - 0.42) / 0.58, 1);
    }
  }
}

// HARD floor on different-population spacing -- the guarantee that a weak pair
// BOUNCES rather than merges. Each population's floor is BOUNCE_SEPARATION *
// overallSize scaled by (1 - mergeT), so a pop at attraction 0 keeps a gap wide
// enough that its metaball fields never fuse, and a pop near ATTR_MAX has no
// floor at all. For a mixed pair the WIDER floor wins -- if either side refuses
// to merge, the pair bounces. A couple of relaxation passes keep 3-population
// pile-ups from jittering. Runs after update(), so it also re-clamps to canvas.
function resolveCrossPopulationSeparation(all) {
  const sepByPop = [];
  for (let p = 0; p < POP_COUNT; p++) {
    sepByPop[p] = effectiveBlobSize() * BOUNCE_SEPARATION * (1 - mergeTFor(p));
  }
  for (let it = 0; it < SEPARATION_ITERS; it++) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.pop === b.pop) continue;
        const minSep = Math.max(sepByPop[a.pop], sepByPop[b.pop]);
        if (minSep <= 0) continue;
        let dx = wrapDx(b.pos.x - a.pos.x), dy = b.pos.y - a.pos.y;
        let d = Math.hypot(dx, dy);
        if (d >= minSep) continue;
        if (d < 1e-4) { dx = 1; dy = 0; d = 1e-4; }
        const push = (minSep - d) / 2;
        const ux = dx / d, uy = dy / d;
        a.pos.x -= ux * push; a.pos.y -= uy * push;
        b.pos.x += ux * push; b.pos.y += uy * push;
      }
    }
  }
  for (const d of all) d.keepInside();
}

class Drop {
  // area is relative to a base blob; axis/sep/frac describe the two lobes:
  // lobe 1 holds `frac` of the wax, and the area-weighted lobe centre is pos.
  constructor(x, y, pop, area, { axis = random(TWO_PI), sep = 0, frac = random(0.35, 0.65), lobeT = 0, noiseSeed = random(1000),
    temp = random(), buoyVel = 0, vel = createVector(0, 0), shapeSeeds = [random(1000), random(1000)] } = {}) {
    this.pos = createVector(x, y);
    this.pop = pop;
    this.area = area;
    this.axis = axis;
    this.sep = sep;
    this.frac = frac;
    this.lobeT = lobeT;  // 0 = drawn as one round drop, 1 = drawn as its two future children
    this.autoVel = createVector(0, 0);
    this.collisionForce = createVector(0, 0);
    this.drift = createVector(0, 0);
    this.ownVel = createVector(0, 0); // wander + convection + buoyancy + split kick, set each frame
    this.vel = vel;                   // actual velocity, easing toward everything acting on the drop (move())
    this.presencePull = 0;            // px/frame sideways, keeping its colour on screen (keepColoursOnScreen())
    this.id = nextDropId++;           // identifies merge links (mergeLinks)
    this.fade = 1;                    // drawn strength; a freshly merged drop fades in (fadeMerges())
    this.tension = createVector(0, 0); // this frame's surface-tension displacement, see coalesceDrops()
    this.contactPush = createVector(0, 0); // this frame's core cushion and sideways slip
    this.mergeAmount = 0;
    this.contact = new Map();
    this.sibling = null;
    this.siblingUntil = 0;
    // per-drop seed so wander paths never fall into sync across a population.
    this.noiseSeed = noiseSeed;
    this.shapeSeeds = shapeSeeds; // per-lobe outline wave, carried through merges and splits
    this.temp = temp;        // 0 cold (sinks) .. 1 hot (rises)
    this.buoyVel = buoyVel;  // px/frame, negative = rising
    this.heatRate = random(0.75, 1.25); // drops warm unevenly, so they don't cycle in sync
    this.splitPoint = random(0.3, 0.7);  // where this drop's wax tends to divide if it splits
  }

  visualRadius() {
    return effectiveBlobSize() * Math.sqrt(this.area);
  }

  // Lobe kernels: unstretched, each lobe is the whole drop's kernel carrying its
  // share of the wax, so together they are exactly one round drop; fully
  // stretched, each is exactly the drop it will split into.
  lobeRadii() {
    const radius = this.visualRadius();
    return [
      lerp(radius, radius * Math.sqrt(this.frac), this.lobeT),
      lerp(radius, radius * Math.sqrt(1 - this.frac), this.lobeT)
    ];
  }

  // Each lobe's outline is a slowly morphing wave of 2-fold and 3-fold bumps,
  // so even a lone drop keeps changing between pebble-like, unevenly rounded shapes.
  lobeShapes() {
    const t = waxFrame * SHAPE_DRIFT;
    return [0, 1].map(k => {
      const seed = this.shapeSeeds[k];
      const wave = (fold, maxAmplitude, offset) => {
        const amplitude = tuning.SHAPE_IRREGULARITY * maxAmplitude * (0.35 + 0.65 * noise(seed + offset, t));
        const phase = noise(seed + offset + 17, t * 0.7) * TWO_PI * 3;
        return [amplitude * Math.cos(phase), amplitude * Math.sin(phase), amplitude];
      };
      const [c2, s2, a2] = wave(2, WAVE_2_AMPLITUDE, 401), [c3, s3, a3] = wave(3, WAVE_3_AMPLITUDE, 733);
      return { c2, s2, c3, s3, maxWave: a2 + a3 };
    });
  }

  // The outline wave this drop shows most of (the lobe carrying more wax).
  dominantShapeSeed() {
    return this.shapeSeeds[this.frac >= 0.5 ? 0 : 1];
  }

  lobeAmounts() {
    return [lerp(this.frac, 1, this.lobeT), lerp(1 - this.frac, 1, this.lobeT)];
  }

  lobes() {
    const ax = Math.cos(this.axis), ay = Math.sin(this.axis);
    const back = this.sep * (1 - this.frac), forward = this.sep * this.frac;
    return [
      { x: this.pos.x - ax * back, y: this.pos.y - ay * back },
      { x: this.pos.x + ax * forward, y: this.pos.y + ay * forward }
    ];
  }

  pinchSeparation() {
    return SPLIT_SEPARATION * this.visualRadius() * (Math.sqrt(this.frac) + Math.sqrt(1 - this.frac));
  }

  // AUTONOMOUS -- velocity is the DIFFERENCE of two Perlin channels per axis
  // (this drop's own seed + its population's wander clock), plus a soft steer
  // away from the canvas edges. No reference to any other drop.
  //
  // Why a difference: the earlier version took a SINGLE noise channel as an
  // angle (heading = noise * TWO_PI * turns). p5's noise() clusters around its
  // mean (~0.47, NOT 0.5), so that heading clustered around one direction and
  // every orb crept that way forever -- the "everything drifts right" bug.
  // noise()*2-1 has the same disease (mean ~= -0.06, so a steady pull). A
  // difference of two independent noise samples is exactly zero-mean and
  // symmetric no matter what noise()'s mean is, so there is no net drift.
  wander(nz) {
    const [o0, o1, o2, o3] = WANDER_NOISE_OFFSETS;
    let vx = noise(this.noiseSeed + o0, nz) - noise(this.noiseSeed + o1, nz);
    let vy = noise(this.noiseSeed + o2, nz) - noise(this.noiseSeed + o3, nz);

    const m = EDGE_MARGIN; // top and bottom only: sideways the lamp wraps around
    if (this.pos.y < m)          vy += EDGE_STEER * (1 - this.pos.y / m);
    if (this.pos.y > height - m) vy -= EDGE_STEER * (1 - (height - this.pos.y) / m);

    this.autoVel.set(vx, vy);
    if (this.autoVel.magSq() > 1e-6) {
      const speedNoise = noise(this.noiseSeed + WANDER_SPEED_OFFSET, nz * 0.72 + 19);
      const speedScale = lerp(WANDER_SPEED_MIN, WANDER_SPEED_MAX, speedNoise);
      this.autoVel.setMag(MOVE_BASE_PX * speedByPop[this.pop] * speedScale * tuning.WANDER);
    }

  }

  // BUOYANCY -- heat in the bottom zone, cool in the top zone, keep temperature
  // in between; buoyant speed follows temperature with a little inertia.
  heat() {
    const radius = this.visualRadius(), size = radius / effectiveBlobSize();
    const bottom = (this.pos.y + radius * 0.5) / height, top = (this.pos.y - radius * 0.5) / height;
    const heating = constrain((bottom - (1 - HEATER_ZONE)) / HEATER_ZONE, 0, 1);
    const cooling = constrain((COOL_ZONE - top) / COOL_ZONE, 0, 1);
    const rate = tuning.HEAT_RATE * this.heatRate / size;
    this.temp += rate * (heating * (1 - this.temp) - cooling * this.temp)
      + MID_EXCHANGE * (NEUTRAL_TEMP - this.temp);
    const excess = (this.temp - NEUTRAL_TEMP) / NEUTRAL_TEMP;
    const target = -tuning.BUOYANCY_PX * Math.sign(excess) * Math.pow(Math.abs(excess), BUOYANCY_TEMP_EXPONENT)
      * Math.pow(size, BUOYANCY_SIZE_EXPONENT) * speedByPop[this.pop];
    this.buoyVel += (target - this.buoyVel) * BUOYANCY_INERTIA;
  }

  // CONVECTION -- the water circulates in side-by-side loops, one per screen
  // width of the world: rising wax drifts toward the middle of its loop (the
  // screen's middle, for the loop in view), sinking wax toward the loop's edges,
  // smoothly everywhere. Sideways speed follows how fast the drop is travelling.
  convection() {
    const towardMiddle = Math.sin(TWO_PI * wrapX(this.pos.x) / CANVAS_W); // + left half of a loop, - right half, 0 at its middle and edges
    const rising = this.buoyVel < 0 ? 1 : -1;
    return tuning.CONVECTION * Math.abs(this.buoyVel) * rising * towardMiddle;
  }

  // WAX -- the flow difference across the drop stretches (or squeezes) it along
  // its axis and turns the axis; surface tension relaxes the stretch at a rate
  // inversely proportional to the drop's size.
  deform() {
    const radius = this.visualRadius();
    const ax = Math.cos(this.axis), ay = Math.sin(this.axis);
    const reach = this.sep / 2 + radius * STRAIN_PROBE;
    const [fx1, fy1] = flowAt(this.pos.x + ax * reach, this.pos.y + ay * reach);
    const [fx0, fy0] = flowAt(this.pos.x - ax * reach, this.pos.y - ay * reach);
    const dvx = (fx1 - fx0) * FLOW_STRAIN;
    // A moving drop is also drawn out along its travel, turning it toward vertical.
    const dvy = (fy1 - fy0) * FLOW_STRAIN + BUOYANT_STRETCH * Math.abs(this.buoyVel) * Math.sign(ay || 1);
    this.sep += dvx * ax + dvy * ay;
    this.axis += (ax * dvy - ay * dvx) / (2 * reach);
    // Tension relaxes the drop toward a slightly stretched, slowly changing resting
    // shape rather than a perfect circle (none at SHAPE_IRREGULARITY 0).
    const rest = tuning.SHAPE_IRREGULARITY * REST_STRETCH * radius * noise(this.noiseSeed + 911, waxFrame * SHAPE_DRIFT);
    this.sep -= (this.sep - rest) * tuning.TENSION_RELAX * effectiveBlobSize() / radius;
    if (this.sep < 0) { this.sep = -this.sep; this.axis += PI; } // same lobe positions, axis flipped

    // Wax slowly redistributes between the lobes toward this drop's own split
    // point, kept where both pieces would be at least the minimum, so a merged
    // drop does not simply split back into the two drops it came from.
    const share = tuning.MIN_DROP_AREA / this.area;
    if (share <= 0.5) this.frac += (constrain(this.splitPoint, share, 1 - share) - this.frac) * SPLIT_SHARE_EASE;

    // A drop too small to split, or a population at its drop limit, only goes oval.
    const pinch = this.pinchSeparation();
    const count = drops.reduce((n, d) => n + (d.pop === this.pop), 0);
    if (Math.min(this.frac, 1 - this.frac) * this.area < tuning.MIN_DROP_AREA || count >= maxDropsPerColour()) {
      const limit = pinch * UNSPLITTABLE_STRETCH;
      if (this.sep > limit) this.sep -= (this.sep - limit) * UNSPLITTABLE_EASE; // ease back, never snap
    }
    const stretch = constrain(this.sep / pinch, 0, 1);
    this.lobeT += (stretch * stretch * (3 - 2 * stretch) - this.lobeT) * LOBE_EASE;
  }

  // INTER-POPULATION -- local collision attraction between different colours.
  //
  // Only different-population drops interact here, and only while their field
  // radii overlap. Their shared field creates the metaball collision shape;
  // attraction changes the local collision response, not free movement.
  applyCrossPopulationForces(all) {
    this.collisionForce.set(0, 0);
    this.mergeAmount = 0;

    const attr = effectiveInterAttractionFor(this.pop);
    const mergeT = mergeTFor(this.pop);
    const ownRadius = this.visualRadius();

    for (const other of all) {
      if (other === this || other.pop === this.pop) continue;
      const dx = wrapDx(other.pos.x - this.pos.x);
      const dy = other.pos.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      const otherAttraction = effectiveInterAttractionFor(other.pop);
      const pairAttraction = Math.min(attr, otherAttraction);
      const attractionT = constrain(pairAttraction / ATTR_MAX, 0, 1);
      const collisionReach = (ownRadius + other.visualRadius()) *
        lerp(ZERO_ATTRACTION_SEPARATION, COLLISION_REACH_FACTOR, attractionT);
      if (d >= collisionReach) continue;

      const ux = d > 1e-4 ? dx / d : 1;
      const uy = d > 1e-4 ? dy / d : 0;
      const contact = constrain(1 - d / collisionReach, 0, 1);
      // Merging contact is handled by surface tension in coalesceDrops().
      if (pairAttraction <= 0) {
        const push = REPULSION_BOUNCE * contact;
        this.collisionForce.x -= ux * push;
        this.collisionForce.y -= uy * push;
      }

      const m = pairAttraction > 0 ? mergeT * contact : 0;
      if (m > this.mergeAmount) this.mergeAmount = m;
    }
  }

  // The drop's own intended motion this frame; it actually moves in move().
  update() {
    this.ownVel.set(this.autoVel.x + this.drift.x + this.convection() + this.presencePull, this.autoVel.y + this.drift.y + this.buoyVel);
    this.drift.mult(DRIFT_DECAY);
  }

  // MOMENTUM -- everything acting on the drop (its own motion, collisions,
  // merge pull, contact) sets the velocity it heads toward; its actual velocity
  // eases there at tuning.ACCELERATION per frame, so it speeds up, slows down
  // and turns gradually instead of instantly.
  move(targetX, targetY) {
    this.vel.x += (targetX - this.vel.x) * tuning.ACCELERATION;
    this.vel.y += (targetY - this.vel.y) * tuning.ACCELERATION;
    this.pos.add(this.vel);
    this.keepInside();
  }

  // How fast this drop's own motion carries it along (ux, uy), px/frame.
  heading(ux, uy) {
    return this.ownVel.x * ux + this.ownVel.y * uy;
  }

  // Keep every lobe's VISIBLE edge inside the top and bottom (the kernel beyond it
  // is handled by the wall reflection in stampWithWalls()), easing back over a few frames
  // rather than snapping: a drop that grows at a wall by merging, or drifts into
  // one, slides in smoothly instead of jumping (wander()'s edge steer usually
  // keeps drops off this anyway).
  keepInside() {
    const lobes = this.lobes(), radii = this.lobeRadii();
    let shiftY = 0;
    lobes.forEach((l, i) => {
      const k = radii[i] * VISIBLE_EDGE;
      if (l.y < k) shiftY = Math.max(shiftY, k - l.y);
      if (l.y > height - k) shiftY = Math.min(shiftY, height - k - l.y);
    });
    this.pos.x = wrapX(this.pos.x); // sideways the lamp wraps around
    this.pos.y = constrain(this.pos.y + shiftY * WALL_EASE, 0, height);
    // Resting against the top or bottom: stop moving into it, so momentum does not keep
    // pressing the drop into the wall (which made it vibrate in place).
    if (shiftY > 0 && this.vel.y < 0) this.vel.y = 0;
    if (shiftY < 0 && this.vel.y > 0) this.vel.y = 0;
  }
}

// Tuning and monitoring hook: drop counts and wax events, and a way to run the
// physics ahead without drawing (e.g. window.harveyWax.simulate(3600) = 1 minute).
window.harveyWax = {
  stats() {
    const perPop = Array.from({ length: POP_COUNT }, (_, p) => drops.filter(d => d.pop === p));
    return {
      frame: waxFrame, ...waxEvents,
      dropsPerPop: perPop.map(list => list.length),
      inViewPerPop: perPop.map(list => list.filter(d => Math.abs(wrapDx(d.pos.x - VIEW_X - CANVAS_W / 2)) < CANVAS_W / 2 + d.visualRadius()).length),
      areasPerPop: perPop.map(list => list.map(d => Math.round(d.area * 100) / 100)),
      maxStretch: Math.round(Math.max(...drops.map(d => d.sep / d.pinchSeparation())) * 100) / 100,
      // share of wax at the top / in between / at the bottom of the height each drop can travel
      waxByThird: [0, 1, 2].map(t => Math.round(100 * drops.filter(d => {
        const r = d.visualRadius(), travel = Math.max(1, height - 2 * r), y = (d.pos.y - r) / travel;
        return (y < 0.15 ? 0 : y > 0.85 ? 2 : 1) === t;
      }).reduce((sum, d) => sum + d.area, 0) / drops.reduce((sum, d) => sum + d.area, 0))),
      rising: drops.filter(d => d.buoyVel < -0.15).length, sinking: drops.filter(d => d.buoyVel > 0.15).length
    };
  },
  simulate(frames) {
    for (let i = 0; i < frames; i++) stepWax();
    return this.stats();
  }
};

// ---- tuning panel (only with ?tune; the exhibition always uses TUNING_DEFAULTS) ----
const TUNING_CONTROLS = [
  { key: 'TENSION_RELAX', label: 'Surface tension (rounding, drop shape only)', min: 0.002, max: 0.05, step: 0.001 },
  { key: 'COALESCE_PULL', label: 'Colour attraction (0 bounce, no merging · higher merges)', min: 0, max: 2, step: 0.05 },
  { key: 'BUOYANCY_PX', label: 'Buoyancy speed', min: 0, max: 2.5, step: 0.05 },
  { key: 'HEAT_RATE', label: 'Heat / cool rate', min: 0.0005, max: 0.02, step: 0.0005 },
  { key: 'CONVECTION', label: 'Convection (sideways circulation)', min: 0, max: 2, step: 0.05 },
  { key: 'WANDER', label: 'Free wander', min: 0, max: 1.5, step: 0.05 },
  { key: 'MAX_DROPS_PER_COLOUR', label: 'Max drops per colour (per screen width)', min: 1, max: 6, step: 1 },
  { key: 'MAX_MERGE_GROUP', label: 'Max drops per merge', min: 2, max: 6, step: 1 },
  { key: 'MAX_MERGE_SECONDS', label: 'Max merge time (seconds)', min: 0.5, max: 10, step: 0.5 },
  { key: 'ACCELERATION', label: 'Acceleration (lower = drops speed up, slow and turn more gradually)', min: 0.005, max: 1, step: 0.005 },
  { key: 'SHAPE_IRREGULARITY', label: 'Shape irregularity (0 = circles)', min: 0, max: 2, step: 0.05 },
  { key: 'MIN_DROP_AREA', label: 'Minimum drop size (reload to resize starting drops)', min: 0.2, max: 2.5, step: 0.05 }
];
const TUNING_STORAGE = 'harvey-wax-tuning-v10';

function buildTuningPanel() {
  try { Object.assign(tuning, JSON.parse(localStorage.getItem(TUNING_STORAGE)) || {}); } catch {}
  const panel = document.createElement('div');
  panel.id = 'tuning';
  panel.innerHTML = `<style>
    #tuning { position: fixed; top: 12px; left: 12px; z-index: 10; width: 270px; padding: 12px 14px; border-radius: 10px;
      background: rgba(20, 22, 20, .86); color: #eee; font: 13px/1.4 system-ui, sans-serif; user-select: auto; touch-action: auto; }
    #tuning, #tuning * { cursor: auto !important; }
    #tuning label { display: block; margin-top: 10px; }
    #tuning .row { display: flex; gap: 8px; align-items: center; }
    #tuning input[type=range] { flex: 1; }
    #tuning input[type=number] { width: 68px; background: #222; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 2px 4px; }
    #tuning button { margin: 12px 6px 0 0; padding: 4px 10px; border-radius: 6px; border: 1px solid #666; background: #333; color: #eee; }
    #tuning .stats { margin-top: 10px; color: #aaa; font-variant-numeric: tabular-nums; }
  </style><strong>Wax tuning</strong>`;
  const inputs = {};
  for (const c of TUNING_CONTROLS) {
    const label = document.createElement('label');
    label.innerHTML = `${c.label}<div class="row"><input type="range" min="${c.min}" max="${c.max}" step="${c.step}"><input type="number" min="${c.min}" max="${c.max}" step="${c.step}"></div>`;
    const [range, number] = label.querySelectorAll('input');
    const set = value => {
      if (!Number.isFinite(value)) return;
      tuning[c.key] = value; range.value = value; number.value = value;
      try { localStorage.setItem(TUNING_STORAGE, JSON.stringify(tuning)); } catch {}
    };
    range.addEventListener('input', () => set(Number(range.value)));
    number.addEventListener('change', () => set(Number(number.value)));
    set(tuning[c.key]);
    inputs[c.key] = set;
    panel.appendChild(label);
  }
  const reset = document.createElement('button');
  reset.textContent = 'Reset';
  reset.onclick = () => { for (const c of TUNING_CONTROLS) inputs[c.key](TUNING_DEFAULTS[c.key]); };
  const copy = document.createElement('button');
  copy.textContent = 'Copy values';
  copy.onclick = () => navigator.clipboard?.writeText(TUNING_CONTROLS.map(c => `${c.key}: ${tuning[c.key]}`).join('\n'));
  const stats = document.createElement('div');
  stats.className = 'stats';
  panel.append(reset, copy, stats);
  document.body.appendChild(panel);

  // Drops per colour and split/merge rate over the last minute, to compare settings.
  const history = [];
  setInterval(() => {
    const s = window.harveyWax.stats();
    history.push({ t: performance.now(), splits: s.splits, merges: s.merges });
    while (history.length > 1 && performance.now() - history[0].t > 60000) history.shift();
    const minutes = Math.max(1 / 60, (performance.now() - history[0].t) / 60000);
    stats.textContent = `Drops per colour: ${s.dropsPerPop.join(' / ')} · per minute: ` +
      `${Math.round((s.splits - history[0].splits) / minutes)} splits, ${Math.round((s.merges - history[0].merges) / minutes)} merges`;
  }, 1000);
}
