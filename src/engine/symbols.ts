// Symbol set, paytable and bet rules for the 5×4, 1024-ways game.
// Everything here is plain data so the server, the UI and the tests all
// read the same numbers. Paytable and free-game rules follow the reference
// game's pay screens (supplied by the user, 2026-10-10).

export const REELS = 5;
export const ROWS = 4;

export const WAYS_SYMBOLS = ['bull', 'lion', 'elephant', 'zebra', 'deer', 'A', 'K', 'Q', 'J', '10', '9'] as const;
export const SCATTER = 'coin';
/** Substitutes for every ways symbol (not the scatter). Pays nothing by itself. */
export const WILD = 'wild';
/** Wild only appears on reels 2, 3 and 4. */
export const WILD_REELS: readonly number[] = [1, 2, 3];
/** In free spins each wild carries one of these multipliers, picked at random. */
export const FREE_SPIN_WILD_MULTIPLIERS: readonly number[] = [2, 3];

export type WaysSymbol = (typeof WAYS_SYMBOLS)[number];
export type SymbolId = WaysSymbol | typeof SCATTER | typeof WILD;
export const ALL_SYMBOLS: readonly SymbolId[] = [...WAYS_SYMBOLS, SCATTER, WILD];

/** grid[reel][row], row 0 is the top of the window. */
export type Grid = SymbolId[][];
/** Same shape as Grid: a wild's multiplier in free spins, otherwise 1. */
export type MultiplierGrid = number[][];

export type Mode = 'base' | 'free';

/**
 * A spin costs BET_MULTIPLIER units; each winning way pays
 * `WAYS_PAYTABLE[symbol][reelCount]` units ("all wins shown at 1× bet").
 * Bets are multiples of BET_MULTIPLIER so every payout is a whole number.
 */
export const BET_MULTIPLIER = 40;
export const ALLOWED_BETS = [40, 80, 200, 400] as const;

export type ReelCount = 2 | 3 | 4 | 5;

/** Per-way pays. Only the buffalo pays for 2 reels. */
export const WAYS_PAYTABLE: Record<WaysSymbol, Partial<Record<ReelCount, number>>> = {
  bull: { 2: 10, 3: 50, 4: 100, 5: 250 },
  lion: { 3: 50, 4: 100, 5: 150 },
  elephant: { 3: 50, 4: 100, 5: 150 },
  zebra: { 3: 20, 4: 80, 5: 120 },
  deer: { 3: 20, 4: 80, 5: 120 },
  A: { 3: 10, 4: 50, 5: 80 },
  K: { 3: 10, 4: 50, 5: 80 },
  Q: { 3: 5, 4: 20, 5: 60 },
  J: { 3: 5, 4: 20, 5: 60 },
  '10': { 3: 5, 4: 10, 5: 60 },
  '9': { 3: 5, 4: 10, 5: 60 },
};

/** Fewest reels a symbol needs to win. */
export const minReels = (symbol: WaysSymbol): ReelCount => (WAYS_PAYTABLE[symbol][2] ? 2 : 3);

/** Scatter pays anywhere on the grid, as a multiple of the total bet. 5+ pays the 5 prize. */
export const SCATTER_PAYTABLE: Record<3 | 4 | 5, number> = { 3: 2, 4: 10, 5: 20 };

export function scatterMultiplier(count: number): number {
  if (count < 3) return 0;
  return SCATTER_PAYTABLE[Math.min(count, 5) as 3 | 4 | 5];
}

/** Free spins awarded by scatter count: from a paid spin, and extra ones during free spins. */
export const FREE_SPINS_FROM_BASE: Readonly<Record<number, number>> = { 3: 8, 4: 15, 5: 20 };
export const FREE_SPINS_RETRIGGER: Readonly<Record<number, number>> = { 2: 5, 3: 8, 4: 15, 5: 20 };

export function freeSpinsFor(scatters: number, mode: Mode): number {
  const table = mode === 'base' ? FREE_SPINS_FROM_BASE : FREE_SPINS_RETRIGGER;
  return table[Math.min(scatters, 5)] ?? 0;
}
