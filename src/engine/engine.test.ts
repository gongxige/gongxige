import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALLOWED_BETS, BET_MULTIPLIER, REEL_STRIPS, ROWS, WAYS_PAYTABLE, WILD_REELS, computeRtp, evaluate, gridFromStops, playRound, replaySpin, spin, windowAt, type Grid, type MultiplierGrid, type SymbolId } from './index.ts';

/** Write grids the way they look on screen (one string per row), get grid[reel][row]. */
function grid(...rows: string[]): Grid {
  const cells = rows.map((row) => row.trim().split(/\s+/) as SymbolId[]);
  return cells[0].map((_, reel) => cells.map((row) => row[reel]));
}

/** Same layout for multipliers: one string of numbers per row. */
function multipliers(...rows: string[]): MultiplierGrid {
  const cells = rows.map((row) => row.trim().split(/\s+/).map(Number));
  return cells[0].map((_, reel) => cells.map((row) => row[reel]));
}

const bet = 80;
const unit = bet / BET_MULTIPLIER;
const pay = (symbol: keyof typeof WAYS_PAYTABLE, n: 2 | 3 | 4 | 5) => WAYS_PAYTABLE[symbol][n] ?? 0;

describe('paytable', () => {
  it('matches the reference pay screen', () => {
    assert.deepEqual(WAYS_PAYTABLE.bull, { 2: 10, 3: 50, 4: 100, 5: 250 });
    assert.deepEqual(WAYS_PAYTABLE.lion, { 3: 50, 4: 100, 5: 150 });
    assert.deepEqual(WAYS_PAYTABLE.zebra, { 3: 20, 4: 80, 5: 120 });
    assert.deepEqual(WAYS_PAYTABLE.A, { 3: 10, 4: 50, 5: 80 });
    assert.deepEqual(WAYS_PAYTABLE.Q, { 3: 5, 4: 20, 5: 60 });
    assert.deepEqual(WAYS_PAYTABLE['9'], { 3: 5, 4: 10, 5: 60 });
  });
});

