// Two-hand gestures. Input: the two hands' palm positions / normals and their one-hand gesture flags.
//   clasp, prayer, clap, double-fist, double-palm, both-pinch, pinch-stretch, crossed, cupped, arms-wide
import * as THREE from 'three';

export const PAIR_IDS = ['clasp', 'prayer', 'clap', 'double-fist', 'double-palm', 'both-pinch', 'pinch-stretch', 'crossed', 'cupped', 'arms-wide'];

export function newPairState() { return { prevDist: null, clapT: 0, clasp: false }; }

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * @param L,R   { palm: Vector3, normal: Vector3, has(id): bool } for the left and right hand
 * @param set   Set to fill with the active two-hand gesture ids
 */
export function analyzePair(L, R, head, headDir, st, set, dt) {
  set.clear();
  const dP = L.palm.distanceTo(R.palm);

  _f.set(headDir.x, 0, headDir.z);
  if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
  _f.normalize();
  _r.set(-_f.z, 0, _f.x);                      // head-right on the floor plane

  const bothPalm = L.has('palm') && R.has('palm');
  const facing = L.normal.dot(R.normal);

  const prayer = dP < 0.17 && bothPalm && facing < -0.5;
  st.clasp = st.clasp ? dP < 0.20 : dP < 0.15;
  const clasp = st.clasp && !prayer;

  // clap = fast closing of the hands; stays "on" briefly so it's a clear pulse
  if (st.prevDist !== null && dt > 0) {
    const closing = (st.prevDist - dP) / dt;
    if (dP < 0.12 && closing > 0.8) st.clapT = 0.3;
  }
  st.prevDist = dP;
  st.clapT = Math.max(0, st.clapT - dt);

  const bothPinch = L.has('pinch-index') && R.has('pinch-index');
  _d.subVectors(L.palm, R.palm);
  const inFront = _d.set(L.palm.x - head.x, 0, L.palm.z - head.z).dot(_f) > 0.15 && _d.set(R.palm.x - head.x, 0, R.palm.z - head.z).dot(_f) > 0.15;
  const leftOnRight = (L.palm.x - R.palm.x) * _r.x + (L.palm.z - R.palm.z) * _r.z;

  if (clasp) set.add('clasp');
  if (prayer) set.add('prayer');
  if (st.clapT > 0) set.add('clap');
  if (L.has('fist') && R.has('fist')) set.add('double-fist');
  if (bothPalm) set.add('double-palm');
  if (bothPinch) set.add('both-pinch');
  if (bothPinch && dP > 0.35) set.add('pinch-stretch');
  if (inFront && leftOnRight > 0.04 && dP < 0.45) set.add('crossed');
  if (bothPalm && L.normal.y > 0.55 && R.normal.y > 0.55 && dP < 0.45) set.add('cupped');
  if (dP > 0.95 && Math.abs(L.palm.y - R.palm.y) < 0.3) set.add('arms-wide');
  return set;
}
