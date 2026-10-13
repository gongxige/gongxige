// 阶段 15 / STEP-53：中奖展示用到的纯计算（docs/JADE_RABBIT_MOTION.md 第二节），可单独测试。
import { BOARD_HEIGHTS, PAYLINES, type Paylines } from './engine/index.ts';
import type { ArtLayout } from './artLayout.ts';

export type WinCoordinate = Readonly<{ x: 0 | 1 | 2; y: number }>;
export type ShownLine = Readonly<{ lineNumber: number; coordinates: readonly [WinCoordinate, WinCoordinate, WinCoordinate] }>;

/** 中奖展示的节奏（秒，从最后一列停稳算起），CSS 动画的延迟按这些值写。 */
export const WIN_TIMING = {
  /** 线号亮起、其余格子压暗。 */
  dim: 0.03,
  /** 第一列光环出现；之后每列晚 ringStagger 秒。 */
  ring: 0.08,
  ringStagger: 0.07,
  /** 中奖符号放大发光、画出中奖线。 */
  glow: 0.33,
  /** 自动旋转在中奖展示后多久开始下一局（毫秒）。 */
  autoNextMs: 1500,
} as const;

/** 所有中奖线经过的格子（「x-y」），本局所有线同时显示。 */
export function winningCells(lines: readonly ShownLine[]): Set<string> {
  return new Set(lines.flatMap((line) => line.coordinates.map(({ x, y }) => `${x}-${y}`)));
}

/**
 * 两侧立柱上线号的位置（背景图像素坐标）：左边对着线的起点格，右边对着终点格。
 * 同一格开始（或结束）的几条线上下错开，不会叠在一起；错开顺序按线号，和规则页的线号一致。
 */
export function lineBadges(layout: ArtLayout, lines: readonly ShownLine[], paylines: Paylines = PAYLINES) {
  const [left, , right] = layout.reels;
  const spot = (side: 'left' | 'right', lineNumber: number, row: number) => {
    const x = side === 'left' ? 0 : 2;
    const reel = side === 'left' ? left : right;
    const sharing = paylines
      .map((line, index) => ({ lineNumber: index + 1, row: line[x].y }))
      .filter((entry) => entry.row === row)
      .map((entry) => entry.lineNumber);
    const index = Math.max(0, sharing.indexOf(lineNumber));
    const cellHeight = reel.height / BOARD_HEIGHTS[x];
    const offset = (index - (sharing.length - 1) / 2) * cellHeight * 0.28;
    return {
      side,
      lineNumber,
      x: side === 'left' ? reel.x - reel.width * 0.28 : reel.x + reel.width * 1.28,
      y: reel.y + (row + 0.5) * cellHeight + offset,
    };
  };
  return lines.flatMap((line) => [spot('left', line.lineNumber, line.coordinates[0].y), spot('right', line.lineNumber, line.coordinates[2].y)]);
}
