/* Tiny WebAudio synth - every sound is generated, nothing is downloaded. */
(function (BPT) {
  'use strict';

  class Audio {
    constructor() {
      this.ctx = null; this.master = null; this.enabled = true;
      this.volume = 0.6; this.lastPop = 0; this.voices = 0;
    }
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise(1.0);
      this.startWind();
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
    makeNoise(sec) {
      const n = Math.floor(this.ctx.sampleRate * sec);
      const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    startWind() {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.6;
      const g = c.createGain(); g.gain.value = 0.035;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.09;
      const lg = c.createGain(); lg.gain.value = 0.02;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      this.wind = g;
    }
    now() { return this.ctx.currentTime; }

    pop(tier, big) {
      if (!this.enabled || !this.ctx) return;
      const t = this.now();
      if (t - this.lastPop < 0.022) return;
      this.lastPop = t;
      const c = this.ctx;
      const base = big ? 90 : 260 * Math.pow(0.9, tier || 0);
      // body: fast pitch-drop sine
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * 3.2, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.09);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(big ? 0.55 : 0.28, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.5 : 0.16));
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + (big ? 0.6 : 0.25));
      // burst: filtered noise
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.setValueAtTime(big ? 700 : 1900, t);
      f.frequency.exponentialRampToValueAtTime(big ? 180 : 420, t + 0.13);
      f.Q.value = 1.1;
      const sg = c.createGain();
      sg.gain.setValueAtTime(big ? 0.5 : 0.22, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.4 : 0.13));
      s.connect(f); f.connect(sg); sg.connect(this.master);
      s.start(t); s.stop(t + 0.5);
    }

    blip(freq, dur, type, gain, slideTo) {
      if (!this.enabled || !this.ctx) return;
      const c = this.ctx, t = this.now();
      const o = c.createOscillator(); o.type = type || 'triangle';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.15, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    chord(freqs, dur, gain, type) {
      freqs.forEach((f, i) => setTimeout(() => this.blip(f, dur, type || 'triangle', gain || 0.12), i * 55));
    }

    buy()    { this.chord([523.25, 783.99, 1046.5], 0.22, 0.13); }
    deny()   { this.blip(150, 0.16, 'square', 0.09, 90); }
    achieve(){ this.chord([659.25, 830.61, 987.77, 1318.5], 0.32, 0.11); }
    gold()   { this.chord([880, 1108.7, 1318.5, 1760], 0.4, 0.13, 'sine'); }
    boss()   { this.blip(70, 1.1, 'sawtooth', 0.16, 42); }
    rebirth(){ this.chord([261.6, 329.6, 392, 523.3, 659.3, 784], 0.55, 0.1, 'sine'); }
    travel() { this.blip(220, 0.5, 'sine', 0.14, 880); }
    step()   { this.blip(90 + Math.random() * 30, 0.05, 'sine', 0.03); }
  }

  BPT.Audio = Audio;
})(window.BPT = window.BPT || {});
