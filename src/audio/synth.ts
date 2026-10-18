/**
 * Procedural sound effects: everything is synthesised from noise and oscillators, so the
 * game ships no audio files. Each function schedules one sound on `ctx` starting at
 * `when` (AudioContext time) into `out`, with `gain` loudness.
 */
export interface Bus {
  ctx: AudioContext;
  noise: AudioBuffer;
}

/** Two seconds of brown-ish noise, looped or sliced by the effects. */
export function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.04 * white) / 1.04; // leaky integrator: warmer than white noise
    data[i] = white * 0.35 + last * 6;
  }
  return buffer;
}

const burst = (bus: Bus, out: AudioNode, when: number, dur: number, type: BiquadFilterType, from: number, to: number, gain: number): void => {
  const src = bus.ctx.createBufferSource();
  src.buffer = bus.noise;
  const filter = bus.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), when + dur);
  const env = bus.ctx.createGain();
  env.gain.setValueAtTime(gain, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + dur);
  src.connect(filter).connect(env).connect(out);
  src.start(when, Math.random() * 1.5, dur + 0.05);
  src.stop(when + dur + 0.1);
};

const tone = (bus: Bus, out: AudioNode, when: number, dur: number, type: OscillatorType, from: number, to: number, gain: number): void => {
  const osc = bus.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 10), when + dur);
  const env = bus.ctx.createGain();
  env.gain.setValueAtTime(gain, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(env).connect(out);
  osc.start(when);
  osc.stop(when + dur + 0.05);
};

/** A cannon: a sharp crack of noise falling in pitch over a deep thump. */
export function cannon(bus: Bus, out: AudioNode, when: number, gain: number): void {
  burst(bus, out, when, 0.3, 'lowpass', 2600, 180, gain);
  tone(bus, out, when, 0.45, 'sine', 95, 32, gain * 0.9);
}

/** A ball splintering wood: a short bright crack and a dull knock. */
export function hit(bus: Bus, out: AudioNode, when: number, gain: number): void {
  burst(bus, out, when, 0.14, 'bandpass', 2200, 900, gain);
  tone(bus, out, when, 0.22, 'triangle', 150, 55, gain * 0.8);
}

/** A column of water coming down. */
export function splash(bus: Bus, out: AudioNode, when: number, gain: number): void {
  burst(bus, out, when, 0.5, 'highpass', 1400, 500, gain * 0.7);
}

/** A hull going under: a long groan, then bubbling. */
export function sinking(bus: Bus, out: AudioNode, when: number, gain: number): void {
  tone(bus, out, when, 3.2, 'sawtooth', 75, 28, gain * 0.35);
  burst(bus, out, when, 3.5, 'lowpass', 500, 80, gain * 0.7);
  for (let i = 0; i < 6; i++) burst(bus, out, when + 0.6 + i * 0.45, 0.2, 'bandpass', 700 + i * 120, 300, gain * 0.25);
}

export interface Ambience {
  /** Wind (m/s) and ship speed (m/s) set the loudness of wind and hull water. */
  set(wind: number, speed: number): void;
  stop(): void;
}

/** Looping sea, wind and hull-water layers whose gains follow the conditions. */
export function startAmbience(bus: Bus, out: AudioNode): Ambience {
  const layer = (type: BiquadFilterType, freq: number, q: number): { gain: GainNode; src: AudioBufferSourceNode } => {
    const src = bus.ctx.createBufferSource();
    src.buffer = bus.noise;
    src.loop = true;
    const filter = bus.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = bus.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(out);
    src.start(0, Math.random() * 1.5);
    return { gain, src };
  };
  const sea = layer('lowpass', 420, 0.5);
  const wind = layer('bandpass', 750, 0.6);
  const hull = layer('lowpass', 1300, 0.4);
  const t = (): number => bus.ctx.currentTime;
  return {
    set(windSpeed, speed): void {
      sea.gain.gain.setTargetAtTime(0.09 + 0.012 * windSpeed, t(), 0.6);
      wind.gain.gain.setTargetAtTime(Math.min(0.012 * windSpeed * windSpeed / 4, 0.28), t(), 0.6);
      hull.gain.gain.setTargetAtTime(Math.min(speed * 0.012, 0.16), t(), 0.5);
    },
    stop(): void {
      for (const l of [sea, wind, hull]) {
        l.gain.gain.setTargetAtTime(0, t(), 0.1);
        l.src.stop(t() + 0.6);
      }
    },
  };
}
