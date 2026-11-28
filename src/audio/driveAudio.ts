import {
  computeDrivetrainAudioMix,
  computeFlightAudioMix,
  computeWalkAudioMix,
  type DrivetrainAudioMix,
  type FlightSoundPhase,
} from './engineSoundModel';

export interface DriveAudioTelemetry {
  speedKmh: number;
  travelMode: 'DRIVING' | 'WALKING';
  isActive: boolean;
  gasPressed?: boolean;
  brakePressed?: boolean;
}

class DriveAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  // Persistent continuous synthesis nodes (created once per AudioContext, zero leak)
  private rigInitialized = false;
  private masterDriveGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineLowpass: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private currentGearStep = 1;
  private lastTelemetryAt = 0;
  private lastWalkStepAt = 0;
  private lastMix: DrivetrainAudioMix = computeDrivetrainAudioMix({
    speedKmh: 0,
    prevGearStep: 1,
    travelMode: 'DRIVING',
    isActive: false,
  });

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.silenceDriveRig();
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.silenceDriveRig();
    } else {
      this.unlock();
    }
    return this.muted;
  }

  public getDriveMixSnapshot(): DrivetrainAudioMix {
    return this.lastMix;
  }

  public unlock(): void {
    const ctx = this.ensureContext(true);
    if (ctx && ctx.state === 'running' && !this.rigInitialized) {
      this.initDriveRig(ctx);
    }
  }

  private ensureContext(allowCreate = true): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      if (!allowCreate) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createPinkishNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Paul Kellet pink-noise approximation for smooth natural wind & tire roar
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      data[i] = Math.max(-1, Math.min(1, pink));
    }

    return buffer;
  }

  private initDriveRig(ctx: AudioContext): void {
    if (this.rigInitialized) return;
    this.rigInitialized = true;

    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.connect(ctx.destination);
    this.masterDriveGain = master;

    // 1) Engine Dual-Oscillator Synth -> Warm Cabin Lowpass -> Engine Gain
    const engineLowpass = ctx.createBiquadFilter();
    engineLowpass.type = 'lowpass';
    engineLowpass.frequency.setValueAtTime(190, now);
    engineLowpass.Q.setValueAtTime(1.4, now);

    const engineGain = ctx.createGain();
    engineGain.gain.setValueAtTime(0, now);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(28, now);

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(56, now);

    const osc2SubGain = ctx.createGain();
    osc2SubGain.gain.setValueAtTime(0.45, now);

    osc1.connect(engineLowpass);
    osc2.connect(osc2SubGain);
    osc2SubGain.connect(engineLowpass);
    engineLowpass.connect(engineGain);
    engineGain.connect(master);

    osc1.start(now);
    osc2.start(now);

    this.engineOsc1 = osc1;
    this.engineOsc2 = osc2;
    this.engineLowpass = engineLowpass;
    this.engineGain = engineGain;

    // 2) Aerodynamic Wind Noise -> Speed-Swept Bandpass -> Wind Gain
    const windBuffer = this.createPinkishNoiseBuffer(ctx);
    const windSource = ctx.createBufferSource();
    windSource.buffer = windBuffer;
    windSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.setValueAtTime(260, now);
    windFilter.Q.setValueAtTime(0.85, now);

    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0, now);

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSource.start(now);

    this.windSource = windSource;
    this.windFilter = windFilter;
    this.windGain = windGain;
  }

  private triggerGearShiftPulse(
    ctx: AudioContext,
    direction: 'up' | 'down'
  ): void {
    if (!this.masterDriveGain || this.muted) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const startFreq = direction === 'up' ? 115 : 85;
    const endFreq = direction === 'up' ? 62 : 128;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.085);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.032, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc.connect(gain);
    gain.connect(this.masterDriveGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  private triggerWalkFootstep(ctx: AudioContext): void {
    if (!this.masterDriveGain || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.055);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.022, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(this.masterDriveGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  private silenceDriveRig(): void {
    if (!this.ctx || !this.masterDriveGain) return;
    const now = this.ctx.currentTime;
    this.masterDriveGain.gain.setTargetAtTime(0, now, 0.05);
    this.engineGain?.gain.setTargetAtTime(0, now, 0.05);
    this.windGain?.gain.setTargetAtTime(0, now, 0.05);
  }

  /**
   * Updates continuous RPM, gear shift, walk cadence, and wind noise mixing smoothly at ~20Hz.
   */
  public updateDriveTelemetry(telemetry: DriveAudioTelemetry): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastTelemetryAt < 48 && telemetry.isActive) {
      return;
    }
    this.lastTelemetryAt = nowMs;

    const mix = computeDrivetrainAudioMix({
      speedKmh: telemetry.speedKmh,
      prevGearStep: this.currentGearStep,
      travelMode: telemetry.travelMode,
      isActive: telemetry.isActive,
      gasPressed: telemetry.gasPressed,
      brakePressed: telemetry.brakePressed,
    });

    if (mix.gearStep > 0) {
      this.currentGearStep = mix.gearStep;
    } else if (!telemetry.isActive) {
      this.currentGearStep = 1;
    }
    this.lastMix = mix;

    if (typeof document !== 'undefined') {
      document.body.dataset.audioRpm = String(mix.rpm);
      document.body.dataset.audioGear = String(mix.gearStep);
      document.body.dataset.audioWind = String(mix.windGain);
    }

    if (this.muted || !telemetry.isActive) {
      this.silenceDriveRig();
      return;
    }

    const ctx = this.ensureContext(false);
    if (!ctx || ctx.state !== 'running') return;
    if (!this.rigInitialized) {
      this.initDriveRig(ctx);
    }
    if (
      !this.masterDriveGain ||
      !this.engineOsc1 ||
      !this.engineOsc2 ||
      !this.engineLowpass ||
      !this.engineGain ||
      !this.windFilter ||
      !this.windGain
    ) {
      return;
    }

    const now = ctx.currentTime;
    const shiftTimeConstant = mix.shifted ? 0.085 : 0.06;

    this.masterDriveGain.gain.setTargetAtTime(1, now, 0.06);
    this.engineOsc1.frequency.setTargetAtTime(
      mix.engineFundamentalHz,
      now,
      shiftTimeConstant
    );
    this.engineOsc2.frequency.setTargetAtTime(
      mix.engineHarmonicHz,
      now,
      shiftTimeConstant
    );
    this.engineLowpass.frequency.setTargetAtTime(mix.engineLowpassHz, now, 0.08);
    this.engineGain.gain.setTargetAtTime(mix.engineGain, now, 0.07);

    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setTargetAtTime(mix.windFilterHz, now, 0.09);
    this.windFilter.Q.setTargetAtTime(mix.windFilterQ, now, 0.09);
    this.windGain.gain.setTargetAtTime(mix.windGain, now, 0.09);

    if (telemetry.travelMode === 'WALKING') {
      const walkMix = computeWalkAudioMix(telemetry.speedKmh, telemetry.isActive);
      if (walkMix.stepIntervalMs > 0 && nowMs - this.lastWalkStepAt >= walkMix.stepIntervalMs) {
        this.lastWalkStepAt = nowMs;
        this.triggerWalkFootstep(ctx);
      }
    } else if (mix.shifted) {
      this.triggerGearShiftPulse(ctx, mix.shifted);
    }
  }

  /**
   * Modulates jet cabin pink-noise lowpass + turbine hum during 3D Flight mode.
   */
  public updateFlightTelemetry(params: {
    phase: FlightSoundPhase;
    speedKmh: number;
    isActive: boolean;
  }): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastTelemetryAt < 70 && params.isActive) {
      return;
    }
    this.lastTelemetryAt = nowMs;

    const flightMix = computeFlightAudioMix(
      params.phase,
      params.speedKmh,
      params.isActive
    );

    if (typeof document !== 'undefined') {
      document.body.dataset.audioWind = String(flightMix.cabinGain);
    }

    if (this.muted || !params.isActive) {
      this.silenceDriveRig();
      return;
    }

    const ctx = this.ensureContext(false);
    if (!ctx || ctx.state !== 'running') return;
    if (!this.rigInitialized) {
      this.initDriveRig(ctx);
    }
    if (
      !this.masterDriveGain ||
      !this.engineOsc1 ||
      !this.engineOsc2 ||
      !this.engineLowpass ||
      !this.engineGain ||
      !this.windFilter ||
      !this.windGain
    ) {
      return;
    }

    const now = ctx.currentTime;
    this.masterDriveGain.gain.setTargetAtTime(1, now, 0.08);
    this.engineOsc1.frequency.setTargetAtTime(flightMix.jetHumHz, now, 0.15);
    this.engineOsc2.frequency.setTargetAtTime(flightMix.jetHumHz * 1.5, now, 0.15);
    this.engineLowpass.frequency.setTargetAtTime(160, now, 0.15);
    this.engineGain.gain.setTargetAtTime(flightMix.jetHumGain, now, 0.15);

    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setTargetAtTime(flightMix.lowpassHz, now, 0.18);
    this.windGain.gain.setTargetAtTime(flightMix.cabinGain, now, 0.15);
  }

  public stopDriveLoop(): void {
    this.currentGearStep = 1;
    this.lastMix = computeDrivetrainAudioMix({
      speedKmh: 0,
      prevGearStep: 1,
      travelMode: 'DRIVING',
      isActive: false,
    });
    if (typeof document !== 'undefined') {
      document.body.dataset.audioRpm = '0';
      document.body.dataset.audioGear = '0';
      document.body.dataset.audioWind = '0';
    }
    this.silenceDriveRig();
  }

  public playTurnCue(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playArrivalChime(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    const now = ctx.currentTime;
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.07, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  }

  public playSoftClick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);

    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.045);
  }
}

export const driveAudio = new DriveAudioEngine();
