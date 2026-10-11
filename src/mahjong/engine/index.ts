/**
 * 麻将连连胡的基础结算引擎（STEP-24）。
 *
 * 此模块只处理普通牌的 2,000 ways 与连锁；金色牌、百搭、胡牌、免费旋转
 * 和封顶会在后续步骤加入。这里没有 React、DOM 或 Node API 依赖。
 */
export const BOARD_HEIGHTS = [4, 5, 5, 5, 4] as const;
export const CASCADE_MULTIPLIERS = [1, 2, 3, 5] as const;

export type SymbolId = 'FA' | 'ZHONG' | 'BAI' | 'WAN8' | 'DOT1' | 'DOT2' | 'DOT3' | 'BAM1' | 'BAM2';
export type Token = Readonly<{ symbolId: SymbolId }>;
export type Board = readonly (readonly Token[])[];
export type Stops = readonly [number, number, number, number, number];
export type Coordinate = Readonly<{ x: number; y: number }>;
export type PayTable = Readonly<Partial<Record<SymbolId, Readonly<Partial<Record<3 | 4 | 5, number>>>>>>;

export interface WaysWin {
  readonly symbolId: SymbolId;
  readonly run: 3 | 4 | 5;
  readonly ways: number;
  readonly basePayout: number;
  readonly cascadeMultiplier: number;
  readonly payout: number;
  readonly cells: readonly Coordinate[];
}

export interface CascadeStep {
  readonly beforeBoard: Board;
  readonly afterBoard: Board;
  readonly wins: readonly WaysWin[];
  readonly cascadeMultiplier: number;
  readonly payout: number;
  readonly removed: readonly Coordinate[];
  readonly refills: readonly (readonly Token[])[];
}

export interface SpinOutcome {
  readonly stops: Stops;
  readonly initialBoard: Board;
  readonly cascadeSteps: readonly CascadeStep[];
  readonly finalBoard: Board;
  readonly payout: number;
}

/** 临时轴带；STEP-26 会以经调校且版本化的正式轴带替换。 */
export const TEMPORARY_STRIPS: readonly (readonly Token[])[] = [
  [{ symbolId: 'FA' }, { symbolId: 'ZHONG' }, { symbolId: 'BAI' }, { symbolId: 'WAN8' }, { symbolId: 'DOT1' }, { symbolId: 'DOT2' }, { symbolId: 'DOT3' }, { symbolId: 'BAM1' }, { symbolId: 'BAM2' }],
  [{ symbolId: 'ZHONG' }, { symbolId: 'FA' }, { symbolId: 'WAN8' }, { symbolId: 'BAI' }, { symbolId: 'DOT2' }, { symbolId: 'DOT1' }, { symbolId: 'BAM1' }, { symbolId: 'DOT3' }, { symbolId: 'BAM2' }],
  [{ symbolId: 'BAI' }, { symbolId: 'WAN8' }, { symbolId: 'FA' }, { symbolId: 'ZHONG' }, { symbolId: 'DOT3' }, { symbolId: 'BAM2' }, { symbolId: 'DOT1' }, { symbolId: 'DOT2' }, { symbolId: 'BAM1' }],
  [{ symbolId: 'WAN8' }, { symbolId: 'BAI' }, { symbolId: 'ZHONG' }, { symbolId: 'FA' }, { symbolId: 'BAM1' }, { symbolId: 'BAM2' }, { symbolId: 'DOT2' }, { symbolId: 'DOT1' }, { symbolId: 'DOT3' }],
  [{ symbolId: 'DOT1' }, { symbolId: 'DOT2' }, { symbolId: 'DOT3' }, { symbolId: 'BAM1' }, { symbolId: 'BAM2' }, { symbolId: 'FA' }, { symbolId: 'ZHONG' }, { symbolId: 'BAI' }, { symbolId: 'WAN8' }],
] as const;

/** 临时支付表；数值不是 STEP-26 的 RTP 调校结果。 */
export const TEMPORARY_PAY_TABLE: PayTable = {
  FA: { 3: 1, 4: 2, 5: 4 }, ZHONG: { 3: 1, 4: 2, 5: 4 }, BAI: { 3: 1, 4: 2, 5: 4 }, WAN8: { 3: 1, 4: 2, 5: 4 },
  DOT1: { 3: 1, 4: 2, 5: 3 }, DOT2: { 3: 1, 4: 2, 5: 3 }, DOT3: { 3: 1, 4: 2, 5: 3 }, BAM1: { 3: 1, 4: 2, 5: 3 }, BAM2: { 3: 1, 4: 2, 5: 3 },
};

