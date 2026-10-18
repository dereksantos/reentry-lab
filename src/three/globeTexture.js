// Planet surface textures drawn into a canvas at startup, so the app needs no image downloads.
// Earth uses Natural Earth land polygons (world-atlas, 50m); Mars is procedural.
import * as THREE from 'three';
import { feature } from 'topojson-client';
import land50 from 'world-atlas/land-50m.json';

const W = 4096, H = 2048;
const px = (lon) => ((lon + 180) / 360) * W;
const py = (lat) => ((90 - lat) / 180) * H;

function graticule(ctx, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) { ctx.beginPath(); ctx.moveTo(px(lon), 0); ctx.lineTo(px(lon), H); ctx.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { ctx.beginPath(); ctx.moveTo(0, py(lat)); ctx.lineTo(W, py(lat)); ctx.stroke(); }
}

export function earthTexture() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#0d2236'); sea.addColorStop(0.5, '#0a1d33'); sea.addColorStop(1, '#0d2236');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);
  graticule(ctx, 'rgba(120,160,200,0.10)');

  const geo = feature(land50, land50.objects.land);
  ctx.beginPath();
  for (const f of geo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        let prevLon = null;
        ring.forEach(([lon, lat], i) => {
          // Break rings that jump across the antimeridian instead of drawing a line across the map.
          if (i === 0 || (prevLon !== null && Math.abs(lon - prevLon) > 180)) ctx.moveTo(px(lon), py(lat));
          else ctx.lineTo(px(lon), py(lat));
          prevLon = lon;
        });
        ctx.closePath();
      }
    }
  }
  ctx.fillStyle = '#2a3d3a';
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(170, 205, 190, 0.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Polar ice hint
  ctx.fillStyle = 'rgba(210, 225, 235, 0.35)';
  ctx.fillRect(0, py(-78), W, H - py(-78));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function marsTexture() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8c4a2c';
  ctx.fillRect(0, 0, W, H);
  // Deterministic pseudo-random so the planet looks the same every load.
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W, y = H * (0.1 + 0.8 * rnd()), r = 20 + rnd() * 260;
    const dark = rnd() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? 'rgba(60,25,15,0.22)' : 'rgba(200,120,80,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 400; i++) {
    const x = rnd() * W, y = H * (0.08 + 0.84 * rnd()), r = 3 + Math.pow(rnd(), 3) * 60;
    ctx.strokeStyle = 'rgba(40,18,10,0.35)'; ctx.lineWidth = Math.max(1, r * 0.15);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(235, 225, 215, 0.6)';
  ctx.fillRect(0, 0, W, py(82)); ctx.fillRect(0, py(-84), W, H);
  graticule(ctx, 'rgba(255,220,200,0.08)');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
