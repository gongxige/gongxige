/** UI-side automatic-spin bookkeeping.  This deliberately has no React or DOM
 * dependency so the stopping rules remain easy to test. */
export type AutoStopReason = 'insufficient-funds' | 'free-spins' | 'request-error' | 'player-stopped';

export class AutoSpinController {
  private spinsLeft: number | null = null;

  get remaining() { return this.spinsLeft; }
  get active() { return this.spinsLeft !== null; }

  start(count: number) {
    if (!Number.isInteger(count) || count <= 0) throw new Error('Automatic spin count must be positive');
    this.spinsLeft = count;
  }

  /** Reserve one paid spin. Returns false after the requested count is exhausted. */
  takeSpin(): boolean {
    if (this.spinsLeft === null || this.spinsLeft <= 0) return false;
    this.spinsLeft -= 1;
    return true;
  }

  stop(_reason: AutoStopReason) { this.spinsLeft = null; }
}

export const LONG_PRESS_MS = 600;
export const isAutoSpinLongPress = (heldMs: number) => heldMs >= LONG_PRESS_MS;

/** 付费自动旋转在请求下一局前保留中奖画面。 */
export const AUTO_SPIN_DELAY_MS = { win: 2000, noWin: 280 } as const;

export function highestAllowedBet(bets: readonly number[]): number {
  if (!bets.length) throw new Error('At least one bet is required');
  return Math.max(...bets);
}

/** Keep wager controls locked for the entire automatic-play run, including gaps. */
export function isBetChangeLocked(spinning: boolean, inFreeSpins: boolean, autoSpinning: boolean): boolean {
  return spinning || inFreeSpins || autoSpinning;
}
