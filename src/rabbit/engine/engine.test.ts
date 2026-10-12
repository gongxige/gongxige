import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_HEIGHTS, PAYLINES, PAYTABLE, TEMPORARY_STRIPS, boardFromStops, evaluateLines, settleSpin, type Board, type PayTable, type SymbolId, type Token } from './index.ts';

const cell = (symbolId: SymbolId, stackGroupId = `test-${symbolId}`): Token => ({ symbolId, stackGroupId });

function board(...rows: string[]): Board {
  const cells = rows.map((row) => row.trim().split(/\s+/) as SymbolId[]);
  if (cells.length !== 4 || cells.some((row) => row.length !== 3)) throw new Error('测试盘面必须是 4 行 3 列');
  return [
    cells.slice(0, 3).map((row, y) => cell(row[0], `x0-y${y}`)),
    cells.map((row, y) => cell(row[1], `x1-y${y}`)),
    cells.slice(0, 3).map((row, y) => cell(row[2], `x2-y${y}`)),
  ];
}

describe('玉兔送财 STEP-37 盘面和线奖', () => {
  it('冻结 3-4-3 盘面和设计文档中的 10 条线', () => {
    assert.deepEqual(BOARD_HEIGHTS, [3, 4, 3]);
    assert.equal(PAYLINES.length, 10);
    assert.deepEqual(PAYLINES[0], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    assert.deepEqual(PAYLINES[5], [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
    assert.deepEqual(PAYLINES[9], [{ x: 0, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 2 }]);
    assert.deepEqual(PAYTABLE, {
      WILD: 200, YUANBAO: 100, FU_BAG: 50, RED_ENVELOPE: 10,
      COPPER_COIN: 8, FIRECRACKER: 6, CARROT: 4,
    });
  });

  it('按停点取出 3-4-3 盘面，并在轴带末尾环绕', () => {
    const strips = [
      [cell('YUANBAO', 'left-a'), cell('FU_BAG', 'left-b'), cell('CARROT', 'left-c')],
      [cell('RED_ENVELOPE', 'middle-a'), cell('WILD', 'middle-b'), cell('COPPER_COIN', 'middle-c'), cell('FIRECRACKER', 'middle-d')],
      [cell('CARROT', 'right-a'), cell('YUANBAO', 'right-b'), cell('FU_BAG', 'right-c')],
    ] as const;
    const result = boardFromStops(strips, [2, 3, 1]);
    assert.deepEqual(result.map((column) => column.map((entry) => entry.symbolId)), [
      ['CARROT', 'YUANBAO', 'FU_BAG'],
      ['FIRECRACKER', 'RED_ENVELOPE', 'WILD', 'COPPER_COIN'],
      ['YUANBAO', 'FU_BAG', 'CARROT'],
    ]);
  });

  it('临时轴带用连续 stackGroupId 表示叠放，且不会改变逐格盘面', () => {
    assert.equal(TEMPORARY_STRIPS[0][0].stackGroupId, TEMPORARY_STRIPS[0][1].stackGroupId);
    assert.equal(TEMPORARY_STRIPS[1][0].stackGroupId, TEMPORARY_STRIPS[1][1].stackGroupId);
    const result = boardFromStops(TEMPORARY_STRIPS, [0, 0, 0]);
    assert.equal(result[0][0].stackGroupId, result[0][1].stackGroupId);
    assert.notEqual(result[0][0], TEMPORARY_STRIPS[0][0], '取盘面不会复用可变对象');
  });

  it('覆盖设计文档例 A：元宝-百搭-元宝与胡萝卜线分别结算', () => {
    const result = evaluateLines(board(
      'YUANBAO WILD YUANBAO',
      'CARROT CARROT CARROT',
      'COPPER_COIN FIRECRACKER FU_BAG',
      'YUANBAO RED_ENVELOPE CARROT',
    ), 100);
    assert.deepEqual(result.map((win) => [win.lineNumber, win.symbolId, win.payout]), [
      [1, 'YUANBAO', 1_000],
      [6, 'CARROT', 40],
    ]);
    assert.equal(result.reduce((total, win) => total + win.payout, 0), 1_040);
  });

  it('百搭替代普通符号，但全百搭只支付一次百搭奖', () => {
    const mixed = evaluateLines(board(
      'YUANBAO WILD YUANBAO',
      'COPPER_COIN FIRECRACKER RED_ENVELOPE',
      'FU_BAG CARROT COPPER_COIN',
      'RED_ENVELOPE YUANBAO FIRECRACKER',
    ), 100);
    assert.deepEqual(mixed.map((win) => [win.lineNumber, win.symbolId, win.payout]), [[1, 'YUANBAO', 1_000]]);

    const allWild = board(
      'WILD WILD WILD',
      'COPPER_COIN FIRECRACKER RED_ENVELOPE',
      'FU_BAG CARROT COPPER_COIN',
      'RED_ENVELOPE YUANBAO FIRECRACKER',
    );
    const wildLine = evaluateLines(allWild, 100).find((win) => win.lineNumber === 1);
    assert.deepEqual(wildLine && [wildLine.symbolId, wildLine.payout], ['WILD', 2_000]);
  });

  it('每条线只保留最高候选，十条线中奖金额相加', () => {
    const result = evaluateLines(board(
      'YUANBAO WILD YUANBAO',
      'CARROT CARROT CARROT',
      'COPPER_COIN FIRECRACKER FU_BAG',
      'YUANBAO RED_ENVELOPE CARROT',
    ), 100, { ...PAYTABLE, YUANBAO: 100, CARROT: 4 } satisfies PayTable);
    assert.equal(result.length, 2);
    assert.equal(result.reduce((total, win) => total + win.payout, 0), 1_040);
  });

  it('非 10 倍投注按每条线独立四舍五入，.5 向上', () => {
    const carrot = board(
      'COPPER_COIN FIRECRACKER FU_BAG',
      'CARROT CARROT CARROT',
      'YUANBAO RED_ENVELOPE COPPER_COIN',
      'FU_BAG YUANBAO FIRECRACKER',
    );
    assert.equal(evaluateLines(carrot, 101).find((win) => win.lineNumber === 6)?.payout, 40);
    assert.equal(evaluateLines(carrot, 101, { CARROT: 5 }).find((win) => win.lineNumber === 6)?.payout, 51);
  });

  it('同一组停点重复结算结果完全相同', () => {
    const first = settleSpin([7, 8, 9], 100);
    const second = settleSpin([7, 8, 9], 100);
    assert.deepEqual(second, first);
  });
});
