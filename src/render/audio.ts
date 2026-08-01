/**
 * Sound.
 *
 * Every cue is synthesised with the Web Audio API rather than loaded from a
 * file. That is a deliberate choice, not a shortcut: shipping real audio would
 * mean either licensed assets I cannot legitimately obtain here, or a large
 * binary payload in the repository. Synthesis costs nothing to download,
 * nothing to license, and lets each cue be tuned as parameters rather than
 * re-exported from a DAW.
 *
 * The context is created lazily on the first user gesture, because browsers
 * refuse to start one otherwise, and every cue is a no-op until then. Nothing
 * here can throw into the render loop — audio failing must never take the
 * game down with it.
 */

export type SoundCue =
  | 'deploy'
  | 'hit'
  | 'splash'
  | 'death'
  | 'spell'
  | 'ability'
  | 'towerFall'
  | 'uiTap'
  | 'countdown'
  | 'victory'
  | 'defeat';

interface ToneSpec {
  type: OscillatorType;
  /** Start and end frequency in Hz; the sweep between them is the character. */
  from: number;
  to: number;
  duration: number;
  gain: number;
  /** Mixes in a burst of filtered noise — impacts need it, tones do not. */
  noise?: number;
  /** Low-pass cutoff applied to the noise component. */
  noiseCutoff?: number;
}

/**
 * Cue definitions.
 *
 * Impacts are short, noisy and downward-sweeping; UI is a clean short blip;
 * outcomes are longer and tonal. Keeping them in one table makes the mix
 * adjustable in one place instead of scattered through the renderer.
 */
const CUES: Record<SoundCue, ToneSpec[]> = {
  deploy: [{ type: 'sine', from: 220, to: 440, duration: 0.16, gain: 0.18 }],
  hit: [{ type: 'square', from: 180, to: 90, duration: 0.06, gain: 0.05, noise: 0.05, noiseCutoff: 2600 }],
  splash: [{ type: 'sawtooth', from: 240, to: 70, duration: 0.18, gain: 0.09, noise: 0.12, noiseCutoff: 1800 }],
  death: [{ type: 'triangle', from: 300, to: 80, duration: 0.22, gain: 0.07, noise: 0.05, noiseCutoff: 1200 }],
  spell: [
    { type: 'sawtooth', from: 420, to: 60, duration: 0.34, gain: 0.14, noise: 0.2, noiseCutoff: 1400 },
    { type: 'sine', from: 90, to: 40, duration: 0.4, gain: 0.12 },
  ],
  ability: [
    { type: 'square', from: 520, to: 880, duration: 0.16, gain: 0.1 },
    { type: 'sine', from: 880, to: 1320, duration: 0.2, gain: 0.08 },
  ],
  towerFall: [
    { type: 'sawtooth', from: 160, to: 30, duration: 0.9, gain: 0.2, noise: 0.34, noiseCutoff: 900 },
    { type: 'sine', from: 70, to: 25, duration: 1.1, gain: 0.18 },
  ],
  uiTap: [{ type: 'sine', from: 660, to: 660, duration: 0.05, gain: 0.09 }],
  countdown: [{ type: 'square', from: 520, to: 520, duration: 0.12, gain: 0.12 }],
  victory: [
    { type: 'square', from: 523, to: 523, duration: 0.16, gain: 0.14 },
    { type: 'square', from: 659, to: 659, duration: 0.16, gain: 0.14 },
    { type: 'square', from: 784, to: 1046, duration: 0.5, gain: 0.16 },
  ],
  defeat: [
    { type: 'triangle', from: 440, to: 415, duration: 0.3, gain: 0.14 },
    { type: 'triangle', from: 330, to: 220, duration: 0.7, gain: 0.14 },
  ],
};

/** Cues that arrive in floods; rate-limited so a swarm fight is not a buzz. */
const THROTTLE_MS: Partial<Record<SoundCue, number>> = {
  hit: 55,
  death: 90,
  splash: 80,
};

class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastPlayed = new Map<SoundCue, number>();
  private enabled = true;
  private volume = 0.7;
  private elapsed = 0;

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? this.volume : 0;
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  /** Must be called from a user gesture, or the context stays suspended. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    try {
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;

      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.context.destination);

      // One second of white noise, reused by every impact cue.
      const frames = this.context.sampleRate;
      this.noiseBuffer = this.context.createBuffer(1, frames, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      // No audio available; every play() below becomes a no-op.
      this.context = null;
    }
  }

  /** Advance the throttle clock. Driven by the render loop's delta. */
  tick(deltaMs: number): void {
    this.elapsed += deltaMs;
  }

  play(cue: SoundCue, intensity = 1): void {
    if (!this.enabled || !this.context || !this.master) return;

    const throttle = THROTTLE_MS[cue];
    if (throttle !== undefined) {
      const last = this.lastPlayed.get(cue) ?? -Infinity;
      if (this.elapsed - last < throttle) return;
      this.lastPlayed.set(cue, this.elapsed);
    }

    const specs = CUES[cue];
    if (!specs) return;

    const now = this.context.currentTime;
    let offset = 0;

    for (const spec of specs) {
      this.playTone(spec, now + offset, intensity);
      // Multi-part cues play as a sequence, which is what makes the victory
      // fanfare an arpeggio rather than a chord.
      offset += specs.length > 1 ? spec.duration * 0.75 : 0;
    }
  }

  private playTone(spec: ToneSpec, at: number, intensity: number): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;

    const gain = ctx.createGain();
    const peak = spec.gain * Math.max(0.2, Math.min(1.6, intensity));
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.duration);
    gain.connect(master);

    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from, at);
    if (spec.to !== spec.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to), at + spec.duration);
    }
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + spec.duration + 0.02);

    if (!spec.noise || !this.noiseBuffer) return;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.noiseCutoff ?? 2000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(spec.noise * intensity, at);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + spec.duration);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(at);
    noise.stop(at + spec.duration + 0.02);
  }
}

export const audio = new AudioEngine();

/** Map a simulation event to its cue. Returns null for anything silent. */
export function cueForEvent(type: string, splash?: boolean): SoundCue | null {
  switch (type) {
    case 'hit':
      return splash ? 'splash' : 'hit';
    case 'death':
      return 'death';
    case 'spell':
      return 'spell';
    case 'ability':
      return 'ability';
    case 'towerDestroyed':
      return 'towerFall';
    default:
      return null;
  }
}
