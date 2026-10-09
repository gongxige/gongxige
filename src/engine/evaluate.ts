import { BET_MULTIPLIER, REELS, SCATTER, WAYS_PAYTABLE, WAYS_SYMBOLS, scatterMultiplier, type Grid, type SymbolId, type WaysSymbol } from './symbols.ts';

/** A grid position: reel (column) and row. */
export type Cell = { reel: number; row: number };

export type WaysWin = {
  kind: 'ways';
  symbol: WaysSymbol;
  /** Consecutive reels from the left that contain the symbol (3–5). */
  reelCount: 3 | 4 | 5;
  /** Product of the symbol's count on each of those reels. */
  ways: number;
  payout: number;
  cells: Cell[];
};

export type ScatterWin = { kind: 'scatter'; symbol: typeof SCATTER; count: number; payout: number; cells: Cell[] };

export type Win = WaysWin | ScatterWin;

export type Evaluation = { wins: Win[]; payout: number };

function cellsOf(grid: Grid, symbol: SymbolId, reels: number): Cell[] {
  const cells: Cell[] = [];
  for (let reel = 0; reel < reels; reel += 1) {
    grid[reel].forEach((id, row) => { if (id === symbol) cells.push({ reel, row }); });
  }
  return cells;
}

/**
 * 1024 ways: a symbol wins when it appears on reels 1..n (n ≥ 3) in any row.
 * Each combination of one position per reel is one way, so the number of
 * ways is the product of the symbol's count on each reel.
 */
export function evaluate(grid: Grid, bet: number): Evaluation {
  if (bet % BET_MULTIPLIER !== 0) throw new Error(`Bet must be a multiple of ${BET_MULTIPLIER}`);
  const unit = bet / BET_MULTIPLIER;
  const wins: Win[] = [];

  for (const symbol of WAYS_SYMBOLS) {
    let ways = 1;
    let reelCount = 0;
    while (reelCount < REELS) {
      const count = grid[reelCount].filter((id) => id === symbol).length;
      if (count === 0) break;
      ways *= count;
      reelCount += 1;
    }
    if (reelCount < 3) continue;
    const n = reelCount as 3 | 4 | 5;
    wins.push({ kind: 'ways', symbol, reelCount: n, ways, payout: WAYS_PAYTABLE[symbol][n] * ways * unit, cells: cellsOf(grid, symbol, n) });
  }

  const scatterCells = cellsOf(grid, SCATTER, REELS);
  const scatterPay = scatterMultiplier(scatterCells.length) * bet;
  if (scatterPay > 0) wins.push({ kind: 'scatter', symbol: SCATTER, count: scatterCells.length, payout: scatterPay, cells: scatterCells });

  return { wins, payout: wins.reduce((sum, win) => sum + win.payout, 0) };
}
