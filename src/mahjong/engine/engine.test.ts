import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_HEIGHTS, boardFromStops, evaluateWays, freeSpinsForHu, multiplierForCascade, replaySpin, settleFreeSpin, settleSpin, type PayTable, type Token } from './index.ts';

const token = (symbolId: Token['symbolId']): Token => ({ symbolId });
const payTable: PayTable = { FA: { 3: 10 }, ZHONG: { 3: 20 } };
const filler = token('BAM2');
const strips = [
  [token('ZHONG'), token('FA'), filler, token('DOT1'), token('BAM1'), token('DOT2')],
  [token('ZHONG'), token('FA'), filler, token('DOT2'), token('BAM1'), token('DOT1')],
  [token('ZHONG'), token('FA'), filler, token('DOT3'), token('BAM1'), token('DOT1')],
  [token('WAN8'), token('DOT1'), token('BAM1'), token('DOT2'), token('BAM2')],
  [token('DOT1'), token('BAM1'), token('DOT2'), token('BAM2'), token('DOT3')],
] as const;

describe('麻将连连胡 STEP-25 特殊牌、免费旋转与封顶引擎', () => {
  it('按停点取 4-5-5-5-4 盘面，并在轴带末尾循环', () => {
    const board = boardFromStops(strips, [5, 5, 5, 4, 4]);
    assert.deepEqual(board.map((column) => column.length), BOARD_HEIGHTS);
    assert.equal(board[0][0].symbolId, 'DOT2');
    assert.equal(board[0][1].symbolId, 'ZHONG');
  });

  it('满屏同牌的 ways 是 4×5×5×5×4 = 2000', () => {
    const full = BOARD_HEIGHTS.map((height) => Array.from({ length: height }, () => token('FA')));
    const [win] = evaluateWays(full, 1, { FA: { 5: 1 } });
    assert.equal(win.ways, 2000);
    assert.equal(win.payout, 2000);
  });

  it('实现设计文档例 A：普通旋转两连消除及 1/2 倍数', () => {
    const outcome = settleSpin([1, 1, 1, 0, 0], 2, strips, payTable);
    assert.equal(outcome.cascadeSteps.length, 2);
    assert.deepEqual(outcome.cascadeSteps.map((step) => step.wins[0].symbolId), ['FA', 'ZHONG']);
    assert.deepEqual(outcome.cascadeSteps.map((step) => step.cascadeMultiplier), [1, 2]);
    assert.deepEqual(outcome.cascadeSteps.map((step) => step.payout), [20, 80]);
    assert.equal(outcome.payout, 100);
    assert.deepEqual(outcome.cascadeSteps[0].refills.slice(0, 3).map((column) => column[0].symbolId), ['ZHONG', 'ZHONG', 'ZHONG']);
  });

  it('补牌持续从初始窗口上方按确定顺序取得', () => {
    const outcome = settleSpin([1, 1, 1, 0, 0], 1, strips, payTable);
    assert.equal(outcome.cascadeSteps[0].afterBoard[0][0].symbolId, 'ZHONG');
    assert.equal(outcome.cascadeSteps[1].refills[0][0].symbolId, 'DOT2');
  });

  it('第 4 次及以后固定为 ×5，且同一停点完全可重现', () => {
    assert.deepEqual([1, 2, 3, 4, 9].map(multiplierForCascade), [1, 2, 3, 5, 5]);
    assert.deepEqual(settleSpin([1, 1, 1, 0, 0], 2, strips, payTable), settleSpin([1, 1, 1, 0, 0], 2, strips, payTable));
  });

  it('命中的金色普通牌原地变成百搭，随后才可替代普通牌', () => {
    const gold = (symbolId: Token['symbolId']): Token => ({ symbolId, golden: true });
    const goldStrips = [
      [token('FA'), filler, filler, filler],
      [gold('FA'), filler, filler, filler, filler],
      [token('FA'), filler, filler, filler, filler],
      [token('DOT1'), filler, filler, filler, filler],
      [token('DOT2'), filler, filler, filler],
    ] as const;
    const outcome = settleSpin([0, 0, 0, 0, 0], 1, goldStrips, { FA: { 3: 1 }, ZHONG: { 3: 1 } });
    assert.deepEqual(outcome.cascadeSteps[0].goldenTransforms, [{ x: 1, y: 0 }]);
    assert.equal(outcome.cascadeSteps[0].beforeBoard[1][0].symbolId, 'FA');
    assert.equal(outcome.cascadeSteps[0].afterBoard[1].some((entry) => entry.symbolId === 'WILD'), true);
    assert.equal(evaluateWays([[token('ZHONG')], [token('WILD')], [token('ZHONG')]], 1, { ZHONG: { 3: 1 } })[0].ways, 1);
  });

  it('百搭不会替代胡，胡也不会参与消除或赔付', () => {
    const board = [[token('HU')], [token('WILD')], [token('HU')], [token('WILD')], [token('HU')]];
    assert.equal(evaluateWays(board, 1, { FA: { 3: 1 } }).length, 0);
  });

  it('3/4/5 个胡分别奖励 10/12/14 次免费旋转', () => {
    assert.deepEqual([3, 4, 5].map(freeSpinsForHu), [10, 12, 14]);
  });

  it('免费旋转先减一，再按胡牌奖励追加，并使用 2/4/6/10 倍数', () => {
    const huStrips = [
      [token('HU'), filler, filler, filler],
      [token('HU'), filler, filler, filler, filler],
      [token('HU'), filler, filler, filler, filler],
      [token('HU'), filler, filler, filler, filler],
      [token('DOT1'), filler, filler, filler],
    ] as const;
    const free = settleFreeSpin({ bet: 1, remaining: 10, parentTotalWin: 0, capped: false }, [0, 0, 0, 0, 0], huStrips, {});
    assert.equal(free.outcome.freeSpinsAwarded, 12);
    assert.equal(free.state?.remaining, 21);
    assert.deepEqual([1, 2, 3, 4, 9].map((index) => multiplierForCascade(index, 'free')), [2, 4, 6, 10, 10]);
  });

  it('付费回合达到 1708 倍上限即截断并结束', () => {
    const fullFa = BOARD_HEIGHTS.map((height) => Array.from({ length: height }, () => token('FA')));
    const outcome = settleSpin([0, 0, 0, 0, 0], 1, fullFa, { FA: { 5: 1 } });
    assert.equal(outcome.payout, 1708);
    assert.equal(outcome.capped, true);
    assert.equal(outcome.cascadeSteps.length, 1);
    assert.equal(outcome.freeSpinsAwarded, 0);
  });

  it('回放只凭记录重现原局，随机 2,000 局以上逐项一致', () => {
    let seed = 0x25_10_2026;
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let index = 0; index < 2_100; index += 1) {
      const stops = [next() % 9, next() % 9, next() % 9, next() % 9, next() % 9] as const;
      const original = settleSpin(stops, 2);
      assert.deepEqual(replaySpin(original.replayInput), original);
    }
  });
});
