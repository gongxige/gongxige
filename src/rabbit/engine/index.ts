/**
 * 玉兔送财 STEP-37 纯逻辑引擎。
 *
 * 本步只负责主游戏的 3-4-3 盘面、固定中奖线、百搭和线奖。
 * 奖金牌匾、玉兔模式、封顶和回放会在后续步骤加入。
 */

export const BOARD_HEIGHTS = [3, 4, 3] as const;

export type LineSymbolId =
  | 'YUANBAO'
  | 'FU_BAG'
  | 'RED_ENVELOPE'
  | 'COPPER_COIN'
  | 'FIRECRACKER'
  | 'CARROT';
export type SymbolId = LineSymbolId | 'WILD';

export type Token = Readonly<{
  readonly symbolId: SymbolId;
  /** 连续相同的轴带格可共享此 ID；它只影响叠放视觉，不影响结算。 */
  readonly stackGroupId: string;
}>;
export type Strip = readonly Token[];
export type ReelStrips = readonly [Strip, Strip, Strip];
export type Stops = readonly [number, number, number];
export type Coordinate = Readonly<{ x: 0 | 1 | 2; y: number }>;
export type Board = readonly [readonly Token[], readonly Token[], readonly Token[]];

export type PayTable = Readonly<Partial<Record<SymbolId, number>>>;

export const PAYTABLE = {
  WILD: 200,
  YUANBAO: 100,
  FU_BAG: 50,
  RED_ENVELOPE: 10,
  COPPER_COIN: 8,
  FIRECRACKER: 6,
  CARROT: 4,
} as const satisfies PayTable;

