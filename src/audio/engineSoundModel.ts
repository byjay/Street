export interface DrivetrainAudioMix {
  gearStep: number; // 1..5 for DRIVING, 0 for WALKING/stopped
  rpm: number; // 780 .. 5600
  shifted: 'up' | 'down' | null;
  engineFundamentalHz: number;
  engineHarmonicHz: number;
  engineLowpassHz: number;
  engineGain: number;
  windFilterHz: number;
  windFilterQ: number;
  windGain: number;
}

export interface DrivetrainTelemetryInput {
  speedKmh: number;
  prevGearStep: number;
  travelMode: 'DRIVING' | 'WALKING';
  isActive: boolean;
  gasPressed?: boolean;
  brakePressed?: boolean;
}

interface GearBand {
  gear: number;
  minSpeed: number;
  maxSpeed: number;
  downshiftSpeed: number;
}

const GEAR_BANDS: readonly GearBand[] = [
  { gear: 1, minSpeed: 0, maxSpeed: 18, downshiftSpeed: 0 },
  { gear: 2, minSpeed: 18, maxSpeed: 32, downshiftSpeed: 14 },
  { gear: 3, minSpeed: 32, maxSpeed: 48, downshiftSpeed: 27 },
  { gear: 4, minSpeed: 48, maxSpeed: 62, downshiftSpeed: 42 },
  { gear: 5, minSpeed: 62, maxSpeed: 90, downshiftSpeed: 55 },
];

const IDLE_RPM = 780;
const MIN_DRIVE_RPM = 1450;
const MAX_DRIVE_RPM = 5400;

/**
 * Computes realistic automatic transmission gear selection (with hysteresis),
 * engine RPM curve, engine acoustic synthesis targets, and aerodynamic wind noise mix.
 */
export function computeDrivetrainAudioMix(
  input: DrivetrainTelemetryInput
): DrivetrainAudioMix {
  if (!input.isActive) {
    return {
      gearStep: 1,
      rpm: 0,
      shifted: null,
      engineFundamentalHz: 26,
      engineHarmonicHz: 52,
      engineLowpassHz: 180,
      engineGain: 0,
      windFilterHz: 260,
      windFilterQ: 0.85,
      windGain: 0,
    };
  }

  const speed = Math.max(0, Number.isFinite(input.speedKmh) ? input.speedKmh : 0);

  // Walking tour disables car engine revving and provides only gentle natural breeze
  if (input.travelMode === 'WALKING') {
    const walkRatio = Math.max(0, Math.min(1, speed / 18));
    return {
      gearStep: 0,
      rpm: 0,
      shifted: null,
      engineFundamentalHz: 26,
      engineHarmonicHz: 52,
      engineLowpassHz: 180,
      engineGain: 0,
      windFilterHz: Math.round(280 + walkRatio * 220),
      windFilterQ: 0.75,
      windGain: Number((0.004 + walkRatio * 0.016).toFixed(4)),
    };
  }

  // Hysteretic gear selection (prevents rapid shift chatter near shift boundaries)
  const clampedPrev = Math.max(1, Math.min(5, Math.round(input.prevGearStep || 1)));
  let nextGear = clampedPrev;

  while (nextGear < 5 && speed >= GEAR_BANDS[nextGear - 1].maxSpeed) {
    nextGear += 1;
  }
  while (nextGear > 1 && speed < GEAR_BANDS[nextGear - 1].downshiftSpeed) {
    nextGear -= 1;
  }

  const shifted: 'up' | 'down' | null =
    nextGear > clampedPrev ? 'up' : nextGear < clampedPrev ? 'down' : null;

  // Map speed inside active gear band onto RPM curve
  const band = GEAR_BANDS[nextGear - 1];
  let rpm = IDLE_RPM;
  if (speed >= 0.8) {
    const bandLow = nextGear === 1 ? 0 : band.downshiftSpeed;
    const bandHigh = band.maxSpeed;
    const ratio = Math.max(
      0,
      Math.min(1, (speed - bandLow) / Math.max(4, bandHigh - bandLow))
    );
    const loadBoost = input.gasPressed ? 420 : input.brakePressed ? -220 : 0;
    const gearBaseRpm = nextGear === 1 ? IDLE_RPM + 350 : MIN_DRIVE_RPM;
    const gearPeakRpm = nextGear === 5 ? 4950 : 4850;
    rpm = Math.round(
      Math.max(
        IDLE_RPM,
        Math.min(MAX_DRIVE_RPM, gearBaseRpm + ratio * (gearPeakRpm - gearBaseRpm) + loadBoost)
      )
    );
  }

  const rpmNorm = Math.max(0, Math.min(1, (rpm - IDLE_RPM) / (MAX_DRIVE_RPM - IDLE_RPM)));
  // 4-cylinder firing frequency (~2 events per revolution -> rpm / 30), scaled gently for clean sub-bass warmth
  const engineFundamentalHz = Number((26 + rpmNorm * 88).toFixed(1)); // 26 Hz idle .. 114 Hz high rev
  const engineHarmonicHz = Number((engineFundamentalHz * 2).toFixed(1));
  const engineLowpassHz = Math.round(190 + rpmNorm * 760);

  // Subtle engine presence that rises under load/high RPM without overpowering cabin comfort
  const throttleFactor = input.gasPressed ? 1.18 : input.brakePressed ? 0.82 : 1;
  const speedRatio = Math.max(0, Math.min(1, speed / 75));
  // At high highway speeds, wind naturally dominates while engine settles into steady hum
  const baseEngineGain = (0.022 + rpmNorm * 0.044) * throttleFactor * (1 - speedRatio * 0.12);
  const engineGain = Number(Math.max(0.015, Math.min(0.082, baseEngineGain)).toFixed(4));

  // Aerodynamic wind noise (풍절음): rises steeply (v^1.65) above ~15 km/h
  const windNorm = Math.pow(Math.max(0, Math.min(1, (speed - 8) / 67)), 1.65);
  const windGain = Number((speed < 6 ? 0.001 : 0.003 + windNorm * 0.088).toFixed(4));
  const windFilterHz = Math.round(250 + windNorm * 920);
  const windFilterQ = Number((0.75 + windNorm * 0.65).toFixed(2));

  return {
    gearStep: nextGear,
    rpm,
    shifted,
    engineFundamentalHz,
    engineHarmonicHz,
    engineLowpassHz,
    engineGain,
    windFilterHz,
    windFilterQ,
    windGain,
  };
}

