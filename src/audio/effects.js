// Web Audio effect chains used for offline processing and previews.
export function makeIR(ctx, { dur = 2, decay = 2.5, predelay = 0.02, damp = 0.5, early = [], bright = 0 }) {
  const sr = ctx.sampleRate, n = Math.round((dur + predelay) * sr), ir = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0; const p0 = Math.round(predelay * sr);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr; const env = Math.pow(1 - t / dur, decay) * Math.exp(-t * decay * 0.6);
      const a = Math.min(0.97, damp * (0.3 + t / dur)); // more damping as the tail goes on
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = (lp * (1 - bright) + (Math.random() * 2 - 1) * bright * 0.5) * env;
    }
    for (const [t, g] of early) { const i = Math.round((predelay + t * (c ? 1.07 : 1)) * sr); if (i < n) d[i] += g * (c ? 0.9 : 1); }
  }
  return ir;
}
export const REVERBS = {
  room: { label: 'غرفة', dur: 0.7, decay: 3, predelay: 0.008, damp: 0.55, early: [[0.011, 0.5], [0.019, 0.35], [0.027, 0.25]] },
  hall: { label: 'قاعة', dur: 2.6, decay: 2.2, predelay: 0.025, damp: 0.5, early: [[0.021, 0.4], [0.037, 0.3], [0.052, 0.25], [0.071, 0.2]] },
  mosque: { label: 'مسجد', dur: 4.8, decay: 1.6, predelay: 0.045, damp: 0.72, early: [[0.035, 0.45], [0.06, 0.38], [0.089, 0.3], [0.12, 0.26], [0.16, 0.2]] },
  space: { label: 'فضاء', dur: 7.5, decay: 1.1, predelay: 0.09, damp: 0.25, bright: 0.25 },
};
export const EQ_PRESETS = {
  clear: { label: 'صوت أوضح', bands: [['highpass', 90, 0.7], ['peaking', 250, 1, -2], ['peaking', 3000, 1, 4], ['highshelf', 9000, 0.7, 3]] },
  bass: { label: 'باص أقوى', bands: [['lowshelf', 110, 0.7, 8], ['peaking', 320, 1, -1.5]] },
  phone: { label: 'صوت هاتف', bands: [['highpass', 400, 0.9], ['lowpass', 3400, 0.9], ['peaking', 1500, 1, 6]] },
  radio: { label: 'راديو قديم', bands: [['highpass', 500, 0.8], ['lowpass', 3000, 0.8], ['peaking', 1200, 1.2, 5]], drive: 3 },
};
export const EQ_BANDS = [60, 250, 1000, 4000, 12000];
function biquads(ctx, input, bands) {
  let node = input;
  for (const [type, f, Q, gain = 0] of bands) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gain; node.connect(b); node = b; }
  return node;
}
function shaper(ctx, input, drive) {
  const ws = ctx.createWaveShaper(), n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / Math.tanh(drive); }
  ws.curve = c; ws.oversample = '2x'; input.connect(ws); return ws;
}
function mixWet(ctx, input, wetNode, mix) {
  const out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  dry.gain.value = 1 - mix * 0.5; wet.gain.value = mix; input.connect(dry); dry.connect(out); wetNode.connect(wet); wet.connect(out); return out;
}
/** a user's own impulse response (recorded room) → AudioBuffer, normalised so loud IR files don't blow up */
export function irBuffer(ctx, pcm) {
  const n = pcm.channels[0].length, b = ctx.createBuffer(Math.min(2, pcm.channels.length), n, pcm.sampleRate);
  let e = 0; for (const c of pcm.channels) for (let i = 0; i < n; i++) e += c[i] * c[i];
  const k = e > 0 ? 1 / Math.sqrt(e / pcm.channels.length) * 0.35 : 1;
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c), s = pcm.channels[c]; for (let i = 0; i < n; i++) d[i] = s[i] * k; }
  return b;
}
/** build a chain(ctx, input) → output for an effect spec */
export function chainFor(spec) {
  return (ctx, input) => {
    switch (spec.type) {
      case 'gain': { const g = ctx.createGain(); g.gain.value = Math.pow(10, spec.db / 20); input.connect(g); return g; }
      case 'eq': {
        if (spec.preset && spec.preset !== 'custom') { const p = EQ_PRESETS[spec.preset]; let n = biquads(ctx, input, p.bands); if (p.drive) n = shaper(ctx, n, p.drive); return n; }
        return biquads(ctx, input, EQ_BANDS.map((f, i) => [i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking', f, 1, spec.gains[i] || 0]));
      }
      case 'comp': {
        const c = ctx.createDynamicsCompressor(); c.threshold.value = spec.threshold; c.ratio.value = spec.ratio; c.knee.value = 6; c.attack.value = 0.008; c.release.value = 0.25;
        input.connect(c); const g = ctx.createGain(); g.gain.value = Math.pow(10, spec.makeup / 20); c.connect(g); return g;
      }
      case 'echo': {
        const d = ctx.createDelay(5); d.delayTime.value = spec.time; const fb = ctx.createGain(); fb.gain.value = spec.feedback;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
        input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
        return mixWet(ctx, input, lp, spec.mix);
      }
      case 'reverb': { const cv = ctx.createConvolver(); cv.buffer = spec.ir ? irBuffer(ctx, spec.ir) : makeIR(ctx, REVERBS[spec.preset] || REVERBS.hall); input.connect(cv); return mixWet(ctx, input, cv, spec.mix); }
      default: return input;
    }
  };
}
