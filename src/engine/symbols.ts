// Symbol set, paytable and bet rules for the 5×4, 1024-ways game.
// Everything here is plain data so the server, the UI and the tests all
// read the same numbers.

export const REELS = 5;
export const ROWS = 4;

export const WAYS_SYMBOLS = ['lion', 'elephant', 'bull', 'deer', 'zebra', 'A', 'K', 'Q', 'J', '10', '9'] as const;
export const SCATTER = 'coin';
/** Substitutes for every ways symbol (not the scatter). Pays nothing by itself. */
export const WILD = 'wild';
/** Wild only appears on reels 2, 3 and 4. */
export const WILD_REELS: readonly number[] = [1, 2, 3];

export type WaysSymbol = (typeof WAYS_SYMBOLS)[number];
export type SymbolId = WaysSymbol | typeof SCATTER | typeof WILD;
export const ALL_SYMBOLS: readonly SymbolId[] = [...WAYS_SYMBOLS, SCATTER, WILD];

/** This many scatters anywhere award FREE_SPINS_AWARD free spins (also during free spins). */
export const FREE_SPINS_TRIGGER = 3;
export const FREE_SPINS_AWARD = 8;

/** grid[reel][row], row 0 is the top of the window. */
export type Grid = SymbolId[][];

/**
 * A spin costs BET_MULTIPLIER units; each winning way pays
 * `WAYS_PAYTABLE[symbol][reelCount]` units. Bets are multiples of
 * BET_MULTIPLIER so every payout is a whole number of credits.
 */
export const BET_MULTIPLIER = 50;
export const ALLOWED_BETS = [50, 100, 250, 500] as const;

export const WAYS_PAYTABLE: Record<WaysSymbol, Record<3 | 4 | 5, number>> = {
  lion: { 3: 60, 4: 180, 5: 750 },
  elephant: { 3: 50, 4: 150, 5: 600 },
  bull: { 3: 40, 4: 120, 5: 450 },
  deer: { 3: 30, 4: 90, 5: 300 },
  zebra: { 3: 30, 4: 75, 5: 300 },
  A: { 3: 20, 4: 50, 5: 150 },
  K: { 3: 20, 4: 50, 5: 150 },
  Q: { 3: 15, 4: 35, 5: 120 },
  J: { 3: 15, 4: 35, 5: 120 },
  '10': { 3: 12, 4: 30, 5: 90 },
  '9': { 3: 12, 4: 30, 5: 90 },
};

/** Scatter pays anywhere on the grid, as a multiple of the total bet. 5+ pays the 5 prize. */
export const SCATTER_PAYTABLE: Record<3 | 4 | 5, number> = { 3: 4, 4: 20, 5: 100 };

export function scatterMultiplier(count: number): number {
  if (count < 3) return 0;
  return SCATTER_PAYTABLE[Math.min(count, 5) as 3 | 4 | 5];
}
