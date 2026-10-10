import { REEL_STRIPS, windowAt } from './reels.ts';
import { BET_MULTIPLIER, FREE_SPIN_WILD_MULTIPLIERS, FREE_SPINS_FROM_BASE, FREE_SPINS_RETRIGGER, REELS, SCATTER, WAYS_PAYTABLE, WAYS_SYMBOLS, WILD, WILD_REELS, minReels, scatterMultiplier, type Mode, type ReelCount, type SymbolId } from './symbols.ts';

// Exact theoretical return, computed from the strips rather than simulated.
//
// Ways: reels stop independently, so the expected (multiplied) ways across
// reels 1..k is the product of each reel's expected weight, where a real
// symbol weighs 1 and a wild weighs its multiplier (1 in the base game, the
// average of FREE_SPIN_WILD_MULTIPLIERS in free spins). A win of exactly k
// reels also needs reel k+1 to have neither the symbol nor a wild.
//
// Free spins: every paid spin awards E0 free spins on average, and every free
// spin awards `a` more, so a paid spin leads to E0 / (1 − a) free spins.
// The max-win cap is ignored here; it only trims extremely rare outcomes.

export type RtpBreakdown = {
  total: number;
  /** Return of one paid spin's own result, split by symbol. */
  bySymbol: Record<Exclude<SymbolId, typeof WILD>, number>;
  basePerSpin: number;
  /** Return of one free spin (wild multipliers included). */
  freePerSpin: number;
  /** Share of `total` paid out during free spins. */
  freeSpins: number;
  /** Chance a paid spin awards free spins. */
  triggerRate: number;
  /** Average free spins played per trigger, extra ones included. */
  freeSpinsPerTrigger: number;
  /** Average extra free spins awarded by one free spin. */
  retriggerRate: number;
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
const averageWildMultiplier = FREE_SPIN_WILD_MULTIPLIERS.reduce((a, b) => a + b, 0) / FREE_SPIN_WILD_MULTIPLIERS.length;

function waysReturn(mode: Mode): Record<string, number> {
  const result: Record<string, number> = {};
  for (const symbol of WAYS_SYMBOLS) {
    const any = Array.from({ length: REELS }, (_, reel) => countDistribution(reel, (id) => id === symbol || (id === WILD && WILD_REELS.includes(reel))));
    const wilds = Array.from({ length: REELS }, (_, reel) => (WILD_REELS.includes(reel) ? mean(countDistribution(reel, (id) => id === WILD)) : 0));
    const extra = mode === 'free' ? averageWildMultiplier - 1 : 0;
    const weight = (reel: number) => mean(any[reel]) + extra * wilds[reel];
    let expected = 0;
    for (let k = minReels(symbol); k <= REELS; k += 1) {
      const pay = WAYS_PAYTABLE[symbol][k as ReelCount] ?? 0;
      let ways = 1;
      for (let reel = 0; reel < k; reel += 1) ways *= weight(reel);
      expected += pay * ways * (k < REELS ? any[k][0] : 1);
    }
    result[symbol] = expected / BET_MULTIPLIER;
  }
  return result;
}

export function computeRtp(): RtpBreakdown {
  // Scatter: convolve the per-reel count distributions into a total-count distribution.
  let scatters = [1];
  for (let reel = 0; reel < REELS; reel += 1) {
    const dist = countDistribution(reel, (id) => id === SCATTER);
    const next = Array<number>(scatters.length + dist.length - 1).fill(0);
    scatters.forEach((p, a) => dist.forEach((q, b) => { next[a + b] += p * q; }));
    scatters = next;
  }
  const expect = (f: (n: number) => number) => scatters.reduce((sum, p, n) => sum + p * f(n), 0);
  const scatterReturn = expect(scatterMultiplier);
  const award = (table: Readonly<Record<number, number>>) => (n: number) => table[Math.min(n, 5)] ?? 0;
  const fromBase = expect(award(FREE_SPINS_FROM_BASE));
  const retriggerRate = expect(award(FREE_SPINS_RETRIGGER));
  if (retriggerRate >= 1) throw new Error('Free spins would retrigger forever on average');
  const triggerRate = expect((n) => ((FREE_SPINS_FROM_BASE[Math.min(n, 5)] ?? 0) > 0 ? 1 : 0));

  const base = waysReturn('base');
  const bySymbol = { ...base, [SCATTER]: scatterReturn } as RtpBreakdown['bySymbol'];
  const basePerSpin = Object.values(bySymbol).reduce((sum, value) => sum + value, 0);
  const freePerSpin = Object.values(waysReturn('free')).reduce((sum, value) => sum + value, 0) + scatterReturn;
  const freeSpinsPerPaidSpin = fromBase / (1 - retriggerRate);
  const freeSpins = freePerSpin * freeSpinsPerPaidSpin;

  return {
    total: basePerSpin + freeSpins,
    bySymbol,
    basePerSpin,
    freePerSpin,
    freeSpins,
    triggerRate,
    freeSpinsPerTrigger: freeSpinsPerPaidSpin / triggerRate,
    retriggerRate,
  };
}
