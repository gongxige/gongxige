import assert from 'node:assert/strict';
import test from 'node:test';
import { PAYLINES } from './engine/index.ts';
import type { ArtLayout } from './artLayout.ts';
import { bigWinLabel, bigWinTier, countUpValue, lineBadges, winningCells, type ShownLine } from './winDisplay.ts';

const layout: ArtLayout = {
  imageSize: { width: 931, height: 1230 },
  reels: [{ x: 135, y: 470, width: 210, height: 578 }, { x: 354, y: 380, width: 234, height: 760 }, { x: 597, y: 470, width: 210, height: 578 }],
  topBanner: { x: 292, y: 292, width: 356, height: 70 },
  bottomBar: { x: 175, y: 1150, width: 582, height: 68 },
  mascotArea: { x: 330, y: 0, width: 270, height: 230 },
};
const lineOf = (lineNumber: number): ShownLine => ({ lineNumber, coordinates: PAYLINES[lineNumber - 1] });

test('STEP-53 所有中奖线的格子一起标出', () => {
  const cells = winningCells([lineOf(2), lineOf(4)]);
  assert.deepEqual([...cells].sort(), ['0-0', '0-1', '1-1', '2-0'].sort());
});

test('STEP-53 线号在两侧立柱上，对着起点格和终点格，同一格的几条线不重叠', () => {
  const all = lineBadges(layout, PAYLINES.map((_, index) => lineOf(index + 1)));
  assert.equal(all.length, 20);
  for (const side of ['left', 'right'] as const) {
    const badges = all.filter((badge) => badge.side === side);
    // 左边在第 1 列左侧，右边在第 3 列右侧
    for (const badge of badges) assert.ok(side === 'left' ? badge.x < layout.reels[0].x : badge.x > layout.reels[2].x + layout.reels[2].width);
    // 每个线号都在它对应那一格的高度范围内，且两两至少隔开 0.2 格
    const cell = layout.reels[0].height / 3;
    for (const badge of badges) {
      const row = PAYLINES[badge.lineNumber - 1][side === 'left' ? 0 : 2].y;
      assert.ok(badge.y > layout.reels[0].y + row * cell && badge.y < layout.reels[0].y + (row + 1) * cell, `线 ${badge.lineNumber}`);
    }
    const ys = badges.map((badge) => badge.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] - ys[i - 1] >= cell * 0.2);
  }
});

test('STEP-54 大奖门槛：19 倍不显示，20 倍「大奖」，50 倍「巨奖」', () => {
  assert.equal(bigWinTier(1_900, 100), null);
  assert.equal(bigWinTier(1_999, 100), null);
  assert.equal(bigWinTier(2_000, 100), 'big');
  assert.equal(bigWinTier(4_999, 100), 'big');
  assert.equal(bigWinTier(5_000, 100), 'mega');
  assert.equal(bigWinTier(0, 100), null);
  assert.equal(bigWinLabel(2_000, 100), '大奖');
  assert.equal(bigWinLabel(5_000, 100), '巨奖');
  // 滚动开头（数字还小）也显示「大奖」
  assert.equal(bigWinLabel(10, 100), '大奖');
});

test('STEP-54 数字滚动从 0 单调增加，到时间正好等于总额', () => {
  let last = -1;
  for (let t = 0; t <= 3.2; t += 0.05) {
    const value = countUpValue(7_700, t);
    assert.ok(value >= last && value <= 7_700);
    last = value;
  }
  assert.equal(countUpValue(7_700, 3), 7_700);
  assert.equal(countUpValue(7_700, 0), 0);
});
