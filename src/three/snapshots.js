// Still pictures of each vehicle shape for the Hangar and the Vehicle card. Rendered once per shape
// with a small offscreen renderer (same meshes as the vehicle camera), then cached as image URLs.
import * as THREE from 'three';
import { buildBody } from './vehicleView.js';

const W = 480, H = 300;
const cache = new Map();
let renderer = null;

function studio() {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0x9fb0c8, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(1, 5, -4);
  const rim = new THREE.DirectionalLight(0x7cc4ff, 2.2);
  rim.position.set(-5, 1.5, 3);
  scene.add(key, rim);
  return scene;
}

export function vehicleSnapshot(shape) {
  if (cache.has(shape)) return cache.get(shape);
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  }
  const hull = new THREE.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.55, metalness: 0.15 });
  const shield = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.7, metalness: 0.1 });
  const { group, tilt } = buildBody(shape, hull, shield);
  // A mostly side-on view from slightly above and in front: the classic silhouette with the heat shield edge showing.
  group.rotation.set(0, 0, tilt || -0.2);
  const scene = studio();
  scene.add(group);

  const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
  // The bounding sphere is loose for these flat shapes, so frame a little inside it.
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(15))) * 0.78;
  camera.position.copy(sphere.center).add(new THREE.Vector3(0.38, 0.3, -1).normalize().multiplyScalar(dist));
  camera.lookAt(sphere.center);
  // Soft fill from just above the camera so the side facing us is never black.
  const fill = new THREE.DirectionalLight(0xdfe8f5, 0.9);
  fill.position.copy(camera.position).add(new THREE.Vector3(0, dist * 0.5, 0));
  scene.add(fill);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  group.traverse((o) => o.geometry && o.geometry.dispose());
  hull.dispose();
  shield.dispose();
  cache.set(shape, url);
  return url;
}

// Draw every shape up front, then release the extra WebGL context.
export function warmSnapshots(shapes) {
  for (const s of shapes) vehicleSnapshot(s);
  if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer = null; }
}
