import { REEL_STRIPS, REELS } from '../engine/index.ts';
import { ReelMotion } from './reelMotion.ts';
import { ReelTape } from './reelTape.ts';

// Runs one spin across all reels. Driven entirely by `tick(now)` so it has no
// timers of its own: the UI calls tick from requestAnimationFrame, tests call
// it with made-up timestamps.
//
// All reels start together the moment the player presses spin. The server
// result can arrive at any time after that; reels then begin decelerating
// one by one, never earlier than FIRST_STOP_MS after the start.

/** Time from pressing spin until the first reel starts to decelerate. */
export const FIRST_STOP_MS = 500;
/** Gap between consecutive reels starting to decelerate. */
export const STOP_INTERVAL_MS = 400;
/** Gap used when the player presses again to stop early. */
export const QUICK_STOP_INTERVAL_MS = 90;

export type TickResult = { landedReels: number[]; allLanded: boolean };

export class SpinController {
  readonly motions: ReelMotion[];
  readonly tapes: ReelTape[];
  private startedAt = 0;
  private targets: (number[] | null) | undefined; // undefined: result not in yet; null: stop anywhere
  private stopAt: number[] = [];
  private stopped: boolean[] = [];
  private active = false;

  constructor(initialStops: number[]) {
    this.motions = REEL_STRIPS.map(() => new ReelMotion());
    this.tapes = REEL_STRIPS.map((strip, reel) => new ReelTape(strip, initialStops[reel]));
  }

  get isSpinning() { return this.active; }
  /** True once the result is known, i.e. pressing again can speed up the stop. */
  get canQuickStop() { return this.active && this.targets !== undefined; }

  start(now: number) {
    if (this.active) throw new Error('Already spinning');
    this.active = true;
    this.startedAt = now;
    this.targets = undefined;
    this.stopAt = [];
    this.stopped = Array(REELS).fill(false);
    this.motions.forEach((motion) => motion.start(now));
  }

  /** The server's reel stops, or null to stop wherever (e.g. the request failed). */
  setResult(stops: number[] | null, now: number) {
    if (!this.active || this.targets !== undefined) return;
    this.targets = stops;
    const first = Math.max(now, this.startedAt + FIRST_STOP_MS);
    this.stopAt = Array.from({ length: REELS }, (_, reel) => first + reel * STOP_INTERVAL_MS);
  }

  /** Bring forward the reels that have not started stopping yet. */
  quickStop(now: number) {
    if (!this.canQuickStop) return;
    let next = now;
    this.stopAt = this.stopAt.map((at, reel) => {
      if (this.stopped[reel]) return at;
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
      if (!this.stopped[reel] && this.targets !== undefined && now >= this.stopAt[reel] && motion.canStop) {
        // Reels always stop left to right, even after a quick stop.
        if (reel > 0 && !this.stopped[reel - 1]) return;
        this.stopped[reel] = true;
        const target = motion.stop(now);
        if (this.targets) this.tapes[reel].land(-target, this.targets[reel]);
      }
    });

    const allLanded = this.motions.every((motion) => motion.isIdle);
    if (allLanded) this.active = false;
    return { landedReels, allLanded };
  }
}
