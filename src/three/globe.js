// The main 3D view: planet, atmosphere, trajectory (colored by heating), ground track, event labels,
// pinned comparison runs and the live vehicle marker. Scene units: 1 = the planet's mean radius.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { PLANETS } from '../../sim/index.js';
import { earthTexture, marsTexture } from './globeTexture.js';
import { heatRGB, heatScale } from '../colormap.js';

// ECEF (x, y, z with z north) -> three.js (y up)
const toScene = (x, y, z, k) => new THREE.Vector3(x * k, z * k, -y * k);

export class Globe {
  constructor(canvas, labelsEl) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.labelRenderer = new CSS2DRenderer({ element: labelsEl });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.0005, 400);
    this.camera.position.set(1.2, 1.4, 3.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 14;
    this.controls.rotateSpeed = 0.6;

    // Light rides with the camera so whatever you look at is lit (this is a study view, not a day/night model).
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.set(2.5, 2, 1.5);
    this.camera.add(this.sun);
    this.scene.add(this.camera, new THREE.AmbientLight(0x8fa6c8, 0.55));
    this.scene.add(this.makeStars());

    this.planetId = null;
    this.planet = new THREE.Group();
    this.scene.add(this.planet);
    this.textures = {};

    this.runGroup = new THREE.Group();
    this.pinGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this.scene.add(this.runGroup, this.pinGroup, this.labelGroup);

    this.marker = this.makeMarker();
    this.scene.add(this.marker);
    this.lineMaterials = [];
    this.lastTarget = null;
    this.mode = 'orbit';
    // Campaign: 'full' shows the whole predicted run; 'hidden' shows none of it; 'trail' draws it up to the vehicle.
    this.reveal = 'full';
    this.targetGroup = new THREE.Group();
    this.scene.add(this.targetGroup);
    // Pixels of the canvas covered by floating panels; the camera frames the open area between them.
    this.insets = { left: 0, right: 0, top: 0, bottom: 0 };
    this.fitScale = 1;
  }

  setInsets(insets) {
    this.insets = insets;
    this.resize();
  }

  makeStars() {
    const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 150;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const b = 0.4 + rnd() * 0.6;
      col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
  }

  makeMarker() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: 0xff8a3d, sizeAttenuation: false, depthTest: false, transparent: true, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m);
    s.scale.set(0.045, 0.045, 1);
    s.renderOrder = 10;
    return s;
  }

  setPlanet(id) {
    if (id === this.planetId) return;
    this.planetId = id;
    const P = PLANETS[id];
    this.R = P.meanRadius;
    this.planet.clear();
    if (!this.textures[id]) this.textures[id] = id === 'earth' ? earthTexture() : marsTexture();
    const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 120), new THREE.MeshStandardMaterial({ map: this.textures[id], roughness: 0.95, metalness: 0 }));
    this.planet.add(surface);
    // Thin glow at the limb
    const glowColor = id === 'earth' ? new THREE.Color(0.35, 0.6, 1.0) : new THREE.Color(0.95, 0.6, 0.4);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 64), new THREE.ShaderMaterial({
      uniforms: { c: { value: glowColor } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(c, f*0.9); }',
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.planet.add(glow);
    // Shell at 100 km (scaled by the altitude exaggeration)
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    this.planet.add(this.shell);
    this.updateShell();
  }

  updateShell() {
    if (this.shell) this.shell.scale.setScalar(1 + (100000 * (this.exag || 1)) / this.R);
  }

  posOf(result, i, exag) {
    const s = result.samples;
    const r = Math.hypot(s.x[i], s.y[i], s.z[i]);
    const k = (this.R + s.alt[i] * exag) / (r * this.R);
    return toScene(s.x[i], s.y[i], s.z[i], k);
  }
  groundOf(result, i, lift = 1.0008) {
    const s = result.samples;
    const r = Math.hypot(s.x[i], s.y[i], s.z[i]);
    return toScene(s.x[i], s.y[i], s.z[i], lift / r);
  }

  lineMat(opts) {
    const m = new LineMaterial({ linewidth: 3, worldUnits: false, ...opts });
    m.resolution.set(this.canvas.clientWidth, this.canvas.clientHeight);
    this.lineMaterials.push(m);
    return m;
  }

  // Draw the current run.
  setRun(result, exag, heatMax) {
    this.result = result;
    this.exag = exag;
    this.updateShell();
    for (const o of [...this.runGroup.children]) { o.geometry?.dispose(); }
    this.runGroup.clear();
    this.labelGroup.clear();
    this.lineMaterials = this.lineMaterials.filter((m) => !m.__run);
    if (!result) return;
    const n = result.samples.t.length;
    const scale = heatScale(heatMax);
    const pos = [], col = [], gpos = [], curtain = [];
    for (let i = 0; i < n; i++) {
      const p = this.posOf(result, i, exag), g = this.groundOf(result, i);
      pos.push(p.x, p.y, p.z);
      const c = heatRGB(scale(result.samples.q[i]));
      col.push(...c);
      gpos.push(g.x, g.y, g.z);
      curtain.push(p, g);
    }
    const geo = new LineGeometry();
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = this.lineMat({ vertexColors: true, linewidth: 3.2 });
    mat.__run = true;
    this.runLine = new Line2(geo, mat);
    this.runSegments = n - 1;
    this.runGroup.add(this.runLine);

    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    this.groundLine = new THREE.Line(gg, new THREE.LineBasicMaterial({ color: 0xa3b3c6, transparent: true, opacity: 0.45 }));
    this.runGroup.add(this.groundLine);

    // Translucent curtain between the path and the ground track, for depth.
    const idx = [], verts = [];
    for (let i = 0; i < curtain.length; i++) verts.push(curtain[i].x, curtain[i].y, curtain[i].z);
    for (let i = 0; i < n - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    cg.setIndex(idx);
    this.curtain = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x5ea2ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    this.runGroup.add(this.curtain);

    // A few labels only; events close in time would overlap on screen (the timeline lists them all).
    const wanted = { entry: 'Entry', peakQ: 'Peak heating', chute: 'Parachute', touchdown: 'Touchdown', skip: 'Skip-out', reentry: 'Second entry' };
    const placed = [];
    for (const ev of result.events) {
      if (!wanted[ev.type]) continue;
      const i = this.indexAt(result, ev.t);
      const dr = result.samples.downrange[i];
      const span = Math.max(result.summary.downrange, 1);
      if (placed.some((d) => Math.abs(d - dr) < 0.15 * span)) continue;
      placed.push(dr);
      const el = document.createElement('div');
      el.className = 'evlabel';
      el.textContent = wanted[ev.type];
      const o = new CSS2DObject(el);
      o.position.copy(this.posOf(result, i, exag));
      this.labelGroup.add(o);
    }
    this.applyReveal(this.lastT || 0);
  }

  setReveal(mode) {
    this.reveal = mode;
    this.applyReveal(this.lastT || 0);
  }

  applyReveal(t) {
    if (!this.runLine) return;
    const full = this.reveal === 'full';
    this.runGroup.visible = this.reveal !== 'hidden';
    this.labelGroup.visible = full;
    const i = full ? this.runSegments : Math.max(1, this.indexAt(this.result, t));
    this.runLine.geometry.instanceCount = i;
    this.groundLine.geometry.setDrawRange(0, full ? Infinity : i + 1);
    this.curtain.geometry.setDrawRange(0, full ? Infinity : i * 6);
  }

  // A ring on the ground around a target (lat, lon in degrees), for campaign contracts. null removes it.
  setTarget(target, planetId) {
    this.targetGroup.clear();
    if (!target) return;
    const d = Math.PI / 180, lat = target.lat * d, lon = target.lon * d;
    const c = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
    const north = new THREE.Vector3().crossVectors(c, east);
    const R = PLANETS[planetId || this.planetId].meanRadius / 1000;
    const ring = (km, color, opacity) => {
      const a = km / R, pts = [];
      for (let k = 0; k <= 96; k++) {
        const th = (k / 96) * Math.PI * 2;
        const u = c.clone().multiplyScalar(Math.cos(a)).add(east.clone().multiplyScalar(Math.cos(th) * Math.sin(a))).add(north.clone().multiplyScalar(Math.sin(th) * Math.sin(a)));
        pts.push(toScene(u.x, u.y, u.z, 1.002));
      }
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true }));
    };
    for (const [km, op] of target.rings || [[150, 0.5], [40, 0.8], [10, 1]]) this.targetGroup.add(ring(km, 0x3ccf91, op));
    const el = document.createElement('div');
    el.className = 'evlabel target';
    el.textContent = target.label;
    const o = new CSS2DObject(el);
    o.position.copy(toScene(c.x, c.y, c.z, 1.004));
    this.targetGroup.add(o);
  }

  setPins(pins, exag, colors) {
    this.pinGroup.clear();
    this.lineMaterials = this.lineMaterials.filter((m) => !m.__pin);
    pins.forEach((pin, k) => {
      if (!pin.result) return;
      const r = pin.result, n = r.samples.t.length, pos = [];
      for (let i = 0; i < n; i++) { const p = this.posOf(r, i, exag); pos.push(p.x, p.y, p.z); }
      const geo = new LineGeometry();
      geo.setPositions(pos);
      const mat = this.lineMat({ color: new THREE.Color(colors[k]), linewidth: 2, dashed: false, transparent: true, opacity: 0.9 });
      mat.__pin = true;
      this.pinGroup.add(new Line2(geo, mat));
    });
  }

  indexAt(result, t) {
    const T = result.samples.t;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo;
  }

  // Move the vehicle marker to playback time t.
  setPlayhead(sample, heatMax) {
    if (!sample || !this.result) return;
    this.lastT = sample.t;
    if (this.reveal === 'trail') this.applyReveal(sample.t);
    const r = Math.hypot(sample.x, sample.y, sample.z);
    const k = (this.R + sample.alt * this.exag) / (r * this.R);
    const p = toScene(sample.x, sample.y, sample.z, k);
    this.marker.position.copy(p);
    const c = heatRGB(heatScale(heatMax)(sample.q));
    this.marker.material.color.setRGB(Math.max(c[0], 0.7), Math.max(c[1], 0.55), Math.max(c[2], 0.4));
    const glow = 0.035 + 0.03 * Math.min(1, sample.q / Math.max(heatMax, 1));
    this.marker.scale.set(glow, glow, 1);
    if (this.mode === 'follow') {
      if (this.lastTarget) this.camera.position.add(p.clone().sub(this.lastTarget));
      this.controls.target.copy(p);
    }
    this.lastTarget = p.clone();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'follow' && this.lastTarget) {
      const dir = this.lastTarget.clone().normalize();
      this.controls.target.copy(this.lastTarget);
      this.camera.position.copy(this.lastTarget.clone().add(dir.multiplyScalar(0.25)).add(new THREE.Vector3(0.12, 0.08, 0.12)));
    }
    if (mode === 'orbit') this.controls.target.set(0, 0, 0);
  }

  fit() {
    if (!this.result) return;
    const n = this.result.samples.t.length;
    const pts = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1].map((i) => this.posOf(this.result, i, this.exag));
    const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const radius = Math.max(...pts.map((p) => p.distanceTo(center)), 0.05);
    const out = center.clone().normalize();
    this.mode = 'orbit';
    this.controls.target.copy(center);
    const side = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[0]).normalize();
    const view = out.clone().multiplyScalar(0.9).add(new THREE.Vector3().crossVectors(out, side).multiplyScalar(0.45)).normalize();
    this.camera.position.copy(center.clone().add(view.multiplyScalar((radius * 3.2 + 0.15) * this.fitScale)));
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    const { left, right, top, bottom } = this.insets;
    const fw = Math.max(120, w - left - right), fh = Math.max(120, h - top - bottom);
    // Shift the projection so the orbit target sits at the centre of the open area, not the canvas.
    if (left || right || top || bottom) this.camera.setViewOffset(w, h, (right - left) / 2, (bottom - top) / 2, w, h);
    else this.camera.clearViewOffset();
    this.fitScale = Math.min(3, Math.max(1, h / fh, (1.25 * h) / fw));
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  render() {
    this.controls.update();
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
