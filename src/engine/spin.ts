import { evaluate, type Win } from './evaluate.ts';
import { REEL_STRIPS, gridFromStops } from './reels.ts';
import { ALLOWED_BETS, type Grid } from './symbols.ts';

/** Returns a uniformly random integer in [0, maxExclusive). The server passes crypto.randomInt. */
export type RandomInt = (maxExclusive: number) => number;

export type SpinOutcome = {
  stops: number[];
  grid: Grid;
  wins: Win[];
  /** Total won, after the max-win cap. */
  payout: number;
  /** True when the raw win exceeded the cap and was reduced. */
  capped: boolean;
  freeSpinsAwarded: number;
};

export function isAllowedBet(bet: number): boolean {
  return (ALLOWED_BETS as readonly number[]).includes(bet);
}

export function spin(bet: number, randomInt: RandomInt, maxWinMultiplier = Infinity): SpinOutcome {
  if (!isAllowedBet(bet)) throw new Error(`Bet ${bet} is not allowed`);
  const stops = REEL_STRIPS.map((strip) => randomInt(strip.length));
  const grid = gridFromStops(stops);
  const { wins, payout: rawPayout, freeSpinsAwarded } = evaluate(grid, bet);
  const cap = bet * maxWinMultiplier;
  return { stops, grid, wins, payout: Math.min(rawPayout, cap), capped: rawPayout > cap, freeSpinsAwarded };
}

/**
 * One paid spin plus every free spin it leads to, in one go. The server plays
 * free spins one request at a time; this is for simulations and tests.
 */
export function playRound(bet: number, randomInt: RandomInt, maxWinMultiplier = Infinity): { payout: number; freeSpinsPlayed: number } {
  let { payout, freeSpinsAwarded: remaining } = spin(bet, randomInt, maxWinMultiplier);
  let freeSpinsPlayed = 0;
  while (remaining > 0) {
    const free = spin(bet, randomInt, maxWinMultiplier);
    payout += free.payout;
    remaining += free.freeSpinsAwarded - 1;
    freeSpinsPlayed += 1;
  }
  return { payout, freeSpinsPlayed };
}
