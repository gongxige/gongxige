import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_HEIGHTS, boardFromStops, evaluateWays, multiplierForCascade, settleSpin, type PayTable, type Token } from './index.ts';

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

describe('麻将连连胡 STEP-24 基础引擎', () => {
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
});