describe('evaluate', () => {
  it('pays a 3-reel ways win, multiplying ways by the symbol count on each reel', () => {
    const result = evaluate(grid(
      'lion  lion  lion  9 9',
      'Q     lion  K     J 10',
      'A     K     Q     J 10',
      'A     K     Q     J 9',
    ), bet);
    assert.equal(result.wins.length, 1);
    const [win] = result.wins;
    assert.ok(win.kind === 'ways');
    assert.equal(win.symbol, 'lion');
    assert.equal(win.reelCount, 3);
    assert.equal(win.ways, 2);
    assert.equal(result.payout, pay('lion', 3) * 2 * unit);
    assert.deepEqual(win.cells, [{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 1, row: 1 }, { reel: 2, row: 0 }]);
  });

  it('the buffalo pays for just two reels; other symbols need three', () => {
    const result = evaluate(grid(
      'bull  bull  Q  Q  9',
      'lion  lion  J  J  10',
      'A     K     10 J  10',
      'K     A     9  10 9',
    ), bet);
    assert.deepEqual(result.wins.map((w) => w.symbol), ['bull']);
    assert.equal(result.payout, pay('bull', 2) * unit);
  });

  it('a full screen of one symbol is 4^5 = 1024 ways', () => {
    const row = 'deer deer deer deer deer';
    const result = evaluate(grid(row, row, row, row), bet);
    assert.equal(result.wins[0].kind === 'ways' && result.wins[0].ways, 1024);
    assert.equal(result.payout, pay('deer', 5) * 1024 * unit);
  });

  it('needs consecutive reels starting from the leftmost', () => {
    const gap = evaluate(grid(
      'zebra zebra K     zebra zebra',
      'A     Q     J     10    9',
      'A     Q     J     10    9',
      'K     A     Q     J     10',
    ), bet);
    assert.equal(gap.payout, 0);

    const notFromLeft = evaluate(grid(
      'A     zebra zebra zebra zebra',
      'K     Q     J     10    9',
      'K     Q     J     10    9',
      'Q     A     K     J     10',
    ), bet);
    assert.equal(notFromLeft.payout, 0);
  });

  it('pays scatters anywhere on the grid as a multiple of the total bet', () => {
    const scatterPay = (result: ReturnType<typeof evaluate>) => result.wins.find((w) => w.kind === 'scatter')?.payout;
    const three = evaluate(grid(
      'coin  A     K     Q     J',
      'A     K     coin  J     10',
      'K     Q     J     10    coin',
      'Q     J     10    9     A',
    ), bet);
    assert.equal(scatterPay(three), 2 * bet);

    const six = evaluate(grid(
      'coin  coin  K     Q     J',
      'A     K     coin  J     10',
      'K     Q     coin  10    coin',
      'Q     J     10    coin  A',
    ), bet);
    assert.equal(scatterPay(six), 20 * bet, '5 or more scatters pay the 5-scatter prize');
  });

  it('adds up several wins in one spin', () => {
    const result = evaluate(grid(
      'A  A  A  Q  Q',
      'K  K  K  J  J',
      '9  10 J  10 9',
      '10 J  9  9  10',
    ), bet);
    assert.deepEqual(result.wins.map((w) => w.symbol).sort(), ['A', 'K']);
    assert.equal(result.payout, (pay('A', 3) + pay('K', 3)) * unit);
  });

  it('wilds on reels 2–4 stand in for the symbol and add to the ways', () => {
    const result = evaluate(grid(
      'lion  wild  A     Q  9',
      'K     lion  wild  J  10',
      'A     K     lion  9  10',
      'Q     J     K     10 9',
    ), bet);
    const lion = result.wins.find((w) => w.symbol === 'lion');
    assert.ok(lion && lion.kind === 'ways');
    assert.equal(lion.ways, 2 * 2); // reel 2: lion + wild, reel 3: lion + wild
    assert.equal(lion.multipliedWays, 4, 'no multipliers in the base game');
    assert.equal(lion.payout, pay('lion', 3) * 4 * unit);
    assert.ok(lion.cells.some((c) => c.reel === 1 && c.row === 0), 'the wild cell is part of the win');
  });

  it('a wild on reel 1 or 5 does not substitute, and wilds never count as scatters', () => {
    assert.deepEqual(WILD_REELS, [1, 2, 3]);
    const result = evaluate(grid(
      'wild  zebra zebra 9    A',
      'K     coin  wild  J    10',
      'A     K     coin  wild 10',
      'Q     J     K     10   9',
    ), bet);
    assert.equal(result.wins.find((w) => w.symbol === 'zebra'), undefined, 'reel 1 has no real zebra');
    assert.equal(result.freeSpinsAwarded, 0, 'two coins in the base game is not a trigger');
  });

  it('in free spins each wild multiplies the ways through it, and multipliers on one way multiply', () => {
    const g = grid(
      'lion  wild  wild  Q  9',
      'K     A     J     J  10',
      'A     K     Q     9  10',
      'Q     J     K     10 9',
    );
    const m = multipliers(
      '1 2 3 1 1',
      '1 1 1 1 1',
      '1 1 1 1 1',
      '1 1 1 1 1',
    );
    const lion = evaluate(g, bet, 'free', m).wins.find((w) => w.symbol === 'lion');
    assert.ok(lion && lion.kind === 'ways');
    assert.equal(lion.ways, 1);
    assert.equal(lion.multipliedWays, 6, 'one way through a ×2 and a ×3 wild pays ×6');
    assert.equal(lion.payout, pay('lion', 3) * 6 * unit);
  });

  it('awards 8 / 15 / 20 free spins for 3 / 4 / 5 coins, and 5 / 8 / 15 / 20 more for 2–5 during free spins', () => {
    // One coin on each of the first n reels, nothing else that could win.
    const coins = (n: number) => grid(
      `${n > 0 ? 'coin' : 'K'} A ${n > 2 ? 'coin' : 'K'} Q ${n > 4 ? 'coin' : 'J'}`,
      `A ${n > 1 ? 'coin' : 'Q'} Q J 10`,
      `K Q J ${n > 3 ? 'coin' : '10'} 9`,
      'Q J 10 9 A',
    );
    assert.deepEqual([2, 3, 4, 5].map((n) => evaluate(coins(n), bet, 'base').freeSpinsAwarded), [0, 8, 15, 20]);
    assert.deepEqual([2, 3, 4, 5].map((n) => evaluate(coins(n), bet, 'free').freeSpinsAwarded), [5, 8, 15, 20]);
  });

  it('rejects bets that are not a multiple of the bet multiplier', () => {
    assert.throws(() => evaluate(grid('A A A A A', 'A A A A A', 'A A A A A', 'A A A A A'), BET_MULTIPLIER + 1));
  });
});

describe('reels', () => {
  it('windows wrap around the end of the strip', () => {
    const last = REEL_STRIPS[0].length - 1;
    assert.deepEqual(windowAt(0, last), [REEL_STRIPS[0][last], ...REEL_STRIPS[0].slice(0, ROWS - 1)]);
  });

  it('builds a 5×4 grid from five stops', () => {
    const g = gridFromStops([0, 1, 2, 3, 4]);
    assert.equal(g.length, 5);
    g.forEach((column) => assert.equal(column.length, ROWS));
    assert.throws(() => gridFromStops([0, 0, 0]));
  });
});

