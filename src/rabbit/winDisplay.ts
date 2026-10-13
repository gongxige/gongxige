// 阶段 15 / STEP-53：中奖展示用到的纯计算（docs/JADE_RABBIT_MOTION.md 第二节），可单独测试。
import { BOARD_HEIGHTS, PAYLINES, type Paylines } from './engine/index.ts';
import type { ArtLayout } from './artLayout.ts';

export type WinCoordinate = Readonly<{ x: 0 | 1 | 2; y: number }>;
export type ShownLine = Readonly<{ lineNumber: number; coordinates: readonly [WinCoordinate, WinCoordinate, WinCoordinate] }>;

/**
 * 中奖展示的节奏（秒）。计时起点是最后一列「回弹结束、停稳」的时刻，比参考文档里的「最低点」晚约 0.12 秒，
 * 所以文档里的 0.15、0.2、0.45 秒在这里是 0.03、0.08、0.33 秒。CSS 动画的延迟（styles.css 的 STEP-53 段）按这些值写。
 */
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

/** 阶段 15 / STEP-54：大奖画面（docs/JADE_RABBIT_MOTION.md 第三节）。 */
export const BIG_WIN = {
  /** 赢分达到投注的多少倍显示「大奖」「巨奖」。 */
  bigMultiplier: 20,
  megaMultiplier: 50,
  /** 数字滚动和停留的时间（秒）。 */
  countSeconds: 3,
  holdSeconds: 2,
} as const;

export type BigWinTier = 'big' | 'mega';
export const BIG_WIN_LABELS: Record<BigWinTier, string> = { big: '大奖', mega: '巨奖' };

/** 赢分够不够显示大奖画面；不够返回 null。 */
export function bigWinTier(amount: number, bet: number): BigWinTier | null {
  if (!(bet > 0) || !(amount > 0)) return null;
  if (amount >= bet * BIG_WIN.megaMultiplier) return 'mega';
  if (amount >= bet * BIG_WIN.bigMultiplier) return 'big';
  return null;
}

/** 大奖画面上的字样：数字滚动时按当前显示的数字决定，滚过 50 倍时由「大奖」变成「巨奖」。 */
export function bigWinLabel(shown: number, bet: number): string {
  return BIG_WIN_LABELS[bigWinTier(shown, bet) ?? 'big'];
}

/** 数字滚动：开头快、结尾慢（缓出），t 秒时显示的整数值，到时间正好等于总额。 */
export function countUpValue(total: number, t: number, seconds: number = BIG_WIN.countSeconds): number {
  if (t <= 0) return 0;
  if (t >= seconds) return total;
  const x = t / seconds;
  return Math.min(total, Math.floor(total * (1 - (1 - x) ** 3)));
}

/** 触发和进入玉兔模式各段画面的时长（毫秒）。 */
export const MODE_FLOW_MS = {
  /** 触发局在结果到达后多转的时间（两侧金光、标题大字、卷轴变红）。 */
  triggerExtraSpin: 2200,
  /** 触发局如果也有线中奖，先展示中奖线的时间。 */
  triggerWins: 1500,
  /** 「8 次财富旋转」横幅。 */
  intro: 1800,
  /** 金光转场。 */
  flash: 900,
  /** 财富旋转结束后显示「共赢得」和金币雨。 */
  total: 2200,
} as const;
