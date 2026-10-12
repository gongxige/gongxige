import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_HEIGHTS, evaluateLines } from './engine/index.ts';
import { openingBoard } from './openingBoard.ts';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('玉兔送财开局盘面', () => {
  it('打开游戏未转动时是 3-4-3 的普通符号，没有空白格和奖金牌匾，也不构成中奖线', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const board = openingBoard(seeded(seed));
      assert.deepEqual(board.map((column) => column.length), [...BOARD_HEIGHTS]);
      for (const entry of board.flat()) assert.ok(entry.symbolId !== 'BLANK' && entry.symbolId !== 'BONUS_PLATE', `seed ${seed}: ${entry.symbolId}`);
      assert.equal(evaluateLines(board, 100).length, 0, `seed ${seed}`);
    }
  });

  it('随机数始终找不到合适停点时退回固定的普通符号盘面', () => {
    const board = openingBoard(() => 0.999_999);
    for (const entry of board.flat()) assert.ok(entry.symbolId !== 'BLANK' && entry.symbolId !== 'BONUS_PLATE');
    assert.equal(evaluateLines(board, 100).length, 0);
  });
});
