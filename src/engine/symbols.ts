// Symbol set, paytable and bet rules for the 5×4, 1024-ways game.
// Everything here is plain data so the server, the UI and the tests all
// read the same numbers.

export const REELS = 5;
export const ROWS = 4;

export const WAYS_SYMBOLS = ['lion', 'elephant', 'bull', 'deer', 'zebra', 'A', 'K', 'Q', 'J', '10', '9'] as const;
export const SCATTER = 'coin';

export type WaysSymbol = (typeof WAYS_SYMBOLS)[number];
export type SymbolId = WaysSymbol | typeof SCATTER;

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
  lion: { 3: 100, 4: 300, 5: 1250 },
  elephant: { 3: 80, 4: 250, 5: 1000 },
  bull: { 3: 60, 4: 200, 5: 750 },
  deer: { 3: 50, 4: 150, 5: 500 },
  zebra: { 3: 50, 4: 125, 5: 500 },
  A: { 3: 30, 4: 80, 5: 250 },
  K: { 3: 30, 4: 80, 5: 250 },
  Q: { 3: 25, 4: 60, 5: 200 },
  J: { 3: 25, 4: 60, 5: 200 },
  '10': { 3: 20, 4: 50, 5: 150 },
  '9': { 3: 20, 4: 50, 5: 150 },
};

/** Scatter pays anywhere on the grid, as a multiple of the total bet. 5+ pays the 5 prize. */
export const SCATTER_PAYTABLE: Record<3 | 4 | 5, number> = { 3: 4, 4: 20, 5: 100 };

export function scatterMultiplier(count: number): number {
  if (count < 3) return 0;
  return SCATTER_PAYTABLE[Math.min(count, 5) as 3 | 4 | 5];
}
