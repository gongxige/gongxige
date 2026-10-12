import { MATH_STRIPS, boardFromStops, evaluateLines, type Board, type SymbolId, type Token } from './engine/index.ts';

/**
 * 打开游戏还没转之前显示的主游戏盘面：从正式轴带随机取停点，只要全是普通符号（没有奖金牌匾和空白格）、
 * 也不构成中奖线的一组，避免看起来"中了奖却没赢分"。只用于展示，不参与结算。
 */
export function openingBoard(random: () => number = Math.random): Board {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const stops = MATH_STRIPS.map((strip) => Math.floor(random() * strip.length)) as unknown as [number, number, number];
    const candidate = boardFromStops(MATH_STRIPS, stops);
    const ordinary = candidate.every((column) => column.every((entry) => entry.symbolId !== 'BONUS_PLATE' && entry.symbolId !== 'BLANK'));
    if (ordinary && evaluateLines(candidate, 100).length === 0) return candidate;
  }
  const fallback = (ids: readonly SymbolId[], prefix: string): Token[] => ids.map((symbolId, y) => ({ symbolId, stackGroupId: `opening-${prefix}-${y}` }));
  return [
    fallback(['YUANBAO', 'CARROT', 'COPPER_COIN'], 'l'),
    fallback(['FIRECRACKER', 'RED_ENVELOPE', 'YUANBAO', 'FU_BAG'], 'm'),
    fallback(['FU_BAG', 'COPPER_COIN', 'CARROT'], 'r'),
  ];
}
