// Hand-tracking gesture reader (Quest 3).
//
// analyzeHand() detects the premade ONE-HAND gestures (out.g, keyed by gesture id) and produces a pose
// feature vector (out.feat) that custom recorded gestures are matched against.
// Which gesture does what is decided by the player's bindings (settings.js, edited in the Gesture Studio).
// Two-hand gestures live in pairs.js.
//
// Pure maths on joint positions so it can be unit-tested without a headset.
import * as THREE from 'three';

export const T = {
  pinchOn: 0.026, pinchOff: 0.04,
  fistOn: 0.062, fistOff: 0.082,     // mean fingertip -> palm distance
  openOn: 0.098, openOff: 0.082,     // every fingertip farther than this from the palm
  extOn: 0.100, extOff: 0.086,       // a finger counts as "out"
  curlOn: 0.076, curlOff: 0.092,     // a finger counts as "curled"
  thumbOn: 0.098, thumbOff: 0.082,   // thumb sticking out
  customOn: 0.85, customOff: 1.15,   // custom gesture match score (lower = better)
};

const v = () => new THREE.Vector3();
const tmp = { palm: v(), a: v(), b: v(), n: v(), toHead: v() };

export function newGestureState() {
  return {
    pinch: { index: false, middle: false, ring: false, pinky: false },
    fistLike: false, open: false, thumb: false,
    ext: [false, false, false, false], curl: [false, false, false, false],
  };
}

const FINGERS = [
  ['index', 'index-finger-tip'],
  ['middle', 'middle-finger-tip'],
  ['ring', 'ring-finger-tip'],
  ['pinky', 'pinky-finger-tip'],
];
export const GESTURE_IDS = ['pinch-index', 'pinch-middle', 'pinch-ring', 'pinch-pinky', 'fist', 'palm', 'point', 'peace', 'horns', 'thumbs-up'];
export const FEATURE_COUNT = 12;
export const PAIR_FEATURE_COUNT = FEATURE_COUNT * 2 + 2;

export function newGestureFlags() {
  const g = {};
  for (const id of GESTURE_IDS) g[id] = false;
  return g;
}

/**
 * @param get      (jointName) => THREE.Vector3 | null   (world space)
 * @param hand     'left' | 'right'
 * @param head     THREE.Vector3 head position
 * @param st       persistent gesture state (newGestureState())
 * @param out      result object (mutated): tracked, g, feat, palm, palmNormal, wrist, emitPos, emitDir, aimOrigin, aimDir, indexTip
 */
