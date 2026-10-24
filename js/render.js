// Instanced billboard renderer for the particle world.
// Fire / air / sparks are drawn additively (they glow against passthrough),
// water / ice are drawn with normal alpha blending and a little sphere shading.
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute vec3 iPos;
  attribute float iSize;
  attribute vec4 iColor;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = position.xy * 2.0;
    vColor = iColor;
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wp = iPos + (right * position.x + up * position.y) * iSize * 2.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const FRAG_GLOW = /* glsl */`
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float f = 1.0 - d;
    float core = pow(f, 3.0);
    vec3 col = vColor.rgb * (0.55 + 0.9 * core) + vec3(core * 0.25);
    gl_FragColor = vec4(col, vColor.a * pow(f, 1.3));
  }
`;

const FRAG_WATER = /* glsl */`
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    vec3 n = vec3(vUv, sqrt(max(0.0, 1.0 - d * d)));
    float diff = max(dot(n, normalize(vec3(0.3, 0.6, 0.75))), 0.0);
    float spec = pow(max(dot(n, normalize(vec3(0.35, 0.55, 0.75))), 0.0), 24.0);
    float rim = pow(d, 3.0);
    vec3 col = vColor.rgb * (0.55 + 0.6 * diff) + vec3(spec * 0.8) + vColor.rgb * rim * 0.4;
    gl_FragColor = vec4(col, vColor.a * smoothstep(1.0, 0.88, d));
  }
`;

class Layer {
  constructor(capacity, frag, blending) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.pos);
    geo.setAttribute('iSize', this.size);
    geo.setAttribute('iColor', this.col);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, blending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 20 : 10;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(p, scale) {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.pos.setXYZ(i, p.x, p.y, p.z);
    this.size.setX(i, p.size * scale);
    this.col.setXYZW(i, p.r, p.g, p.b, p.a);
  }
  end() {
    this.mesh.geometry.instanceCount = this.n;
    this.pos.needsUpdate = this.size.needsUpdate = this.col.needsUpdate = true;
  }
}

export class ParticleRenderer {
  constructor(scene, capacity = 1200) {
    this.glow = new Layer(capacity, FRAG_GLOW, THREE.AdditiveBlending);
    this.water = new Layer(capacity, FRAG_WATER, THREE.NormalBlending);
    scene.add(this.glow.mesh, this.water.mesh);
  }
  update(world) {
    this.glow.begin(); this.water.begin();
    for (const p of world.list) {
      switch (p.type) {
        case 'fire': this.glow.push(p, 1.9); break;
        case 'air': this.glow.push(p, 1.0); break;
        case 'spark': this.glow.push(p, 1.0); break;
        case 'water': this.water.push(p, p.isIce ? 1.15 : 1.0); break;
      }
    }
    this.glow.end(); this.water.end();
  }
}
