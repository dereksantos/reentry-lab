// "Vehicle camera" inset: a close-up of the vehicle in its own flight frame, with the shock-layer glow,
// wake, parachutes and horizon driven by the simulation at the playback time.
// Flight frame: the air-relative velocity points along +X; local "up" is +Y before banking.
import * as THREE from 'three';
import { blackbody } from '../colormap.js';

const v2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
const PROFILES = {
  capsule: v2([[0, 0.2], [0.45, 0.17], [0.82, 0.08], [1.0, 0.0], [0.96, -0.09], [0.42, -1.0], [0.26, -1.06], [0, -1.08]]),
  probe: v2([[0, 0.26], [0.22, 0.22], [1.0, -0.22], [0.97, -0.32], [0.55, -0.7], [0, -0.76]]),
  inflatable: v2([[0, 0.22], [0.35, 0.18], [2.1, -0.5], [2.05, -0.64], [1.2, -0.6], [0.35, -0.62], [0.3, -1.0], [0, -1.04]])
};

function plasmaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(1, 0.5, 0.2) }, intensity: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float intensity; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
      void main(){
        float rim = pow(1.0 - abs(dot(vN, vV)), 1.6);
        float flick = 0.85 + 0.15*sin(time*40.0 + vP.y*9.0 + vP.z*7.0) + 0.1*h(floor(vP*12.0 + time*3.0));
        float a = clamp(intensity * (0.35 + rim) * flick, 0.0, 1.0);
        gl_FragColor = vec4(color * (0.6 + 0.8*rim), a);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
}
function wakeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(1, 0.5, 0.2) }, intensity: { value: 0 }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 color; uniform float intensity; uniform float time; varying vec2 vUv;
      void main(){
        float along = vUv.y;                       // 1 at the vehicle, 0 at the tail
        float n = 0.75 + 0.25*sin(vUv.x*40.0 + time*25.0) * sin(along*30.0 - time*60.0);
        float a = intensity * pow(along, 1.8) * n;
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
}