/** 按设计文档冻结的 10 条线，坐标顺序均为左、中、右卷轴。 */
export const PAYLINES = [
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
  [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
  [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }],
  [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
  [{ x: 0, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 2 }],
] as const satisfies readonly (readonly [Coordinate, Coordinate, Coordinate])[];

function token(symbolId: SymbolId, stackGroupId: string): Token {
  return { symbolId, stackGroupId };
}

/**
 * 可替换的临时轴带。重复 stackGroupId 的连续格表示一个叠放段。
 * 这些轴带只用于 STEP-37 的可重复引擎和测试，STEP-39 再做数学调校。
 */
export const TEMPORARY_STRIPS: ReelStrips = [
  [
    token('YUANBAO', 'L-Y-0'), token('YUANBAO', 'L-Y-0'), token('YUANBAO', 'L-Y-0'),
    token('WILD', 'L-W-0'), token('WILD', 'L-W-0'),
    token('CARROT', 'L-C-0'), token('FU_BAG', 'L-F-0'), token('COPPER_COIN', 'L-CU-0'),
  ],
  [
    token('FU_BAG', 'M-F-0'), token('FU_BAG', 'M-F-0'),
    token('RED_ENVELOPE', 'M-R-0'), token('RED_ENVELOPE', 'M-R-0'),
    token('WILD', 'M-W-0'), token('WILD', 'M-W-0'), token('FIRECRACKER', 'M-FI-0'),
    token('CARROT', 'M-C-0'), token('YUANBAO', 'M-Y-0'),
  ],
  [
    token('CARROT', 'R-C-0'), token('CARROT', 'R-C-0'), token('CARROT', 'R-C-0'),
    token('YUANBAO', 'R-Y-0'), token('FU_BAG', 'R-F-0'), token('COPPER_COIN', 'R-CU-0'),
    token('RED_ENVELOPE', 'R-R-0'), token('WILD', 'R-W-0'),
  ],
];

export interface LineWin {
  readonly lineNumber: number;
  readonly symbolId: SymbolId;
  readonly coordinates: readonly [Coordinate, Coordinate, Coordinate];
  readonly symbols: readonly [SymbolId, SymbolId, SymbolId];
  readonly multiplier: number;
  readonly payout: number;
}

export interface SpinOutcome {
  readonly stops: Stops;
  readonly board: Board;
  readonly lineWins: readonly LineWin[];
  readonly payout: number;
}

function mod(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function assertBet(bet: number): void {
  if (!Number.isFinite(bet) || bet <= 0) throw new Error('投注必须为正数');
}

function assertBoard(board: readonly (readonly Token[])[]): asserts board is Board {
  if (board.length !== BOARD_HEIGHTS.length) throw new Error('盘面必须有三条卷轴');
  board.forEach((column, x) => {
    if (column.length !== BOARD_HEIGHTS[x]) throw new Error(`第 ${x + 1} 条卷轴高度不正确`);
    column.forEach((entry) => {
      if (!entry.stackGroupId || !Number.isFinite(entry.stackGroupId.length)) throw new Error('轴带格缺少叠放组');
    });
  });
}

function assertPayTable(payTable: PayTable): void {
  Object.entries(payTable).forEach(([symbolId, multiplier]) => {
    if (!Number.isFinite(multiplier) || multiplier < 0) throw new Error(`赔付倍数无效: ${symbolId}`);
  });
}

function isLineSymbol(symbolId: SymbolId): symbolId is LineSymbolId {
  return symbolId !== 'WILD';
}

/** 正数按“舍入到最近整数，.5 向上”处理。 */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function boardFromStops(strips: ReelStrips, stops: Stops): Board {
  if (strips.length !== BOARD_HEIGHTS.length) throw new Error('需要三条轴带');
  if (stops.length !== BOARD_HEIGHTS.length || !stops.every(Number.isInteger)) throw new Error('停点必须是三个整数');
  strips.forEach((strip, x) => {
    if (strip.length === 0) throw new Error(`第 ${x + 1} 条轴带不能为空`);
  });

  const columnAt = (x: 0 | 1 | 2): readonly Token[] => Array.from(
    { length: BOARD_HEIGHTS[x] },
    (_, y) => ({ ...strips[x][mod(stops[x] + y, strips[x].length)] }),
  );
  return [columnAt(0), columnAt(1), columnAt(2)];
}

function lineCandidates(symbols: readonly [SymbolId, SymbolId, SymbolId]): readonly SymbolId[] {
  const normalSymbols = [...new Set(symbols.filter(isLineSymbol))];
  if (normalSymbols.length > 0) {
    return normalSymbols.filter((candidate) => symbols.every((symbol) => symbol === candidate || symbol === 'WILD'));
  }
  return symbols.every((symbol) => symbol === 'WILD') ? ['WILD'] : [];
}

/** 计算固定 10 条线；每条线只保留最高的一个可支付候选。 */
export function evaluateLines(board: Board, bet: number, payTable: PayTable = PAYTABLE): readonly LineWin[] {
  assertBet(bet);
  assertBoard(board);
  assertPayTable(payTable);

  return PAYLINES.flatMap((coordinates, index) => {
    const symbols = coordinates.map(({ x, y }) => board[x][y].symbolId) as [SymbolId, SymbolId, SymbolId];
    const best = lineCandidates(symbols)
      .map((symbolId) => ({ symbolId, multiplier: payTable[symbolId] ?? 0 }))
      .filter((candidate) => candidate.multiplier > 0)
      .sort((a, b) => b.multiplier - a.multiplier)[0];
    if (!best) return [];

    return [{
      lineNumber: index + 1,
      symbolId: best.symbolId,
      coordinates,
      symbols,
      multiplier: best.multiplier,
      payout: roundHalfUp(best.multiplier * bet / 10),
    }];
  });
}

export function settleSpin(stops: Stops, bet: number, strips: ReelStrips = TEMPORARY_STRIPS, payTable: PayTable = PAYTABLE): SpinOutcome {
  const board = boardFromStops(strips, stops);
  const lineWins = evaluateLines(board, bet, payTable);
  return {
    stops: [...stops] as Stops,
    board,
    lineWins,
    payout: lineWins.reduce((total, win) => total + win.payout, 0),
  };
}
