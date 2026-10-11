import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAHJONG_MATH_CONFIG, settleSpin, type Stops } from './engine/index.ts';
import { cascadeTimeline } from './cascadeTimeline.ts';

const { strips, payTable } = MAHJONG_MATH_CONFIG;
/** Deterministic stop sequence so the test always covers the same spins. */
function* stopSequence(count: number) {
  let s = 0x2029;
  for (let n = 0; n < count; n += 1) yield strips.map((strip) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % strip.length; }) as unknown as Stops;
}

describe('cascadeTimeline（动画帧完全来自服务器记录的连锁步骤）', () => {
  it('每一段连锁的盘面、高亮格子、倍数、累计赢分都和服务器步骤一致，最后停在 finalBoard', () => {
    let cascades = 0; let goldens = 0; let multi = 0;
    for (const stops of stopSequence(3000)) {
      const outcome = settleSpin(stops, 10_000, strips, payTable);
      const frames = cascadeTimeline(outcome.initialBoard, outcome.finalBoard, outcome.cascadeSteps);
      assert.deepEqual(frames.at(-1)!.board, outcome.cascadeSteps.length ? outcome.finalBoard : outcome.initialBoard);
      assert.equal(frames.at(-1)!.runningWin, outcome.payout, 'counter ends on the round payout');
      const wins = frames.filter((f) => f.phase === 'win');
      assert.equal(wins.length, outcome.cascadeSteps.length, 'one win frame per cascade step');
      outcome.cascadeSteps.forEach((step, i) => {
        const win = wins[i];
        assert.deepEqual(win.board, step.beforeBoard);
        assert.equal(win.multiplier, step.cascadeMultiplier);
        assert.equal(win.multiplierIndex, Math.min(i, 3));
        assert.deepEqual(new Set(win.cells), new Set(step.wins.flatMap((w) => w.cells.map(({ x, y }) => `${x}-${y}`))));
        if (!step.capped) {
          const drop = frames[frames.indexOf(win) + 2];
          assert.equal(drop.phase, 'drop');
          assert.deepEqual(drop.board, step.afterBoard);
          const clear = frames[frames.indexOf(win) + 1];
          assert.deepEqual(new Set(clear.golden), new Set(step.goldenTransforms.map(({ x, y }) => `${x}-${y}`)));
          // A golden tile becomes a wild and then falls with its column, so count wilds per column.
          for (let x = 0; x < 5; x += 1) {
            const turned = step.goldenTransforms.filter((g) => g.x === x).length;
            const wildsBefore = step.beforeBoard[x].filter((t) => t.symbolId === 'WILD').length;
            const wildsAfter = step.afterBoard[x].filter((t) => t.symbolId === 'WILD').length;
            assert.ok(wildsAfter >= turned + wildsBefore - step.removed.filter((r) => r.x === x && step.beforeBoard[x][r.y].symbolId === 'WILD').length, `column ${x}: golden tiles become wilds`);
          }
          goldens += step.goldenTransforms.length;
        }
      });
      cascades += outcome.cascadeSteps.length; if (outcome.cascadeSteps.length >= 2) multi += 1;
    }
    // Make sure the sample really exercised cascades, multi-cascades and golden tiles.
    assert.ok(cascades > 300, `cascades ${cascades}`);
    assert.ok(multi > 20, `multi-cascade spins ${multi}`);
    assert.ok(goldens > 20, `golden transforms ${goldens}`);
  });

  it('没有中奖时只有一帧，就是初始盘面', () => {
    for (const stops of stopSequence(200)) {
      const outcome = settleSpin(stops, 10_000, strips, payTable);
      if (outcome.cascadeSteps.length) continue;
      const frames = cascadeTimeline(outcome.initialBoard, outcome.finalBoard, outcome.cascadeSteps);
      assert.equal(frames.length, 1);
      assert.deepEqual(frames[0].board, outcome.initialBoard);
      return;
    }
    assert.fail('no losing spin in sample');
  });
});