describe('spin', () => {
  it('uses the random stops it is given and pays what evaluate says', () => {
    const outcome = spin(bet, () => 7);
    assert.deepEqual(outcome.stops, [7, 7, 7, 7, 7]);
    assert.deepEqual(outcome.grid, gridFromStops([7, 7, 7, 7, 7]));
    assert.equal(outcome.payout, evaluate(outcome.grid, bet).payout);
    assert.ok(outcome.multipliers.flat().every((m) => m === 1), 'no multipliers in the base game');
  });

  it('gives every wild a ×2 or ×3 in free spins, and only wilds', () => {
    let wildsSeen = 0;
    for (let stop = 0; stop < 80; stop += 1) {
      const outcome = spin(bet, (max) => (max === 2 ? stop % 2 : stop % max), Infinity, 'free');
      outcome.grid.forEach((column, reel) => column.forEach((id, row) => {
        const m = outcome.multipliers[reel][row];
        if (id === 'wild') { wildsSeen += 1; assert.ok(m === 2 || m === 3); } else assert.equal(m, 1);
      }));
    }
    assert.ok(wildsSeen > 0);
  });

  it('caps the payout at maxWinMultiplier × bet', () => {
    let stop = 0;
    while (spin(bet, () => stop).payout === 0) stop += 1;
    const raw = spin(bet, () => stop).payout;
    const capped = spin(bet, () => stop, raw / bet / 2);
    assert.equal(capped.payout, raw / 2);
    assert.equal(capped.capped, true);
  });

  it('only accepts the allowed bets', () => {
    assert.throws(() => spin(123, () => 0));
    for (const allowed of ALLOWED_BETS) assert.doesNotThrow(() => spin(allowed, () => 0));
  });
});

describe('replay', () => {
  it('rebuilds every spin exactly from its stops and multipliers', () => {
    let a = 7;
    const randomInt = (max: number) => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a % max; };
    for (let i = 0; i < 2000; i += 1) {
      const mode = i % 3 === 0 ? 'free' : 'base';
      const original = spin(ALLOWED_BETS[i % ALLOWED_BETS.length], randomInt, 1000, mode);
      const replayed = replaySpin({ bet: ALLOWED_BETS[i % ALLOWED_BETS.length], mode, stops: original.stops, multipliers: original.multipliers }, 1000);
      assert.deepEqual(replayed, original);
    }
  });

  it('rejects records that could not have come from a real spin', () => {
    const ones = REEL_STRIPS.map(() => Array(ROWS).fill(1));
    assert.throws(() => replaySpin({ bet, mode: 'base', stops: [0, 0, 0, 0, REEL_STRIPS[4].length], multipliers: ones }));
    assert.throws(() => replaySpin({ bet, mode: 'base', stops: [0, 0, 0, 0, 1.5], multipliers: ones }));
    const doubled = ones.map((column) => column.map(() => 2));
    assert.throws(() => replaySpin({ bet, mode: 'base', stops: [0, 0, 0, 0, 0], multipliers: doubled }));
  });
});

describe('rtp', () => {
  it('theoretical RTP is between 94% and 97%', () => {
    const { total } = computeRtp();
    assert.ok(total > 0.94 && total < 0.97, `RTP was ${total}`);
  });

  it('free spins add to the return, and retriggers keep it finite', () => {
    const rtp = computeRtp();
    assert.ok(rtp.freeSpins > 0 && rtp.retriggerRate < 1);
    assert.ok(rtp.freePerSpin > rtp.basePerSpin, 'wild multipliers make a free spin worth more than a paid one');
    assert.ok(Math.abs(rtp.total - (rtp.basePerSpin + rtp.freeSpins)) < 1e-12);
  });

  it('seeded simulations agree with the exact calculation', () => {
    let a = 42; // mulberry32
    const randomInt = (max: number) => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
    };
    const rtp = computeRtp();
    const spins = 200_000;
    let freePaid = 0;
    for (let i = 0; i < spins; i += 1) freePaid += spin(BET_MULTIPLIER, randomInt, Infinity, 'free').payout;
    assert.ok(Math.abs(freePaid / (BET_MULTIPLIER * spins) - rtp.freePerSpin) < 0.03, 'free spin return');

    const rounds = 300_000;
    let paid = 0;
    for (let i = 0; i < rounds; i += 1) paid += playRound(BET_MULTIPLIER, randomInt).payout;
    assert.ok(Math.abs(paid / (BET_MULTIPLIER * rounds) - rtp.total) < 0.04, `simulated ${paid / (BET_MULTIPLIER * rounds)}`);
  });
});
