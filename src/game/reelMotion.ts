// Motion of a single reel, measured in symbol heights. `position` only ever
// grows while spinning; the view draws symbol index i at y = (i + position)
// symbol heights, so a growing position moves the strip downward and new
// symbols enter from the top.
//
// Phases: idle → accel → spin → decel (overshoots the target a little)
//         → settle (springs back onto the target) → idle.
// Pure time maths, no DOM, so it is unit-tested directly.

/** Full speed, in symbols per millisecond. */
export const SPIN_SPEED = 0.013;
/** Short run-up, so the first reel can land about 0.8 s after pressing spin (reference ≈ 0.5 s). */
export const ACCEL_MS = 120;
/** Deceleration always covers at least this many symbols, so the landing symbols are placed off-screen. */
export const MIN_STOP_DISTANCE = 5;
export const OVERSHOOT = 0.28;
export const SETTLE_MS = 100;
/**
 * A gentle ease-out that stays close to the spin speed at first.  Unlike a
 * quadratic ease-out, it keeps the five-symbol safe landing distance from
 * making the new, slower reels feel late.
 */
export const DECEL_EASE_POWER = 1.35;

type Phase =
  | { kind: 'idle' }
  | { kind: 'accel'; start: number; from: number }
  | { kind: 'spin'; start: number; from: number }
  | { kind: 'decel'; start: number; from: number; to: number; duration: number }
  | { kind: 'settle'; start: number; to: number };

export class ReelMotion {
  position: number;
  private phase: Phase = { kind: 'idle' };

  constructor(position = 0) {
    this.position = position;
  }

  get isIdle() { return this.phase.kind === 'idle'; }
  /** Deceleration can only begin once the reel is at full speed. */
  get canStop() { return this.phase.kind === 'spin'; }
  /** At or near full speed: the view can apply its moving-reel treatment. */
  get isFast() { return this.phase.kind === 'spin' || this.phase.kind === 'accel' || this.phase.kind === 'decel'; }

  start(now: number) {
    if (!this.isIdle) throw new Error('Reel is already moving');
    this.phase = { kind: 'accel', start: now, from: this.position };
  }

  /**
   * Begin decelerating at `now`. Returns the whole-number position the reel
   * will come to rest on; the caller puts the result symbols there.
   * `slowMs` stretches the slow-down to about that long (the "waiting for the
   * third scatter" stop); the default is the normal quick stop.
   */
  stop(now: number, slowMs = 0): number {
    this.update(now);
    if (this.phase.kind !== 'spin') throw new Error('Reel is not at full speed');
    // A longer slow-down from the same full speed simply covers more symbols.
    // The easing below takes DECEL_EASE_POWER * distance / speed, so calibrate
    // the anticipation distance to retain its requested slow-down duration.
    const symbols = Math.max(MIN_STOP_DISTANCE, Math.round((SPIN_SPEED * slowMs) / DECEL_EASE_POWER));
    const target = Math.ceil(this.position) + symbols;
    // The ease-out starts at DECEL_EASE_POWER·distance/duration. Matching that
    // to SPIN_SPEED keeps the hand-over from full speed seamless.
    const distance = target + OVERSHOOT - this.position;
    this.phase = { kind: 'decel', start: now, from: this.position, to: target, duration: (DECEL_EASE_POWER * distance) / SPIN_SPEED };
    return target;
  }

  /** Advance to `now`. Returns true on the frame the reel comes to rest. */
  update(now: number): boolean {
    const phase = this.phase;
    switch (phase.kind) {
      case 'idle':
        return false;
      case 'accel': {
        const t = Math.min(now - phase.start, ACCEL_MS);
        // Velocity ramps linearly from 0 to SPIN_SPEED.
        this.position = phase.from + (SPIN_SPEED * t * t) / (2 * ACCEL_MS);
        if (t === ACCEL_MS) this.phase = { kind: 'spin', start: phase.start + ACCEL_MS, from: this.position };
        if (now - phase.start > ACCEL_MS) return this.update(now);
        return false;
      }
      case 'spin':
        this.position = phase.from + SPIN_SPEED * (now - phase.start);
        return false;
      case 'decel': {
        const u = Math.min((now - phase.start) / phase.duration, 1);
        this.position = phase.from + (phase.to + OVERSHOOT - phase.from) * (1 - (1 - u) ** DECEL_EASE_POWER);
        if (u < 1) return false;
        this.phase = { kind: 'settle', start: phase.start + phase.duration, to: phase.to };
        return this.update(now);
      }
      case 'settle': {
        const u = Math.min((now - phase.start) / SETTLE_MS, 1);
        this.position = phase.to + (OVERSHOOT * (1 + Math.cos(Math.PI * u))) / 2;
        if (u < 1) return false;
        this.position = phase.to;
        this.phase = { kind: 'idle' };
        return true;
      }
    }
  }
}