export class VehicleView {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(42, 1.6, 0.05, 2000);
    this.scene.add(new THREE.AmbientLight(0x9fb0c8, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2, 5, 3);
    this.scene.add(key);

    // World (horizon) rotates with flight-path angle; the vehicle rotates with bank.
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.ground = new THREE.Mesh(new THREE.SphereGeometry(300, 96, 48), new THREE.MeshStandardMaterial({ color: 0x1d3550, roughness: 1 }));
    this.world.add(this.ground);
    this.haze = new THREE.Mesh(new THREE.SphereGeometry(303, 96, 48), new THREE.MeshBasicMaterial({ color: 0x4f86c6, transparent: true, opacity: 0.25, side: THREE.BackSide, depthWrite: false }));
    this.world.add(this.haze);

    this.vehicle = new THREE.Group();
    this.scene.add(this.vehicle);
    this.body = new THREE.Group();
    this.vehicle.add(this.body);

    this.plasma = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.42), plasmaMaterial());
    this.plasma.rotation.z = -Math.PI / 2;
    this.vehicle.add(this.plasma);
    const wakeGeo = new THREE.CylinderGeometry(0.35, 1.0, 7, 32, 1, true);
    wakeGeo.rotateZ(Math.PI / 2);
    wakeGeo.translate(-4.2, 0, 0);
    this.wake = new THREE.Mesh(wakeGeo, wakeMaterial());
    this.vehicle.add(this.wake);

    this.chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), new THREE.MeshStandardMaterial({ color: 0xff7a3a, roughness: 0.8, side: THREE.DoubleSide }));
    canopy.rotation.z = Math.PI / 2;
    canopy.position.x = -1;
    this.canopy = canopy;
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd8dde3, transparent: true, opacity: 0.7 }));
    this.chuteLines = lines;
    this.chute.add(canopy, lines);
    this.vehicle.add(this.chute);

    // Air streaks: points that stream past the vehicle; more visible in denser air.
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([Math.random() * 40 - 20, Math.random() * 14 - 7, Math.random() * 14 - 7], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.streaks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.06, transparent: true, opacity: 0.4, depthWrite: false }));
    this.scene.add(this.streaks);

    this.shape = null;
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.7, metalness: 0.1, emissive: new THREE.Color(0, 0, 0) });
    this.hullMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.55, metalness: 0.35 });
    this.camAngle = 0;
    this.lastT = performance.now();
  }

  setShape(shape) {
    if (shape === this.shape) return;
    this.shape = shape;
    this.body.clear();
    if (shape === 'glider') {
      const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 2.4, 8, 16), this.hullMat);
      fus.rotation.z = Math.PI / 2;
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0.9, 0); wingShape.lineTo(-1.3, 1.5); wingShape.lineTo(-1.5, 1.5); wingShape.lineTo(-1.5, -1.5); wingShape.lineTo(-1.3, -1.5); wingShape.closePath();
      const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false }), this.hullMat);
      wing.rotation.x = Math.PI / 2;
      wing.position.y = -0.12;
      const belly = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.02, bevelEnabled: false }), this.shieldMat);
      belly.rotation.x = Math.PI / 2;
      belly.position.y = -0.2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.05), this.hullMat);
      fin.position.set(-1.2, 0.45, 0);
      this.body.add(fus, wing, belly, fin);
      this.body.rotation.z = 0.68; // ~40° angle of attack, belly into the flow
      this.plasma.position.set(0.3, -0.35, 0);
      this.plasma.scale.set(0.8, 1.9, 1.9);
      this.plasma.rotation.set(0, 0, -Math.PI / 2 + 0.68);
    } else {
      const prof = PROFILES[shape] || PROFILES.capsule;
      const geo = new THREE.LatheGeometry(prof, 64);
      geo.rotateZ(-Math.PI / 2);
      // Split material: forebody (heat shield) vs backshell by vertex x
      const shield = new THREE.Mesh(geo, this.hullMat);
      const front = new THREE.Mesh(new THREE.SphereGeometry(shape === 'inflatable' ? 2.12 : 1.02, 48, 16, 0, Math.PI * 2, 0, shape === 'probe' ? 0.9 : 0.62), this.shieldMat);
      front.rotation.z = -Math.PI / 2;
      front.scale.set(shape === 'probe' ? 0.45 : 0.22, 1, 1);
      front.position.x = shape === 'probe' ? 0.02 : 0.0;
      this.body.add(shield, front);
      this.body.rotation.z = 0;
      const s = shape === 'inflatable' ? 2.3 : 1.15;
      this.plasma.position.set(0.12, 0, 0);
      this.plasma.scale.set(0.55 * s, s, s);
      this.plasma.rotation.set(0, 0, -Math.PI / 2);
    }
  }

  update(sample, params, planetId) {
    if (!sample) return;
    this.setShape(params.vehicle.shape);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const time = now / 1000;
    const altKm = sample.alt / 1000;

    // Lifting capsules fly at an angle of attack; tilt slightly so the offset shows.
    if (params.vehicle.shape !== 'glider') this.body.rotation.z = params.vehicle.liftToDrag > 0 ? -0.35 * Math.min(1, params.vehicle.liftToDrag / 0.35) : 0;

    // Bank and flight-path angle
    this.vehicle.rotation.set((sample.bank || 0) * Math.PI / 180, 0, 0);
    this.world.rotation.set(0, 0, -(sample.fpa || 0) * Math.PI / 180);
    const d = 2.5 + 40 * Math.pow(Math.max(altKm, 0) / 120, 0.8);
    this.ground.position.set(0, -300 - d, 0);
    this.haze.position.copy(this.ground.position);

    // Sky
    const mars = planetId === 'mars';
    const low = mars ? new THREE.Color(0.78, 0.6, 0.45) : new THREE.Color(0.42, 0.62, 0.86);
    const k = Math.min(1, Math.max(0, (85 - altKm) / 70));
    this.scene.background = new THREE.Color(0, 0, 0.01).lerp(low, Math.pow(k, 1.6));
    this.ground.material.color.set(mars ? 0x7a3d24 : 0x1d3a55);
    this.haze.material.color.set(mars ? 0xd09a70 : 0x6aa0dc);

    // Heating visuals
    const q = sample.q || 0;
    const glow = Math.min(1, Math.max(0, (Math.log10(Math.max(q, 0.1)) - 0.3) / 2.2));
    const gasT = 1800 + 7000 * glow;
    const [r, g, b] = blackbody(gasT);
    this.plasma.material.uniforms.color.value.setRGB(r, g * 0.9, b * 0.85);
    this.plasma.material.uniforms.intensity.value = glow * 1.1;
    this.plasma.material.uniforms.time.value = time;
    this.wake.material.uniforms.color.value.setRGB(r, g * 0.8, b * 0.7);
    this.wake.material.uniforms.intensity.value = glow * 0.7;
    this.wake.material.uniforms.time.value = time;
    const wallGlow = Math.min(1, Math.max(0, (sample.tWall - 900) / 2200));
    const [wr, wg, wb] = blackbody(Math.max(sample.tWall, 1000));
    this.shieldMat.emissive.setRGB(wr * wallGlow * 1.5, wg * wallGlow * 1.2, wb * wallGlow);

    // Parachutes
    const stage = Math.round(sample.chute || 0);
    this.chute.visible = stage > 0;
    if (stage > 0) {
      const main = stage === 2;
      const size = main ? 3.2 : 1.1;
      const dist = main ? 7.5 : 4.5;
      this.canopy.scale.set(size * 0.8, size, size);
      this.canopy.position.set(-dist, 0, 0);
      this.canopy.material.color.set(main ? 0xff7a3a : 0xf2f2f2);
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push(-0.9, 0, 0, -dist + 0.2, Math.cos(a) * size * 0.98, Math.sin(a) * size * 0.98);
      }
      this.chuteLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    }

    // Streaks: speed and visibility follow air speed and density
    const pos = this.streaks.geometry.attributes.position;
    const speed = Math.min(80, 6 + Math.log10(Math.max(sample.vRel, 10)) * 14);
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) - speed * dt;
      if (x < -20) x += 40;
      pos.setX(i, x);
    }
    pos.needsUpdate = true;
    this.streaks.material.opacity = Math.min(0.6, Math.max(0.02, (Math.log10(Math.max(sample.rho || 1e-12, 1e-12)) + 7) / 8));

    // Slowly drifting chase camera
    this.camAngle += dt * 0.08;
    const radius = stage === 2 ? 15 : params.vehicle.shape === 'inflatable' ? 8 : 6.5;
    this.camera.position.set(-radius * 0.55 + Math.sin(this.camAngle) * 1.2, radius * 0.35, radius * 0.8 * Math.cos(this.camAngle * 0.7));
    this.camera.lookAt(stage === 2 ? -3 : 0, 0, 0);
  }

  render(renderer, rect, canvasHeight) {
    if (!rect.w || !rect.h) return;
    this.camera.aspect = rect.w / rect.h;
    this.camera.updateProjectionMatrix();
    const y = canvasHeight - rect.y - rect.h;
    renderer.setViewport(rect.x, y, rect.w, rect.h);
    renderer.setScissor(rect.x, y, rect.w, rect.h);
    renderer.setScissorTest(true);
    const prev = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setClearColor(this.scene.background, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(prev, prevA);
    renderer.setScissorTest(false);
  }
}
