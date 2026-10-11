import { REEL_STRIPS, REELS, SCATTER, windowAt } from '../engine/index.ts';
import { ReelMotion } from './reelMotion.ts';
import { ReelTape } from './reelTape.ts';

// Runs one spin across all reels. Driven entirely by `tick(now)` so it has no
// timers of its own: the UI calls tick from requestAnimationFrame, tests call
// it with made-up timestamps.
//
// All reels start together the moment the player presses spin. The server
// result can arrive at any time after that; reels then begin decelerating
// one by one, never earlier than FIRST_STOP_MS after the start.
//
// Anticipation ("waiting for the third coin"): once the reels already landed
// show ANTICIPATION_SCATTERS coins, each remaining reel, in turn, keeps spinning
// with a glow for ANTICIPATION_SPIN_MS after the previous reel lands and then
// slows down over ANTICIPATION_SLOW_MS. Quick stop does not skip it. Purely
// presentation: the result is fixed by the server before any reel stops.

/**
 * Time from pressing spin until the first reel may start to decelerate. Equal to
 * ACCEL_MS: braking begins as soon as the reel is at full speed, because at the
 * slower, readable spin speed the braking itself takes about half a second.
 */
export const FIRST_STOP_MS = 120;
/** Gap between consecutive reels starting to decelerate. */
export const STOP_INTERVAL_MS = 400;
/** Gap used when the player presses again to stop early. */
export const QUICK_STOP_INTERVAL_MS = 90;
/** Coins already on screen that make the following reels anticipate. */
export const ANTICIPATION_SCATTERS = 2;
/** An anticipating reel keeps full speed this long after the previous reel lands… */
export const ANTICIPATION_SPIN_MS = 1000;
/** …and then takes about this long to slow down and land. */
export const ANTICIPATION_SLOW_MS = 1500;

export type TickResult = { landedReels: number[]; allLanded: boolean };

export class SpinController {
  readonly motions: ReelMotion[];
  readonly tapes: ReelTape[];
  private startedAt = 0;
  private targets: (number[] | null) | undefined; // undefined: result not in yet; null: stop anywhere
  private stopAt: number[] = [];
  private stopped: boolean[] = [];
  private anticipates: boolean[] = [];
  private active = false;

  constructor(initialStops: number[]) {
    this.motions = REEL_STRIPS.map(() => new ReelMotion());
    this.tapes = REEL_STRIPS.map((strip, reel) => new ReelTape(strip, initialStops[reel]));
  }

  get isSpinning() { return this.active; }
  /** True once the result is known, i.e. pressing again can speed up the stop. */
  get canQuickStop() { return this.active && this.targets !== undefined; }
  /** The reel currently "waiting for the third coin", or null. */
  get anticipatingReel(): number | null {
    if (!this.active) return null;
    const reel = this.anticipates.findIndex((anticipates, r) => anticipates && !this.motions[r].isIdle);
    return reel >= 0 && this.motions[reel - 1].isIdle ? reel : null;
  }

  start(now: number) {
    if (this.active) throw new Error('Already spinning');
    this.active = true;
    this.startedAt = now;
    this.targets = undefined;
    this.stopAt = [];
    this.stopped = Array(REELS).fill(false);
    this.anticipates = Array(REELS).fill(false);
    this.motions.forEach((motion) => motion.start(now));
  }

  /** The server's reel stops, or null to stop wherever (e.g. the request failed). */
  setResult(stops: number[] | null, now: number) {
    if (!this.active || this.targets !== undefined) return;
    this.targets = stops;
    let coins = 0;
    this.anticipates = Array.from({ length: REELS }, (_, reel) => {
      const anticipates = coins >= ANTICIPATION_SCATTERS;
      if (stops) coins += windowAt(reel, stops[reel]).filter((id) => id === SCATTER).length;
      return anticipates;
    });
    const first = Math.max(now, this.startedAt + FIRST_STOP_MS);
    // Anticipating reels get their stop time once the reel before them has landed.
    this.stopAt = Array.from({ length: REELS }, (_, reel) => (this.anticipates[reel] ? Infinity : first + reel * STOP_INTERVAL_MS));
  }

  /** Bring forward the reels that have not started stopping yet (anticipation is never skipped). */
  quickStop(now: number) {
    if (!this.canQuickStop) return;
    let next = now;
    this.stopAt = this.stopAt.map((at, reel) => {
      if (this.stopped[reel] || this.anticipates[reel]) return at;
      const quick = Math.min(at, next);
      next = quick + QUICK_STOP_INTERVAL_MS;
      return quick;
    });
  }

  tick(now: number): TickResult {
    const landedReels: number[] = [];
    if (!this.active) return { landedReels, allLanded: false };

    this.motions.forEach((motion, reel) => {
      if (motion.update(now)) landedReels.push(reel);
      if (this.stopped[reel] || this.targets === undefined) return;
      // Reels always stop left to right, even after a quick stop.
      if (reel > 0 && !this.stopped[reel - 1]) return;
      if (this.anticipates[reel] && this.stopAt[reel] === Infinity && this.motions[reel - 1].isIdle) this.stopAt[reel] = now + ANTICIPATION_SPIN_MS;
      if (now < this.stopAt[reel] || !motion.canStop) return;
      this.stopped[reel] = true;
      const target = motion.stop(now, this.anticipates[reel] ? ANTICIPATION_SLOW_MS : 0);
      if (this.targets) this.tapes[reel].land(-target, this.targets[reel]);
    });

    const allLanded = this.motions.every((motion) => motion.isIdle);
    if (allLanded) this.active = false;
    return { landedReels, allLanded };
  }
}
