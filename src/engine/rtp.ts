import { REEL_STRIPS, windowAt } from './reels.ts';
import { BET_MULTIPLIER, FREE_SPINS_AWARD, FREE_SPINS_TRIGGER, REELS, SCATTER, WAYS_PAYTABLE, WAYS_SYMBOLS, WILD, WILD_REELS, scatterMultiplier, type SymbolId } from './symbols.ts';

// Exact theoretical return, computed from the strips rather than simulated.
//
// Reels stop independently, so for a ways symbol the expected number of ways
// across reels 1..k is the product of each reel's expected count (wilds
// included on WILD_REELS). A win of exactly k reels also needs reel k+1 to
// have none of the symbol or a wild.
//
// Free spins play the same reels at the same bet, so each one is worth the
// same as a paid spin. A trigger awards FREE_SPINS_AWARD spins and each of
// those can retrigger with probability p, so one trigger leads to
// FREE_SPINS_AWARD / (1 − FREE_SPINS_AWARD·p) free spins on average.
// The max-win cap is ignored here; it only trims extremely rare outcomes.

export type RtpBreakdown = {
  total: number;
  /** Return of a single spin (paid or free), split by symbol. */
  bySymbol: Record<Exclude<SymbolId, typeof WILD>, number>;
  perSpin: number;
  /** Share of `total` paid out during free spins. */
  freeSpins: number;
  /** Chance a spin awards free spins. */
  triggerRate: number;
  /** Average number of free spins one trigger leads to, retriggers included. */
  freeSpinsPerTrigger: number;
};

/** For each reel, how often the window holds 0..ROWS symbols matching `isMatch`. */
function countDistribution(reel: number, isMatch: (id: SymbolId) => boolean): number[] {
  const strip = REEL_STRIPS[reel];
  const dist = [0, 0, 0, 0, 0];
  for (let stop = 0; stop < strip.length; stop += 1) {
    dist[windowAt(reel, stop).filter(isMatch).length] += 1 / strip.length;
  }
  return dist;
}

const mean = (dist: number[]) => dist.reduce((sum, p, n) => sum + p * n, 0);

export function computeRtp(): RtpBreakdown {
  const bySymbol = {} as RtpBreakdown['bySymbol'];
  for (const symbol of WAYS_SYMBOLS) {
    const dists = Array.from({ length: REELS }, (_, reel) => countDistribution(reel, (id) => id === symbol || (id === WILD && WILD_REELS.includes(reel))));
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
    const dist = countDistribution(reel, (id) => id === SCATTER);
    const next = Array<number>(total.length + dist.length - 1).fill(0);
    total.forEach((p, a) => dist.forEach((q, b) => { next[a + b] += p * q; }));
    total = next;
  }
  bySymbol[SCATTER] = total.reduce((sum, p, n) => sum + p * scatterMultiplier(n), 0);
  const triggerRate = total.reduce((sum, p, n) => sum + (n >= FREE_SPINS_TRIGGER ? p : 0), 0);

  if (FREE_SPINS_AWARD * triggerRate >= 1) throw new Error('Free spins would retrigger forever on average');
  const perSpin = Object.values(bySymbol).reduce((sum, value) => sum + value, 0);
  const freeSpinsPerTrigger = FREE_SPINS_AWARD / (1 - FREE_SPINS_AWARD * triggerRate);
  const freeSpins = perSpin * triggerRate * freeSpinsPerTrigger;

  return { total: perSpin + freeSpins, bySymbol, perSpin, freeSpins, triggerRate, freeSpinsPerTrigger };
}