export type FlightSoundPhase = 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCENT' | 'LANDING';

export interface FlightAudioMix {
  lowpassHz: number;
  cabinGain: number;
  jetHumHz: number;
  jetHumGain: number;
}

/**
 * Computes Web Audio jet-cabin lowpass & turbine hum mix across the 5 flight phases.
 */
export function computeFlightAudioMix(
  phase: FlightSoundPhase,
  speedKmh: number,
  isActive: boolean
): FlightAudioMix {
  if (!isActive) {
    return { lowpassHz: 140, cabinGain: 0, jetHumHz: 62, jetHumGain: 0 };
  }

  const speedFactor = Math.max(0.4, Math.min(1.15, (speedKmh || 400) / 800));
  switch (phase) {
    case 'TAKEOFF':
      return {
        lowpassHz: 420,
        cabinGain: 0.085,
        jetHumHz: 94,
        jetHumGain: 0.028,
      };
    case 'CLIMB':
      return {
        lowpassHz: 340,
        cabinGain: 0.072,
        jetHumHz: 84,
        jetHumGain: 0.022,
      };
    case 'CRUISE':
      return {
        lowpassHz: 185,
        cabinGain: Number((0.045 * speedFactor).toFixed(4)),
        jetHumHz: 68,
        jetHumGain: 0.012,
      };
    case 'DESCENT':
      return {
        lowpassHz: 240,
        cabinGain: 0.052,
        jetHumHz: 72,
        jetHumGain: 0.015,
      };
    case 'LANDING':
    default:
      return {
        lowpassHz: 145,
        cabinGain: 0.038,
        jetHumHz: 60,
        jetHumGain: 0.01,
      };
  }
}

export interface WalkAudioMix {
  cadenceSpm: number; // steps per minute (105..124)
  stepIntervalMs: number;
  breezeFilterHz: number;
  breezeGain: number;
}

export function computeWalkAudioMix(
  speedKmh: number,
  isActive: boolean
): WalkAudioMix {
  if (!isActive || speedKmh < 0.8) {
    return {
      cadenceSpm: 0,
      stepIntervalMs: 0,
      breezeFilterHz: 260,
      breezeGain: 0,
    };
  }
  const ratio = Math.max(0, Math.min(1, (speedKmh - 2) / 14));
  const cadenceSpm = Math.round(105 + ratio * 22);
  const stepIntervalMs = Math.round(60000 / cadenceSpm);
  return {
    cadenceSpm,
    stepIntervalMs,
    breezeFilterHz: Math.round(280 + ratio * 240),
    breezeGain: Number((0.005 + ratio * 0.014).toFixed(4)),
  };
}

