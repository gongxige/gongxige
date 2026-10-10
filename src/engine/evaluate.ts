import { BET_MULTIPLIER, REELS, SCATTER, WAYS_PAYTABLE, WAYS_SYMBOLS, WILD, WILD_REELS, freeSpinsFor, minReels, scatterMultiplier, type Grid, type Mode, type MultiplierGrid, type ReelCount, type SymbolId, type WaysSymbol } from './symbols.ts';

/** A grid position: reel (column) and row. */
export type Cell = { reel: number; row: number };

export type WaysWin = {
  kind: 'ways';
  symbol: WaysSymbol;
  /** Consecutive reels from the left that contain the symbol (2–5). */
  reelCount: ReelCount;
  /** Product of the symbol's count on each of those reels. */
  ways: number;
  /** Ways after wild multipliers (free spins); equals `ways` when no multiplier applies. */
  multipliedWays: number;
  payout: number;
  cells: Cell[];
};

export type ScatterWin = { kind: 'scatter'; symbol: typeof SCATTER; count: number; payout: number; cells: Cell[] };

export type Win = WaysWin | ScatterWin;

export type Evaluation = { wins: Win[]; payout: number; freeSpinsAwarded: number };

/** Does `id` count as `symbol` on this reel? Wilds stand in on WILD_REELS. */
function matches(id: SymbolId, symbol: SymbolId, reel: number): boolean {
  return id === symbol || (id === WILD && symbol !== SCATTER && WILD_REELS.includes(reel));
}

function cellsOf(grid: Grid, symbol: SymbolId, reels: number): Cell[] {
  const cells: Cell[] = [];
  for (let reel = 0; reel < reels; reel += 1) {
    grid[reel].forEach((id, row) => { if (matches(id, symbol, reel)) cells.push({ reel, row }); });
  }
  return cells;
}

/**
 * 1024 ways: a symbol wins when it appears on reels 1..n in any row (n ≥ 3,
 * or n ≥ 2 for the buffalo). Each combination of one position per reel is
 * one way. Wilds on reels 2–4 count as the symbol; reel 1 has no wilds, so
 * every way starts with a real symbol.
 *
 * In free spins each wild carries a multiplier and a way pays the product of
 * the multipliers on it. Summed over all ways that is the product, per reel,
 * of (real symbols + the multipliers of that reel's wilds).
 */
export function evaluate(grid: Grid, bet: number, mode: Mode = 'base', multipliers?: MultiplierGrid): Evaluation {
  if (bet % BET_MULTIPLIER !== 0) throw new Error(`Bet must be a multiple of ${BET_MULTIPLIER}`);
  const unit = bet / BET_MULTIPLIER;
  const weight = (reel: number, row: number) => (grid[reel][row] === WILD && multipliers ? multipliers[reel][row] : 1);
  const wins: Win[] = [];

  for (const symbol of WAYS_SYMBOLS) {
    let ways = 1;
    let multipliedWays = 1;
    let reelCount = 0;
    while (reelCount < REELS) {
      const reel = reelCount;
      const rows = [...grid[reel].keys()].filter((row) => matches(grid[reel][row], symbol, reel));
      if (rows.length === 0) break;
      ways *= rows.length;
      multipliedWays *= rows.reduce((sum, row) => sum + weight(reel, row), 0);
      reelCount += 1;
    }
    const pay = WAYS_PAYTABLE[symbol][reelCount as ReelCount];
    if (reelCount < minReels(symbol) || !pay) continue;
    const n = reelCount as ReelCount;
    wins.push({ kind: 'ways', symbol, reelCount: n, ways, multipliedWays, payout: pay * multipliedWays * unit, cells: cellsOf(grid, symbol, n) });
  }

  const scatterCells = cellsOf(grid, SCATTER, REELS);
  const scatterPay = scatterMultiplier(scatterCells.length) * bet;
  if (scatterPay > 0) wins.push({ kind: 'scatter', symbol: SCATTER, count: scatterCells.length, payout: scatterPay, cells: scatterCells });

  return {
    wins,
    payout: wins.reduce((sum, win) => sum + win.payout, 0),
    freeSpinsAwarded: freeSpinsFor(scatterCells.length, mode),
  };
}
