// Entry sound for the ride-along view, synthesized live from the run (no audio files):
//   roar   — low-passed noise that follows dynamic pressure (the air hitting the vehicle)
//   hiss   — band-passed noise that follows heat flux (the plasma sheath)
//   rumble — low oscillators that follow deceleration
//   wind   — soft noise once the vehicle is slow and low, under the parachutes
//   thump  — a short low hit for each parachute opening and for touchdown
// Browsers only allow audio after a click, so nothing is created until the user turns sound on.

export class EntrySound {
  constructor() {
    this.ac = null;
    this.on = false;
    this.wasPlaying = null;
  }

  // Delay from scheduling a sound to it leaving the speakers, in ms (Bluetooth headphones add most of it).
  // null if the browser doesn't report it.
  latencyMs() {
    if (!this.ac) return null;
    const s = (this.ac.baseLatency || 0) + (this.ac.outputLatency || 0);
    return s > 0 ? Math.round(s * 1000) : null;
  }

  // Returns whether sound is now on.
  toggle() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ac = new AC({ latencyHint: 'interactive' });
      this.build();
      this.on = true;
    } else if (this.on) {
      this.ac.suspend();
      this.on = false;
    } else {
      this.ac.resume();
      this.on = true;
    }
    return this.on;
  }

  pause() {
    if (this.ac && this.on) this.ac.suspend();
  }

  resume() {
    if (this.ac && this.on) this.ac.resume();
  }

  build() {
    const ac = this.ac;
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const gain = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
    const filter = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    const master = gain(0.8);
    master.connect(ac.destination);
    const roarF = filter('lowpass', 300, 0.7), roar = gain(0);
    noise().connect(roarF).connect(roar).connect(master);
    const hissF = filter('bandpass', 2800, 0.8), hiss = gain(0);
    noise().connect(hissF).connect(hiss).connect(master);
    const windF = filter('lowpass', 650, 0.5), wind = gain(0);
    noise().connect(windF).connect(wind).connect(master);
    const rumble = gain(0);
    rumble.connect(master);
    const o1 = ac.createOscillator();
    o1.frequency.value = 34;
    o1.connect(rumble);
    o1.start();
    const o2 = ac.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 51;
    o2.connect(rumble);
    o2.start();
    this.n = { buf, master, roar, roarF, hiss, hissF, wind, rumble, o1 };
  }

  // s: playback sample; peaks: { q, qDyn, g } of the run; playing: whether time is moving.
  update(s, peaks, playing) {
    const n = this.n;
    if (!n || !this.on || !s) return;
    // Smooth changes while the run plays; snap within ~10 ms when play or pause is pressed.
    const snapped = playing !== this.wasPlaying;
    this.wasPlaying = playing;
    const t = this.ac.currentTime, k = snapped ? 0.004 : 0.04;
    const qn = Math.min(1, s.q / peaks.q), dn = Math.min(1, s.qDyn / peaks.qDyn), gn = Math.min(1, s.g / peaks.g);
    const down = s.alt < 1;
    // Paused: keep a quieter bed of the current moment so scrubbing still sounds like something.
    const live = down ? 0 : playing ? 1 : 0.4;
    n.roar.gain.setTargetAtTime(live * (0.03 + 0.55 * Math.pow(dn, 0.7) + 0.2 * qn), t, k);
    n.roarF.frequency.setTargetAtTime(160 + 2600 * Math.pow(Math.max(qn, dn), 0.8), t, k);
    n.hiss.gain.setTargetAtTime(live * 0.22 * Math.pow(qn, 1.2) * (0.6 + 0.4 * Math.random()), t, 0.03);
    n.hissF.frequency.setTargetAtTime(1800 + 2400 * qn, t, k);
    n.rumble.gain.setTargetAtTime(live * 0.35 * Math.pow(gn, 0.8), t, k);
    n.o1.frequency.setTargetAtTime(30 + 14 * gn, t, k);
    const slow = Math.min(1, Math.max(0, (800 - s.vRel) / 750));
    n.wind.gain.setTargetAtTime(live * 0.16 * slow * slow, t, snapped ? 0.004 : 0.15);
  }

  thump(strength) {
    const n = this.n;
    if (!n || !this.on) return;
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8 * strength, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(n.master);
    o.start(t);
    o.stop(t + 1);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), ng = ac.createGain();
    src.buffer = n.buf;
    f.type = 'lowpass';
    f.frequency.value = 900;
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f).connect(ng).connect(n.master);
    src.start(t);
    src.stop(t + 0.6);
  }
}
