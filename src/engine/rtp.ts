import { REEL_STRIPS, windowAt } from './reels.ts';
import { BET_MULTIPLIER, REELS, SCATTER, WAYS_PAYTABLE, WAYS_SYMBOLS, scatterMultiplier, type SymbolId } from './symbols.ts';

// Exact theoretical return, computed from the strips rather than simulated.
//
// Reels stop independently, so for a ways symbol the expected number of ways
// across reels 1..k is the product of each reel's expected count. A win of
// exactly k reels also needs reel k+1 to have none of the symbol.
// The max-win cap is ignored here; it only trims extremely rare outcomes.

export type RtpBreakdown = { total: number; bySymbol: Record<SymbolId, number> };

/** For each reel, how often the window holds 0..ROWS copies of `symbol`. */
function countDistribution(reel: number, symbol: SymbolId): number[] {
  const strip = REEL_STRIPS[reel];
  const dist = [0, 0, 0, 0, 0];
  for (let stop = 0; stop < strip.length; stop += 1) {
    dist[windowAt(reel, stop).filter((id) => id === symbol).length] += 1 / strip.length;
  }
  return dist;
}

const mean = (dist: number[]) => dist.reduce((sum, p, n) => sum + p * n, 0);

export function computeRtp(): RtpBreakdown {
  const bySymbol = {} as Record<SymbolId, number>;
  for (const symbol of WAYS_SYMBOLS) {
    const dists = Array.from({ length: REELS }, (_, reel) => countDistribution(reel, symbol));
    let expected = 0;
    for (const k of [3, 4, 5] as const) {
      const ways = dists.slice(0, k).reduce((product, dist) => product * mean(dist), 1);
      const stopsHere = k < REELS ? dists[k][0] : 1;
      expected += WAYS_PAYTABLE[symbol][k] * ways * stopsHere;
    }
    bySymbol[symbol] = expected / BET_MULTIPLIER;
  }

  // Scatter: convolve the per-reel count distributions into a total-count distribution.
  let total = [1];
  for (let reel = 0; reel < REELS; reel += 1) {
    const dist = countDistribution(reel, SCATTER);
    const next = Array<number>(total.length + dist.length - 1).fill(0);
    total.forEach((p, a) => dist.forEach((q, b) => { next[a + b] += p * q; }));
    total = next;
  }
  bySymbol[SCATTER] = total.reduce((sum, p, n) => sum + p * scatterMultiplier(n), 0);

  return { total: Object.values(bySymbol).reduce((sum, value) => sum + value, 0), bySymbol };
}