function mod(value: number, length: number): number { return ((value % length) + length) % length; }
function cloneBoard(board: Board): Board { return board.map((column) => column.map((token) => ({ ...token }))); }
function validStops(stops: readonly number[]): stops is Stops { return stops.length === 5 && stops.every((stop) => Number.isInteger(stop)); }

export function boardFromStops(strips: readonly (readonly Token[])[], stops: Stops): Board {
  if (strips.length !== BOARD_HEIGHTS.length || !validStops(stops)) throw new Error('需要五个整数停点和五条轴带');
  return BOARD_HEIGHTS.map((height, x) => {
    const strip = strips[x];
    if (!strip || strip.length === 0) throw new Error(`轴带 ${x} 不能为空`);
    return Array.from({ length: height }, (_, y) => ({ ...strip[mod(stops[x] + y, strip.length)] }));
  });
}

export function multiplierForCascade(cascadeIndex: number): number {
  if (!Number.isInteger(cascadeIndex) || cascadeIndex < 1) throw new Error('连锁序号必须从 1 开始');
  return CASCADE_MULTIPLIERS[Math.min(cascadeIndex, CASCADE_MULTIPLIERS.length) - 1];
}

export function evaluateWays(board: Board, bet: number, payTable: PayTable, cascadeIndex = 1): readonly WaysWin[] {
  if (!Number.isFinite(bet) || bet <= 0) throw new Error('投注必须为正数');
  const cascadeMultiplier = multiplierForCascade(cascadeIndex);
  const wins: WaysWin[] = [];
  for (const symbolId of Object.keys(payTable) as SymbolId[]) {
    const counts = board.map((column) => column.filter((token) => token.symbolId === symbolId).length);
    let run = 0;
    while (run < counts.length && counts[run] > 0) run += 1;
    if (run < 3) continue;
    const payoutMultiplier = payTable[symbolId]?.[run as 3 | 4 | 5];
    if (payoutMultiplier === undefined || payoutMultiplier <= 0) continue;
    const ways = counts.slice(0, run).reduce((total, count) => total * count, 1);
    const basePayout = bet * payoutMultiplier * ways;
    if (!Number.isInteger(basePayout)) throw new Error('临时支付表必须产生整数虚拟积分');
    const cells = board.flatMap((column, x) => column.flatMap((token, y) => x < run && token.symbolId === symbolId ? [{ x, y }] : []));
    wins.push({ symbolId, run: run as 3 | 4 | 5, ways, basePayout, cascadeMultiplier, payout: basePayout * cascadeMultiplier, cells });
  }
  return wins;
}

export function settleSpin(stops: Stops, bet: number, strips = TEMPORARY_STRIPS, payTable = TEMPORARY_PAY_TABLE): SpinOutcome {
  const initialBoard = boardFromStops(strips, stops);
  let board = cloneBoard(initialBoard);
  const refillsUsed = [0, 0, 0, 0, 0];
  const cascadeSteps: CascadeStep[] = [];
  let payout = 0;
  for (let cascadeIndex = 1; ; cascadeIndex += 1) {
    const beforeBoard = cloneBoard(board);
    const wins = evaluateWays(beforeBoard, bet, payTable, cascadeIndex);
    if (wins.length === 0) break;
    const removed = [...new Map(wins.flatMap((win) => win.cells).map((cell) => [`${cell.x}:${cell.y}`, cell])).values()];
    const removedKeys = new Set(removed.map((cell) => `${cell.x}:${cell.y}`));
    const refills: Token[][] = [];
    board = board.map((column, x) => {
      const survivors = column.filter((_, y) => !removedKeys.has(`${x}:${y}`));
      const emptyCount = BOARD_HEIGHTS[x] - survivors.length;
      const strip = strips[x];
      const filled = Array.from({ length: emptyCount }, (_, y) => ({ ...strip[mod(stops[x] - refillsUsed[x] - emptyCount + y, strip.length)] }));
      refillsUsed[x] += emptyCount;
      refills.push(filled);
      return [...filled, ...survivors];
    });
    const stepPayout = wins.reduce((total, win) => total + win.payout, 0);
    payout += stepPayout;
    cascadeSteps.push({ beforeBoard, afterBoard: cloneBoard(board), wins, cascadeMultiplier: multiplierForCascade(cascadeIndex), payout: stepPayout, removed, refills });
  }
  return { stops, initialBoard, cascadeSteps, finalBoard: cloneBoard(board), payout };
}