export function analyzeHand(get, hand, head, st, out, dt) {
  out.tracked = false;
  const wrist = get('wrist');
  const thumb = get('thumb-tip');
  const tips = [get('index-finger-tip'), get('middle-finger-tip'), get('ring-finger-tip'), get('pinky-finger-tip')];
  const idxMc = get('index-finger-metacarpal') || get('index-finger-phalanx-proximal');
  const pinkMc = get('pinky-finger-metacarpal') || get('pinky-finger-phalanx-proximal');
  const midKnuckle = get('middle-finger-phalanx-proximal');
  if (!wrist || !thumb || tips.some((t) => !t) || !idxMc || !pinkMc || !midKnuckle) return out;
  out.tracked = true;
  const idxTip = tips[0];

  // palm centre and outward palm normal
  const palm = tmp.palm.copy(wrist).add(midKnuckle).multiplyScalar(0.5);
  tmp.a.subVectors(idxMc, wrist);
  tmp.b.subVectors(pinkMc, wrist);
  // right hand: index x pinky points out of the palm, left hand is the mirror image
  tmp.n.crossVectors(tmp.a, tmp.b);
  if (hand === 'left') tmp.n.negate();
  tmp.n.normalize();

  out.palm.copy(palm);
  out.palmNormal.copy(tmp.n);
  out.wrist.copy(wrist);

  // fingertip distances to palm
  const d = tips.map((t) => t.distanceTo(palm));
  const mean = (d[0] + d[1] + d[2] + d[3]) / 4;
  const minD = Math.min(d[0], d[1], d[2], d[3]);
  const thumbOut = Math.min(thumb.distanceTo(palm), thumb.distanceTo(idxMc));

  for (let i = 0; i < 4; i++) {
    st.ext[i] = st.ext[i] ? d[i] > T.extOff : d[i] > T.extOn;
    st.curl[i] = st.curl[i] ? d[i] < T.curlOff : d[i] < T.curlOn;
  }
  st.thumb = st.thumb ? thumbOut > T.thumbOff : thumbOut > T.thumbOn;
  st.fistLike = st.fistLike ? mean < T.fistOff : mean < T.fistOn;

  // pinches: only the closest finger counts
  let best = null, bestD = 1e9;
  const pd = {};
  for (let i = 0; i < 4; i++) {
    const dd = thumb.distanceTo(tips[i]);
    pd[FINGERS[i][0]] = dd;
    if (dd < bestD) { bestD = dd; best = FINGERS[i][0]; }
  }
  for (const [name] of FINGERS) {
    const was = st.pinch[name];
    st.pinch[name] = was ? pd[name] < T.pinchOff : pd[name] < T.pinchOn;
    if (st.pinch[name] && name !== best) st.pinch[name] = false;
  }
  if (st.fistLike) for (const [name] of FINGERS) st.pinch[name] = false;
  const anyPinch = FINGERS.some(([name]) => st.pinch[name]);

  const free = !st.fistLike && !anyPinch;
  st.open = free && (st.open ? minD > T.openOff : minD > T.openOn);

  const g = out.g;
  g['pinch-index'] = st.pinch.index;
  g['pinch-middle'] = st.pinch.middle;
  g['pinch-ring'] = st.pinch.ring;
  g['pinch-pinky'] = st.pinch.pinky;
  g.fist = st.fistLike && !st.thumb;
  g['thumbs-up'] = st.fistLike && st.thumb;
  g.palm = st.open;
  const [eI, eM, eR, eP] = st.ext, [cI, cM, cR, cP] = st.curl;
  g.point = free && eI && cM && cR && cP;
  g.peace = free && eI && eM && cR && cP;
  g.horns = free && eI && eP && cM && cR;

  // pose features for custom gestures (rotation / position invariant, metres)
  const f = out.feat;
  f[0] = thumb.distanceTo(palm);
  f[1] = d[0]; f[2] = d[1]; f[3] = d[2]; f[4] = d[3];
  f[5] = pd.index; f[6] = pd.middle; f[7] = pd.ring; f[8] = pd.pinky;
  f[9] = tips[0].distanceTo(tips[1]); f[10] = tips[1].distanceTo(tips[2]); f[11] = tips[2].distanceTo(tips[3]);

  // where particles spawn
  out.emitPos.copy(thumb).add(idxTip).multiplyScalar(0.5);
  // aim for emission: from the eyes through the pinch point (stable and natural)
  tmp.toHead.subVectors(out.emitPos, head);
  if (tmp.toHead.lengthSq() > 1e-6) out.emitDir.copy(tmp.toHead).normalize();

  // redirect target ray: out of the palm
  out.aimOrigin.copy(palm);
  out.aimDir.copy(tmp.n);

  out.indexTip.copy(idxTip);
  return out;
}

// ---------------------------------------------------------------------------
// Custom (recorded) gestures
// ---------------------------------------------------------------------------
// Two-hand pose = left features + right features + [palm distance, 0.1 * dot(normals)]
export function pairFeatures(fl, fr, palmL, nL, palmR, nR, out = []) {
  for (let i = 0; i < FEATURE_COUNT; i++) { out[i] = fl[i]; out[FEATURE_COUNT + i] = fr[i]; }
  out[PAIR_FEATURE_COUNT - 2] = palmL.distanceTo(palmR);
  out[PAIR_FEATURE_COUNT - 1] = 0.1 * nL.dot(nR);
  return out;
}

// RMS normalised error: 0 = identical, 1 = typical feature off by its tolerance.
// (RMS rather than a plain mean so a couple of badly wrong features can't hide among many good ones.)
export function matchScore(def, feat) {
  const n = def.mean.length;
  if (feat.length < n) return Infinity;
  let s = 0;
  for (let i = 0; i < n; i++) { const e = (feat[i] - def.mean[i]) / def.tol[i]; s += e * e; }
  return Math.sqrt(s / n);
}

// frames: array of feature arrays captured while the player held the pose
export function buildDef(frames, pair) {
  const n = frames[0].length;
  const mean = new Array(n).fill(0), tol = new Array(n).fill(0);
  for (const f of frames) for (let i = 0; i < n; i++) mean[i] += f[i] / frames.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of frames) s += (f[i] - mean[i]) ** 2;
    const sd = Math.sqrt(s / frames.length);
    const minTol = pair && i >= FEATURE_COUNT * 2 ? 0.05 : 0.014;
    tol[i] = Math.max(minTol, 2.5 * sd);
    mean[i] = Math.round(mean[i] * 10000) / 10000;
    tol[i] = Math.round(tol[i] * 10000) / 10000;
  }
  return { mean, tol };
}

// hysteresis wrapper
export function customActive(def, feat, wasOn) {
  const s = matchScore(def, feat);
  return wasOn ? s < T.customOff : s < T.customOn;
}
