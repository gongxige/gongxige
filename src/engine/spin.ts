import { evaluate, type Win } from './evaluate.ts';
import { REEL_STRIPS, gridFromStops } from './reels.ts';
import { ALLOWED_BETS, FREE_SPIN_WILD_MULTIPLIERS, WILD, type Grid, type Mode, type MultiplierGrid } from './symbols.ts';

/** Returns a uniformly random integer in [0, maxExclusive). The server passes crypto.randomInt. */
export type RandomInt = (maxExclusive: number) => number;

export type SpinOutcome = {
  mode: Mode;
  stops: number[];
  grid: Grid;
  /** Wild multipliers (free spins only; 1 everywhere else). */
  multipliers: MultiplierGrid;
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

export function spin(bet: number, randomInt: RandomInt, maxWinMultiplier = Infinity, mode: Mode = 'base'): SpinOutcome {
  if (!isAllowedBet(bet)) throw new Error(`Bet ${bet} is not allowed`);
  const stops = REEL_STRIPS.map((strip) => randomInt(strip.length));
  const grid = gridFromStops(stops);
  const multipliers = grid.map((column) => column.map((id) =>
    mode === 'free' && id === WILD ? FREE_SPIN_WILD_MULTIPLIERS[randomInt(FREE_SPIN_WILD_MULTIPLIERS.length)] : 1));
  return replaySpin({ bet, mode, stops, multipliers }, maxWinMultiplier);
}

/** Everything random about a spin. Stored with each round so it can be replayed exactly. */
export type SpinRecord = { bet: number; mode: Mode; stops: number[]; multipliers: MultiplierGrid };

/**
 * Recomputes a spin from its recorded stops and wild multipliers, with no
 * randomness. `spin` uses this too, so a replay always matches the original
 * result as long as the rules (ENGINE_VERSION) are the same.
 */
export function replaySpin({ bet, mode, stops, multipliers }: SpinRecord, maxWinMultiplier = Infinity): SpinOutcome {
  if (!isAllowedBet(bet)) throw new Error(`Bet ${bet} is not allowed`);
  stops.forEach((stop, reel) => {
    if (!Number.isInteger(stop) || stop < 0 || stop >= REEL_STRIPS[reel].length) throw new Error(`Stop ${stop} is not on reel ${reel + 1}`);
  });
  const grid = gridFromStops(stops);
  grid.forEach((column, reel) => column.forEach((id, row) => {
    const m = multipliers[reel]?.[row];
    const valid = mode === 'free' && id === WILD ? FREE_SPIN_WILD_MULTIPLIERS.includes(m) : m === 1;
    if (!valid) throw new Error(`Multiplier ${m} is not possible at reel ${reel + 1}, row ${row + 1}`);
  }));
  const { wins, payout: rawPayout, freeSpinsAwarded } = evaluate(grid, bet, mode, multipliers);
  const cap = bet * maxWinMultiplier;
  return { mode, stops: [...stops], grid, multipliers, wins, payout: Math.min(rawPayout, cap), capped: rawPayout > cap, freeSpinsAwarded };
}

/**
 * One paid spin plus every free spin it leads to, in one go. The server plays
 * free spins one request at a time; this is for simulations and tests.
 */
export function playRound(bet: number, randomInt: RandomInt, maxWinMultiplier = Infinity): { payout: number; freeSpinsPlayed: number; freeSpinWin: number } {
  const paid = spin(bet, randomInt, maxWinMultiplier);
  let remaining = paid.freeSpinsAwarded;
  let freeSpinsPlayed = 0;
  let freeSpinWin = 0;
  while (remaining > 0) {
    const free = spin(bet, randomInt, maxWinMultiplier, 'free');
    freeSpinWin += free.payout;
    remaining += free.freeSpinsAwarded - 1;
    freeSpinsPlayed += 1;
  }
  return { payout: paid.payout + freeSpinWin, freeSpinsPlayed, freeSpinWin };
}
