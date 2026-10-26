// Hand-tracking gesture reader (Quest 3).
//
// This only detects raw gestures (out.g): pinch-index / -middle / -ring / -pinky, fist, open palm.
// Which gesture does what is decided by the player's bindings (settings.js, edited in the in-game menu).
//
// Pure maths on joint positions so it can be unit-tested without a headset.
import * as THREE from 'three';

export const T = {
  pinchOn: 0.026, pinchOff: 0.04,
  fistOn: 0.062, fistOff: 0.082,     // mean fingertip -> palm distance
  openOn: 0.098, openOff: 0.082,
};

const v = () => new THREE.Vector3();
const tmp = { palm: v(), a: v(), b: v(), n: v(), mid: v(), toHead: v() };

export function newGestureState() {
  return { pinch: { index: false, middle: false, ring: false, pinky: false }, fist: false, open: false };
}

const FINGERS = [
  ['index', 'index-finger-tip'],
  ['middle', 'middle-finger-tip'],
  ['ring', 'ring-finger-tip'],
  ['pinky', 'pinky-finger-tip'],
];

/**
 * @param get      (jointName) => THREE.Vector3 | null   (world space)
 * @param hand     'left' | 'right'
 * @param head     THREE.Vector3 head position
 * @param st       persistent gesture state (newGestureState())
 * @param out      result object (mutated)
 */
export function analyzeHand(get, hand, head, st, out, dt) {
  out.tracked = false;
  const wrist = get('wrist');
  const thumb = get('thumb-tip');
  const idxTip = get('index-finger-tip');
  const midTip = get('middle-finger-tip');
  const ringTip = get('ring-finger-tip');
  const pinkTip = get('pinky-finger-tip');
  const idxMc = get('index-finger-metacarpal') || get('index-finger-phalanx-proximal');
  const pinkMc = get('pinky-finger-metacarpal') || get('pinky-finger-phalanx-proximal');
  const midKnuckle = get('middle-finger-phalanx-proximal');
  if (!wrist || !thumb || !idxTip || !midTip || !ringTip || !pinkTip || !idxMc || !pinkMc || !midKnuckle) return out;
  out.tracked = true;

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
  const dI = idxTip.distanceTo(palm), dM = midTip.distanceTo(palm), dR = ringTip.distanceTo(palm), dP = pinkTip.distanceTo(palm);
  const mean = (dI + dM + dR + dP) / 4;
  const minD = Math.min(dI, dM, dR, dP);

  st.fist = st.fist ? mean < T.fistOff : mean < T.fistOn;

  // pinches: only the closest finger counts
  let best = null, bestD = 1e9;
  const dists = {};
  for (const [name, joint] of FINGERS) {
    const d = thumb.distanceTo(get(joint));
    dists[name] = d;
    if (d < bestD) { bestD = d; best = name; }
  }
  for (const [name] of FINGERS) {
    const was = st.pinch[name];
    st.pinch[name] = was ? dists[name] < T.pinchOff : dists[name] < T.pinchOn;
    if (st.pinch[name] && name !== best) st.pinch[name] = false;
  }
  if (st.fist) { st.pinch.index = st.pinch.middle = st.pinch.ring = st.pinch.pinky = false; }
  const anyPinch = st.pinch.index || st.pinch.middle || st.pinch.ring || st.pinch.pinky;
  // open palm = all fingers extended, thumb not pinching anything
  st.open = !st.fist && !anyPinch && (st.open ? minD > T.openOff : minD > T.openOn);

  out.g.pinchIndex = st.pinch.index;
  out.g.pinchMiddle = st.pinch.middle;
  out.g.pinchRing = st.pinch.ring;
  out.g.pinchPinky = st.pinch.pinky;
  out.g.fist = st.fist;
  out.g.palm = st.open;

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
