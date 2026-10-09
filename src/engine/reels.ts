import { REELS, ROWS, type Grid, type SymbolId } from './symbols.ts';

// Reel strips are generated from symbol counts with a fixed seed, so they are
// identical on every machine and every run. Changing a count changes the
// game's math; run `npm run rtp` afterwards to see the new return.

type StripCounts = Partial<Record<SymbolId, number>>;

const STRIP_COUNTS: StripCounts[] = [
  { lion: 4, elephant: 4, bull: 5, deer: 5, zebra: 5, A: 6, K: 6, Q: 7, J: 7, '10': 8, '9': 8, coin: 2 },
  { lion: 4, elephant: 4, bull: 5, deer: 5, zebra: 5, A: 6, K: 6, Q: 7, J: 7, '10': 8, '9': 8, coin: 2 },
  { lion: 4, elephant: 4, bull: 4, deer: 5, zebra: 5, A: 6, K: 6, Q: 7, J: 7, '10': 8, '9': 8, coin: 2 },
  { lion: 3, elephant: 4, bull: 4, deer: 4, zebra: 5, A: 6, K: 6, Q: 7, J: 7, '10': 8, '9': 8, coin: 2 },
  { lion: 3, elephant: 3, bull: 4, deer: 4, zebra: 4, A: 6, K: 6, Q: 7, J: 7, '10': 8, '9': 8, coin: 2 },
];

/** mulberry32: tiny deterministic PRNG, only used to lay out the strips. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStrip(counts: StripCounts, seed: number): SymbolId[] {
  const strip = Object.entries(counts).flatMap(([symbol, count]) => Array<SymbolId>(count ?? 0).fill(symbol as SymbolId));
  const random = seeded(seed);
  for (let i = strip.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return strip;
}

export const REEL_STRIPS: readonly (readonly SymbolId[])[] = STRIP_COUNTS.map((counts, reel) => buildStrip(counts, 1024 + reel));

/** The ROWS symbols visible when `reel` stops at `stop` (the top row), wrapping around the strip. */
export function windowAt(reel: number, stop: number): SymbolId[] {
  const strip = REEL_STRIPS[reel];
  return Array.from({ length: ROWS }, (_, row) => strip[(stop + row) % strip.length]);
}

export function gridFromStops(stops: number[]): Grid {
  if (stops.length !== REELS) throw new Error(`Expected ${REELS} stops, got ${stops.length}`);
  return stops.map((stop, reel) => windowAt(reel, stop));
}
