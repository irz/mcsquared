import type { NumberedSampleId } from "../types";

type AudioContextConstructor = typeof AudioContext;

const ACTIVE_RELEASE_SECONDS = 1.5;

export class SampleEngine {
  private context: AudioContext | null = null;
  private activeSources = new Set<AudioScheduledSourceNode>();

  async start() {
    const context = this.getContext();

    if (context.state === "suspended") {
      await context.resume();
    }
  }

  playSample(sampleId: NumberedSampleId) {
    const context = this.getContext();
    const now = context.currentTime;

    switch (sampleId) {
      case 1:
        this.playKick(context, now);
        break;
      case 2:
        this.playSnare(context, now);
        break;
      case 3:
        this.playHat(context, now);
        break;
      case 4:
        this.playClap(context, now);
        break;
      case 5:
        this.playTom(context, now);
        break;
      case 6:
        this.playPluck(context, now);
        break;
      case 7:
        this.playBell(context, now);
        break;
      case 8:
        this.playChord(context, now);
        break;
    }
  }

  stopAll() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Sources may already be stopped by their natural envelope.
      }
    }

    this.activeSources.clear();
  }

  private getContext() {
    if (this.context) {
      return this.context;
    }

    const windowWithWebkit = window as typeof window & {
      webkitAudioContext?: AudioContextConstructor;
    };
    const Constructor = window.AudioContext ?? windowWithWebkit.webkitAudioContext;

    if (!Constructor) {
      throw new Error("Web Audio is not supported in this browser.");
    }

    this.context = new Constructor();
    return this.context;
  }

  private track(source: AudioScheduledSourceNode) {
    this.activeSources.add(source);
    source.addEventListener("ended", () => {
      this.activeSources.delete(source);
    });
  }

  private makeGain(context: AudioContext, start: number, peak: number, duration: number) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    gain.connect(context.destination);
    window.setTimeout(() => gain.disconnect(), (duration + ACTIVE_RELEASE_SECONDS) * 1000);
    return gain;
  }

  private playOscillator(
    context: AudioContext,
    start: number,
    type: OscillatorType,
    frequency: number,
    peak: number,
    duration: number,
    destination?: AudioNode
  ) {
    const oscillator = context.createOscillator();
    const gain = this.makeGain(context, start, peak, duration);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.connect(destination ?? gain);
    if (destination) {
      destination.connect(gain);
    }
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    this.track(oscillator);
    return oscillator;
  }

  private playNoise(
    context: AudioContext,
    start: number,
    peak: number,
    duration: number,
    filterType?: BiquadFilterType,
    frequency = 1000
  ) {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const gain = this.makeGain(context, start, peak, duration);
    source.buffer = buffer;

    if (filterType) {
      const filter = context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(frequency, start);
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }

    source.start(start);
    source.stop(start + duration);
    this.track(source);
  }

  private playKick(context: AudioContext, now: number) {
    const oscillator = this.playOscillator(context, now, "sine", 120, 0.95, 0.42);
    oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.16);
  }

  private playSnare(context: AudioContext, now: number) {
    this.playNoise(context, now, 0.42, 0.18, "bandpass", 1800);
    this.playOscillator(context, now, "triangle", 180, 0.18, 0.12);
  }

  private playHat(context: AudioContext, now: number) {
    this.playNoise(context, now, 0.24, 0.07, "highpass", 7000);
  }

  private playClap(context: AudioContext, now: number) {
    this.playNoise(context, now, 0.22, 0.045, "bandpass", 1600);
    this.playNoise(context, now + 0.032, 0.2, 0.045, "bandpass", 1700);
    this.playNoise(context, now + 0.064, 0.18, 0.09, "bandpass", 1500);
  }

  private playTom(context: AudioContext, now: number) {
    const oscillator = this.playOscillator(context, now, "sine", 190, 0.65, 0.34);
    oscillator.frequency.exponentialRampToValueAtTime(82, now + 0.24);
  }

  private playPluck(context: AudioContext, now: number) {
    this.playOscillator(context, now, "sawtooth", 330, 0.22, 0.36);
    this.playOscillator(context, now, "triangle", 660, 0.1, 0.28);
  }

  private playBell(context: AudioContext, now: number) {
    this.playOscillator(context, now, "sine", 880, 0.28, 0.48);
    this.playOscillator(context, now, "sine", 1320, 0.12, 0.42);
  }

  private playChord(context: AudioContext, now: number) {
    this.playOscillator(context, now, "triangle", 261.63, 0.16, 0.7);
    this.playOscillator(context, now, "triangle", 329.63, 0.13, 0.68);
    this.playOscillator(context, now, "triangle", 392, 0.11, 0.66);
  }
}
