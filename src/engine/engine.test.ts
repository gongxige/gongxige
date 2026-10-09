import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALLOWED_BETS, BET_MULTIPLIER, FREE_SPINS_AWARD, REEL_STRIPS, ROWS, WAYS_PAYTABLE, WILD_REELS, computeRtp, evaluate, gridFromStops, playRound, spin, windowAt, type Grid, type SymbolId } from './index.ts';

/** Write grids the way they look on screen (one string per row), get grid[reel][row]. */
function grid(...rows: string[]): Grid {
  const cells = rows.map((row) => row.trim().split(/\s+/) as SymbolId[]);
  return cells[0].map((_, reel) => cells.map((row) => row[reel]));
}

const bet = 100;
const unit = bet / BET_MULTIPLIER;

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
    assert.equal(win.kind, 'ways');
    assert.equal(win.symbol, 'lion');
    assert.equal(win.kind === 'ways' && win.reelCount, 3);
    assert.equal(win.kind === 'ways' && win.ways, 2);
    assert.equal(result.payout, WAYS_PAYTABLE.lion[3] * 2 * unit);
    assert.deepEqual(win.cells, [{ reel: 0, row: 0 }, { reel: 1, row: 0 }, { reel: 1, row: 1 }, { reel: 2, row: 0 }]);
  });

  it('a full screen of one symbol is 4^5 = 1024 ways', () => {
    const row = 'deer deer deer deer deer';
    const result = evaluate(grid(row, row, row, row), bet);
    assert.equal(result.wins[0].kind === 'ways' && result.wins[0].ways, 1024);
    assert.equal(result.payout, WAYS_PAYTABLE.deer[5] * 1024 * unit);
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
    const three = evaluate(grid(
      'coin  A     K     Q     J',
      'A     K     coin  J     10',
      'K     Q     J     10    coin',
      'Q     J     10    9     A',
    ), bet);
    const scatterPay = (result: ReturnType<typeof evaluate>) => result.wins.find((w) => w.kind === 'scatter')?.payout;
    assert.equal(scatterPay(three), 4 * bet);

    const six = evaluate(grid(
      'coin  coin  K     Q     J',
      'A     K     coin  J     10',
      'K     Q     coin  10    coin',
      'Q     J     10    coin  A',
    ), bet);
    assert.equal(scatterPay(six), 100 * bet, '5 or more scatters pay the 5-scatter prize');
  });

  it('adds up several wins in one spin', () => {
    const result = evaluate(grid(
      'A  A  A  Q  Q',
      'K  K  K  J  J',
      '9  10 J  10 9',
      '10 J  9  9  10',
    ), bet);
    assert.deepEqual(result.wins.map((w) => w.symbol).sort(), ['A', 'K']);
    assert.equal(result.payout, (WAYS_PAYTABLE.A[3] + WAYS_PAYTABLE.K[3]) * unit);
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
    assert.equal(lion.payout, WAYS_PAYTABLE.lion[3] * 4 * unit);
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
    assert.equal(result.freeSpinsAwarded, 0, 'two coins plus wilds is not a trigger');
  });

  it('three or more scatters award free spins', () => {
    const three = evaluate(grid(
      'coin  A     K     Q     J',
      'A     K     coin  J     10',
      'K     Q     J     10    coin',
      'Q     J     10    9     A',
    ), bet);
    assert.equal(three.freeSpinsAwarded, FREE_SPINS_AWARD);
    assert.equal(FREE_SPINS_AWARD, 8);
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
  });

  it('caps the payout at maxWinMultiplier × bet', () => {
    // Find a winning stop combination, then cap it below its value.
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

describe('rtp', () => {
  it('theoretical RTP is between 94% and 97%', () => {
    const { total } = computeRtp();
    assert.ok(total > 0.94 && total < 0.97, `RTP was ${total}`);
  });

  it('free spins add to the return, and retriggers keep it finite', () => {
    const rtp = computeRtp();
    assert.ok(rtp.freeSpins > 0 && rtp.freeSpins < rtp.perSpin);
    assert.ok(rtp.freeSpinsPerTrigger >= FREE_SPINS_AWARD);
    assert.ok(Math.abs(rtp.total - (rtp.perSpin + rtp.freeSpins)) < 1e-12);
  });

  it('a seeded simulation (free spins included) agrees with the exact calculation', () => {
    let a = 42; // mulberry32
    const randomInt = (max: number) => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
    };
    const rounds = 200_000;
    let paid = 0;
    for (let i = 0; i < rounds; i += 1) paid += playRound(BET_MULTIPLIER, randomInt).payout;
    const simulated = paid / (BET_MULTIPLIER * rounds);
    assert.ok(Math.abs(simulated - computeRtp().total) < 0.03, `simulated ${simulated}`);
  });
});
