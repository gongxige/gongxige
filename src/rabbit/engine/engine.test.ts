import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_HEIGHTS, ENGINE_VERSION, MAX_WIN_MULTIPLIER, MATH_CONFIG_VERSION, MODE_SPINS, PAYLINES, PAYTABLE, STRIP_REVISION, TEMPORARY_MODE_STRIPS, TEMPORARY_STRIPS, boardFromStops, evaluateBonusPlates, evaluateLines, replayRound, settleRound, settleSpin, type Board, type PayTable, type ReplayInput, type ReelStrips, type SymbolId, type Token } from './index.ts';

const cell = (symbolId: SymbolId, stackGroupId = `test-${symbolId}`): Token => ({ symbolId, stackGroupId });
const bonus = (tier: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, stackGroupId = `bonus-${tier}`): Token => ({ symbolId: 'BONUS_PLATE', stackGroupId, bonusTier: tier });

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

describe('玉兔送财 STEP-38 奖金牌匾、玉兔模式、封顶和回放', () => {
  const replayBase = (overrides: Partial<ReplayInput> = {}): ReplayInput => ({
    gameId: 'jade-rabbit',
    engineVersion: ENGINE_VERSION,
    mathConfigVersion: MATH_CONFIG_VERSION,
    stripRevision: STRIP_REVISION,
    bet: 100,
    parentRoundId: 'rabbit-test-round',
    mode: 'paid',
    triggerRoll: 0.5,
    paidStops: [0, 0, 0],
    modeStops: [],
    capRemainingBefore: 100 * MAX_WIN_MULTIPLIER,
    ...overrides,
  });

  const quietStrips: ReelStrips = [
    [cell('CARROT', 'quiet-left')],
    [cell('FIRECRACKER', 'quiet-middle')],
    [cell('COPPER_COIN', 'quiet-right')],
  ];
  const blankModeStrips: ReelStrips = [
    [cell('BLANK', 'blank-left')],
    [cell('BLANK', 'blank-middle')],
    [cell('BLANK', 'blank-right')],
  ];
  const highModeStrips: ReelStrips = [
    [bonus(9, 'high-left')],
    [bonus(9, 'high-middle')],
    [bonus(9, 'high-right')],
  ];

  it('4 个奖金牌匾不赔，5 个以上支付全部数值之和', () => {
    const four: Board = [
      [bonus(0, 'a'), bonus(1, 'b'), bonus(2, 'c')],
      [bonus(3, 'd'), cell('CARROT', 'empty-1'), cell('CARROT', 'empty-2'), cell('CARROT', 'empty-3')],
      [cell('CARROT', 'empty-4'), cell('CARROT', 'empty-5'), cell('CARROT', 'empty-6')],
    ];
    const six: Board = [
      [bonus(0, 'a'), cell('CARROT', 'empty-1'), bonus(2, 'b')],
      [bonus(1, 'c'), cell('CARROT', 'empty-2'), cell('CARROT', 'empty-3'), bonus(3, 'd')],
      [cell('CARROT', 'empty-4'), bonus(4, 'e'), bonus(5, 'f')],
    ];
    assert.equal(evaluateBonusPlates(four, 100).length, 4);
    assert.equal(evaluateBonusPlates(four, 100).reduce((sum, win) => sum + win.value, 0), 850);
    assert.equal(settleSpin([0, 0, 0], 100, [four[0], four[1], four[2]] as ReelStrips).bonusPayout, 0);
    const wins = evaluateBonusPlates(six, 100);
    assert.equal(wins.length, 6);
    assert.equal(wins.reduce((sum, win) => sum + win.value, 0), 3_850);
    assert.equal(settleSpin([0, 0, 0], 100, [six[0], six[1], six[2]] as ReelStrips).bonusPayout, 3_850);
  });

  it('百搭不替代奖金牌匾，也不增加奖金牌匾计数', () => {
    const mixed: Board = [
      [bonus(0, 'a'), cell('WILD', 'wild-a'), bonus(1, 'b')],
      [cell('WILD', 'wild-b'), cell('CARROT', 'empty-1'), cell('CARROT', 'empty-2'), cell('CARROT', 'empty-3')],
      [cell('CARROT', 'empty-4'), cell('CARROT', 'empty-5'), cell('CARROT', 'empty-6')],
    ];
    assert.equal(evaluateBonusPlates(mixed, 100).length, 2);
    assert.equal(evaluateLines(mixed, 100).some((win) => win.symbolId === 'BONUS_PLATE'), false);
  });

  it('触发玉兔模式时正好执行 8 次，且每次只出现奖金牌匾和空白格', () => {
    const outcome = settleRound(replayBase({
      triggerRoll: 0,
      modeStops: Array.from({ length: MODE_SPINS }, () => [0, 0, 0] as const),
    }), quietStrips, TEMPORARY_MODE_STRIPS);
    assert.equal(outcome.triggered, true);
    assert.equal(outcome.modeSpins.length, MODE_SPINS);
    assert.equal(outcome.remainingModeSpins, 0);
    for (const spin of outcome.modeSpins) {
      assert.ok(spin.board.flat().every((token) => token.symbolId === 'BONUS_PLATE' || token.symbolId === 'BLANK'));
    }
  });

  it('一轮总赢分达到 5,000 倍后立即结束并截断派彩', () => {
    const outcome = settleRound(replayBase({
      triggerRoll: 0,
      modeStops: Array.from({ length: MODE_SPINS }, () => [0, 0, 0] as const),
    }), quietStrips, highModeStrips);
    assert.equal(outcome.capped, true);
    assert.equal(outcome.totalWin, 100 * MAX_WIN_MULTIPLIER);
    assert.equal(outcome.modeSpins.length, 1);
    assert.equal(outcome.modeSpins[0].payout, 100 * MAX_WIN_MULTIPLIER - outcome.paidSpin.payout);
    assert.equal(outcome.remainingModeSpins, MODE_SPINS - 1);
  });

  it('只凭回放记录重现整轮，随机 2,000 局逐项完全一致', () => {
    let state = 0x5eed1234;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    const strips: ReelStrips = [
      [cell('YUANBAO', 'r0'), cell('CARROT', 'r1'), cell('WILD', 'r2'), cell('FU_BAG', 'r3'), cell('COPPER_COIN', 'r4')],
      [cell('FU_BAG', 'r5'), cell('RED_ENVELOPE', 'r6'), cell('WILD', 'r7'), cell('FIRECRACKER', 'r8'), cell('CARROT', 'r9'), cell('YUANBAO', 'r10')],
      [cell('CARROT', 'r11'), cell('YUANBAO', 'r12'), cell('FU_BAG', 'r13'), cell('WILD', 'r14'), cell('COPPER_COIN', 'r15')],
    ];
    for (let index = 0; index < 2_000; index += 1) {
      const triggerRoll = index % 79 === 0 ? 0 : 0.5;
      const modeStops = triggerRoll === 0
        ? Array.from({ length: MODE_SPINS }, () => [next() % 5, next() % 6, next() % 5] as const)
        : [];
      const input = replayBase({
        parentRoundId: `random-${index}`,
        triggerRoll,
        paidStops: [next() % 5, next() % 6, next() % 5],
        modeStops,
      });
      const original = settleRound(input, strips, blankModeStrips);
      assert.deepEqual(replayRound(original.replayInput, strips, blankModeStrips), original);
    }
  });
});
