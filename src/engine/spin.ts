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
};

export function isAllowedBet(bet: number): boolean {
  return (ALLOWED_BETS as readonly number[]).includes(bet);
}

export function spin(bet: number, randomInt: RandomInt, maxWinMultiplier = Infinity): SpinOutcome {
  if (!isAllowedBet(bet)) throw new Error(`Bet ${bet} is not allowed`);
  const stops = REEL_STRIPS.map((strip) => randomInt(strip.length));
  const grid = gridFromStops(stops);
  const { wins, payout: rawPayout } = evaluate(grid, bet);
  const cap = bet * maxWinMultiplier;
  return { stops, grid, wins, payout: Math.min(rawPayout, cap), capped: rawPayout > cap };
}
