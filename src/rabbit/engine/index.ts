/** 玉兔送财纯逻辑引擎：主旋转、奖金牌匾、玉兔模式、封顶和回放。 */

export const BOARD_HEIGHTS = [3, 4, 3] as const;
export const MODE_SPINS = 8;
export const MAX_WIN_MULTIPLIER = 5_000;
export const MODE_TRIGGER_PROBABILITY = 0.00745;
export const ENGINE_VERSION = 'jade-rabbit-engine-1.0.0';
/** STEP-47：中奖线改为只连相邻格的 10 条，数学版本升到 1.2.0；1.1.0 的旧线只用于回放旧局。 */
export const MATH_CONFIG_VERSION = 'jade-rabbit-math-1.2.0';
export const MATH_CONFIG_VERSION_V1 = 'jade-rabbit-math-1.1.0';
export const STRIP_REVISION = 'jade-rabbit-strip-1.1.0';

export type LineSymbolId =
  | 'YUANBAO'
  | 'FU_BAG'
  | 'RED_ENVELOPE'
  | 'COPPER_COIN'
  | 'FIRECRACKER'
  | 'CARROT';
export type BonusTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SymbolId = LineSymbolId | 'WILD' | 'BONUS_PLATE' | 'BLANK';

export type Token = Readonly<{
  readonly symbolId: SymbolId;
  /** 连续相同的轴带格可共享此 ID；它只影响叠放视觉，不影响结算。 */
  readonly stackGroupId: string;
  /** 奖金牌匾的档位；只有 BONUS_PLATE 必须填写。 */
  readonly bonusTier?: BonusTier;
}>;
export type Strip = readonly Token[];
export type ReelStrips = readonly [Strip, Strip, Strip];
export type Stops = readonly [number, number, number];
export type Coordinate = Readonly<{ x: 0 | 1 | 2; y: number }>;
export type Board = readonly [readonly Token[], readonly Token[], readonly Token[]];

export type PayTable = Readonly<Partial<Record<SymbolId, number>>>;

export const BONUS_MULTIPLIERS = [0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500] as const;

export const PAYTABLE = {
  WILD: 200,
  YUANBAO: 100,
  FU_BAG: 50,
  RED_ENVELOPE: 10,
  COPPER_COIN: 8,
  FIRECRACKER: 6,
  CARROT: 4,
} as const satisfies PayTable;

/** 1.1.0 的旧线（其中第 4、5、7 条会跳过中列相邻格），只用于回放 1.1.0 的旧局。 */
export const PAYLINES_V1 = [
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

/**
 * 1.2.0 起的 10 条线（左、中、右）。中列比两侧高半格：两侧第 r 格夹在中列第 r、r+1 格之间，
 * 每条线只走到相邻格，和参考游戏的中奖线图一致。
 */
export const PAYLINES = [
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
  [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
  [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }],
  [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
  [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
  [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 1 }],
  [{ x: 0, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 2 }],
] as const satisfies readonly (readonly [Coordinate, Coordinate, Coordinate])[];

export type Paylines = readonly (readonly [Coordinate, Coordinate, Coordinate])[];

/** 按记录里的数学版本取中奖线；未知版本直接报错，不猜。 */
export function paylinesForVersion(mathConfigVersion: string): Paylines {
  if (mathConfigVersion === MATH_CONFIG_VERSION) return PAYLINES;
  if (mathConfigVersion === MATH_CONFIG_VERSION_V1) return PAYLINES_V1;
  throw new Error(`数学版本不可用：${mathConfigVersion}`);
}

function token(symbolId: SymbolId, stackGroupId: string, bonusTier?: BonusTier): Token {
  return bonusTier === undefined ? { symbolId, stackGroupId } : { symbolId, stackGroupId, bonusTier };
}

/** STEP-39 数学调校后的奖金档位分布。每条模式轴带每两格出现一枚牌匾。 */
const MODE_TIER_SEQUENCE: readonly BonusTier[] = [
  ...Array<BonusTier>(10).fill(0),
  ...Array<BonusTier>(20).fill(1),
  ...Array<BonusTier>(12).fill(2),
  ...Array<BonusTier>(6).fill(3),
  ...Array<BonusTier>(2).fill(4),
];

/** 主游戏只放 12 枚牌匾，档位在轴带上冻结，不在结算时临时抽样。 */
const MAIN_BONUS_TIERS: readonly BonusTier[] = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2];

function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function mathMainStrip(prefix: string, seed: number): Strip {
  const entries: Token[] = [];
  const add = (symbolId: LineSymbolId | 'WILD', count: number): void => {
    for (let index = 0; index < count; index += 1) entries.push(token(symbolId, `${prefix}-${symbolId}-${index}`));
  };

  add('YUANBAO', 3);
  add('FU_BAG', 6);
  add('RED_ENVELOPE', 10);
  add('COPPER_COIN', 25);
  add('FIRECRACKER', 25);
  add('CARROT', 15);
  add('WILD', 4);
  MAIN_BONUS_TIERS.forEach((tier, index) => entries.push(token('BONUS_PLATE', `${prefix}-BONUS-${index}`, tier)));

  const shuffled = deterministicShuffle(entries, seed);
  return shuffled.map((entry, index) => {
    const previous = shuffled[index - 1];
    const sameRun = previous && previous.symbolId === entry.symbolId;
    return sameRun ? { ...entry, stackGroupId: previous.stackGroupId } : entry;
  });
}

function mathModeStrip(prefix: string, phase: number): Strip {
  return Array.from({ length: 100 }, (_, index) => {
    if ((index + phase) % 2 === 1) return token('BLANK', `${prefix}-blank-${index}`);
    const tier = MODE_TIER_SEQUENCE[((index + phase) >> 1) % MODE_TIER_SEQUENCE.length];
    return token('BONUS_PLATE', `${prefix}-bonus-${index}`, tier);
  });
}

/** STEP-39 正式数学轴带：每条主轴 100 格，12 格奖金牌匾；其余 88 格为线奖符号。 */
export const MATH_STRIPS: ReelStrips = [
  mathMainStrip('L', 0x39102026),
  mathMainStrip('M', 0x39102027),
  mathMainStrip('R', 0x39102028),
];

/** 玉兔模式轴带固定为 100 格、50 格牌匾和 50 格空白，窗口平均包含 5 枚牌匾。 */
export const MATH_MODE_STRIPS: ReelStrips = [
  mathModeStrip('ML', 0),
  mathModeStrip('MM', 1),
  mathModeStrip('MR', 0),
];

/** 保留旧导出名，服务器尚未接入玉兔时也能继续使用同一默认配置。 */
export const TEMPORARY_STRIPS = MATH_STRIPS;
export const TEMPORARY_MODE_STRIPS = MATH_MODE_STRIPS;

export interface LineWin {
  readonly lineNumber: number;
  readonly symbolId: SymbolId;
  readonly coordinates: readonly [Coordinate, Coordinate, Coordinate];
  readonly symbols: readonly [SymbolId, SymbolId, SymbolId];
  readonly multiplier: number;
  readonly payout: number;
}

export interface BonusWin {
  readonly coordinates: Readonly<{ x: 0 | 1 | 2; y: number }>;
  readonly tier: BonusTier;
  readonly multiplier: number;
  readonly value: number;
}

export interface SpinOutcome {
  readonly stops: Stops;
  readonly board: Board;
  readonly lineWins: readonly LineWin[];
  readonly bonusWins: readonly BonusWin[];
  /** 未封顶前的本次主旋转候选派彩。 */
  readonly bonusPayout: number;
  readonly payout: number;
}

export interface ReplayInput {
  readonly gameId: 'jade-rabbit';
  readonly engineVersion: string;
  readonly mathConfigVersion: string;
  readonly stripRevision: string;
  readonly bet: number;
  readonly parentRoundId: string;
  readonly mode: 'paid';
  readonly triggerRoll: number;
  readonly paidStops: Stops;
  readonly modeStops: readonly Stops[];
  readonly capRemainingBefore: number;
}

export type RoundReplayInput = ReplayInput;

export interface RoundSpinOutcome extends SpinOutcome {
  readonly candidatePayout: number;
  readonly capped: boolean;
  readonly capRemainingBefore: number;
  readonly capRemainingAfter: number;
}

export interface ModeSpinOutcome {
  readonly stops: Stops;
  readonly board: Board;
  readonly bonusWins: readonly BonusWin[];
  readonly candidatePayout: number;
  readonly payout: number;
  readonly capped: boolean;
  readonly capRemainingBefore: number;
  readonly capRemainingAfter: number;
}

export interface RoundOutcome {
  readonly replayInput: ReplayInput;
  readonly paidSpin: RoundSpinOutcome;
  readonly modeSpins: readonly ModeSpinOutcome[];
  readonly triggered: boolean;
  readonly totalWin: number;
  readonly cap: number;
  readonly capped: boolean;
  readonly remainingModeSpins: number;
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
      if (entry.symbolId === 'BONUS_PLATE' && !isBonusTier(entry.bonusTier)) throw new Error('奖金牌匾缺少有效档位');
      if (entry.symbolId !== 'BONUS_PLATE' && entry.bonusTier !== undefined) throw new Error('只有奖金牌匾可以带数值档位');
    });
  });
}

function assertPayTable(payTable: PayTable): void {
  Object.entries(payTable).forEach(([symbolId, multiplier]) => {
    if (!Number.isFinite(multiplier) || multiplier < 0) throw new Error(`赔付倍数无效: ${symbolId}`);
  });
}

function isLineSymbol(symbolId: SymbolId): symbolId is LineSymbolId {
  return symbolId === 'YUANBAO' || symbolId === 'FU_BAG' || symbolId === 'RED_ENVELOPE'
    || symbolId === 'COPPER_COIN' || symbolId === 'FIRECRACKER' || symbolId === 'CARROT';
}

function isBonusTier(value: number | undefined): value is BonusTier {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value < BONUS_MULTIPLIERS.length;
}

function assertStops(stops: readonly number[]): asserts stops is Stops {
  if (stops.length !== 3 || !stops.every(Number.isInteger)) throw new Error('停点必须是三个整数');
}

function assertStrips(strips: ReelStrips): void {
  if (strips.length !== BOARD_HEIGHTS.length) throw new Error('需要三条轴带');
  strips.forEach((strip, x) => {
    if (strip.length === 0) throw new Error(`第 ${x + 1} 条轴带不能为空`);
    strip.forEach((entry) => {
      if (entry.symbolId === 'BLANK') throw new Error('主游戏轴带不能含有空白格');
      if (entry.symbolId === 'BONUS_PLATE' && !isBonusTier(entry.bonusTier)) throw new Error('奖金牌匾缺少有效档位');
      if (entry.symbolId !== 'BONUS_PLATE' && entry.bonusTier !== undefined) throw new Error('只有奖金牌匾可以带数值档位');
    });
  });
}

function assertModeStrips(strips: ReelStrips): void {
  if (strips.length !== BOARD_HEIGHTS.length) throw new Error('需要三条玉兔模式轴带');
  strips.forEach((strip, x) => {
    if (strip.length === 0) throw new Error(`玉兔模式第 ${x + 1} 条轴带不能为空`);
    strip.forEach((entry) => {
      if (entry.symbolId !== 'BONUS_PLATE' && entry.symbolId !== 'BLANK') throw new Error('玉兔模式轴带只能含奖金牌匾和空白格');
      if (entry.symbolId === 'BONUS_PLATE' && !isBonusTier(entry.bonusTier)) throw new Error('模式奖金牌匾缺少有效档位');
      if (entry.symbolId === 'BLANK' && entry.bonusTier !== undefined) throw new Error('空白格不能带数值档位');
    });
  });
}

/** 正数按“舍入到最近整数，.5 向上”处理。 */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function boardFromStops(strips: ReelStrips, stops: Stops): Board {
  if (strips.length !== BOARD_HEIGHTS.length) throw new Error('需要三条轴带');
  assertStops(stops);
  strips.forEach((strip, x) => {
    if (strip.length === 0) throw new Error(`第 ${x + 1} 条轴带不能为空`);
  });

  const columnAt = (x: 0 | 1 | 2): readonly Token[] => Array.from(
    { length: BOARD_HEIGHTS[x] },
    (_, y) => ({ ...strips[x][mod(stops[x] + y, strips[x].length)] }),
  );
  return [columnAt(0), columnAt(1), columnAt(2)];
}

function bonusValue(tier: BonusTier, bet: number): number {
  return roundHalfUp(BONUS_MULTIPLIERS[tier] * bet);
}

/** 按固定盘面顺序读取所有奖金牌匾；百搭不会被计入。 */
export function evaluateBonusPlates(board: Board, bet: number): readonly BonusWin[] {
  assertBet(bet);
  assertBoard(board);
  return board.flatMap((column, x) => column.flatMap((entry, y) => {
    const tier = entry.bonusTier;
    if (entry.symbolId !== 'BONUS_PLATE' || !isBonusTier(tier)) return [];
    return [{
      coordinates: { x: x as 0 | 1 | 2, y },
      tier,
      multiplier: BONUS_MULTIPLIERS[tier],
      value: bonusValue(tier, bet),
    }];
  }));
}

export const evaluateBonuses = evaluateBonusPlates;

function bonusPayout(bonusWins: readonly BonusWin[]): number {
  return bonusWins.length >= 5 ? bonusWins.reduce((total, win) => total + win.value, 0) : 0;
}

function lineCandidates(symbols: readonly [SymbolId, SymbolId, SymbolId]): readonly SymbolId[] {
  const normalSymbols = [...new Set(symbols.filter(isLineSymbol))];
  if (normalSymbols.length > 0) {
    return normalSymbols.filter((candidate) => symbols.every((symbol) => symbol === candidate || symbol === 'WILD'));
  }
  return symbols.every((symbol) => symbol === 'WILD') ? ['WILD'] : [];
}

/** 计算固定 10 条线；每条线只保留最高的一个可支付候选。 */
export function evaluateLines(board: Board, bet: number, payTable: PayTable = PAYTABLE, paylines: Paylines = PAYLINES): readonly LineWin[] {
  assertBet(bet);
  assertBoard(board);
  assertPayTable(payTable);

  return paylines.flatMap((coordinates, index) => {
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

export function settleSpin(stops: Stops, bet: number, strips: ReelStrips = TEMPORARY_STRIPS, payTable: PayTable = PAYTABLE, paylines: Paylines = PAYLINES): SpinOutcome {
  assertBet(bet);
  assertStrips(strips);
  const board = boardFromStops(strips, stops);
  const lineWins = evaluateLines(board, bet, payTable, paylines);
  const bonusWins = evaluateBonusPlates(board, bet);
  const bonusPayoutValue = bonusPayout(bonusWins);
  return {
    stops: [...stops] as Stops,
    board,
    lineWins,
    bonusWins,
    bonusPayout: bonusPayoutValue,
    payout: lineWins.reduce((total, win) => total + win.payout, 0) + bonusPayoutValue,
  };
}

function cloneReplayInput(input: ReplayInput): ReplayInput {
  return {
    ...input,
    paidStops: [...input.paidStops] as Stops,
    modeStops: input.modeStops.map((stops) => [...stops] as Stops),
  };
}

function validateReplayInput(input: ReplayInput): void {
  if (input.gameId !== 'jade-rabbit') throw new Error('回放游戏类型不正确');
  if (input.mode !== 'paid') throw new Error('玉兔送财回放必须从付费旋转开始');
  if (!input.parentRoundId) throw new Error('回放缺少父局号');
  if (input.engineVersion !== ENGINE_VERSION) throw new Error(`引擎版本不可用：${input.engineVersion}`);
  paylinesForVersion(input.mathConfigVersion);
  if (input.stripRevision !== STRIP_REVISION) throw new Error(`轴带版本不可用：${input.stripRevision}`);
  assertBet(input.bet);
  assertStops(input.paidStops);
  if (!Number.isFinite(input.triggerRoll) || input.triggerRoll < 0 || input.triggerRoll >= 1) throw new Error('触发抽样必须在 [0, 1) 内');
  if (!Number.isInteger(input.capRemainingBefore) || input.capRemainingBefore < 0) throw new Error('封顶余额必须为非负整数');
  if (input.modeStops.length > MODE_SPINS) throw new Error('玉兔模式最多保存八组停点');
  input.modeStops.forEach(assertStops);
}

function capSpin(spin: SpinOutcome, capRemainingBefore: number): RoundSpinOutcome {
  let capRemaining = capRemainingBefore;
  const cappedLineWins = spin.lineWins.map((win) => {
    const payout = Math.min(win.payout, capRemaining);
    capRemaining -= payout;
    return { ...win, payout };
  });
  const paidBonus = Math.min(spin.bonusPayout, capRemaining);
  capRemaining -= paidBonus;
  const candidatePayout = spin.payout;
  const capped = candidatePayout >= capRemainingBefore;
  return {
    ...spin,
    lineWins: cappedLineWins,
    bonusPayout: paidBonus,
    candidatePayout,
    payout: capRemainingBefore - capRemaining,
    capped,
    capRemainingBefore,
    capRemainingAfter: capRemaining,
  };
}

function settleModeSpin(stops: Stops, bet: number, strips: ReelStrips, capRemainingBefore: number): ModeSpinOutcome {
  const board = boardFromStops(strips, stops);
  const bonusWins = evaluateBonusPlates(board, bet);
  const candidatePayout = bonusPayout(bonusWins);
  const payout = Math.min(candidatePayout, capRemainingBefore);
  return {
    stops: [...stops] as Stops,
    board,
    bonusWins,
    candidatePayout,
    payout,
    capped: candidatePayout >= capRemainingBefore,
    capRemainingBefore,
    capRemainingAfter: capRemainingBefore - payout,
  };
}

/** 仅按记录中的固定触发抽样判断是否进入玉兔模式。 */
export function isModeTriggered(triggerRoll: number): boolean {
  if (!Number.isFinite(triggerRoll) || triggerRoll < 0 || triggerRoll >= 1) throw new Error('触发抽样必须在 [0, 1) 内');
  return triggerRoll < MODE_TRIGGER_PROBABILITY;
}

/** 结算一次付费旋转及其可能触发的完整玉兔模式。 */
export function settleRound(input: ReplayInput, strips: ReelStrips = TEMPORARY_STRIPS, modeStrips: ReelStrips = TEMPORARY_MODE_STRIPS, payTable: PayTable = PAYTABLE): RoundOutcome {
  validateReplayInput(input);
  assertStrips(strips);
  assertModeStrips(modeStrips);

  const cap = MAX_WIN_MULTIPLIER * input.bet;
  if (input.capRemainingBefore > cap) throw new Error('封顶余额不能超过本轮封顶值');

  const paidSpin = capSpin(settleSpin(input.paidStops, input.bet, strips, payTable, paylinesForVersion(input.mathConfigVersion)), input.capRemainingBefore);
  const triggered = isModeTriggered(input.triggerRoll);
  const modeCanStart = triggered && !paidSpin.capped;
  if (modeCanStart && input.modeStops.length !== MODE_SPINS) throw new Error('已触发玉兔模式时必须记录八组停点');
  if (!modeCanStart && input.modeStops.length !== 0) throw new Error('未开始玉兔模式时不能带模式停点');

  const modeSpins: ModeSpinOutcome[] = [];
  let capRemaining = paidSpin.capRemainingAfter;
  if (modeCanStart) {
    for (const stops of input.modeStops) {
      const modeSpin = settleModeSpin(stops, input.bet, modeStrips, capRemaining);
      modeSpins.push(modeSpin);
      capRemaining = modeSpin.capRemainingAfter;
      if (modeSpin.capped) break;
    }
  }

  const totalWin = input.capRemainingBefore - capRemaining;
  return {
    replayInput: cloneReplayInput(input),
    paidSpin,
    modeSpins,
    triggered,
    totalWin,
    cap,
    capped: capRemaining === 0,
    remainingModeSpins: modeCanStart ? MODE_SPINS - modeSpins.length : 0,
  };
}

/** 回放不再抽随机数，只使用记录的版本、停点和触发抽样。 */
export function replayRound(input: ReplayInput, strips: ReelStrips = TEMPORARY_STRIPS, modeStrips: ReelStrips = TEMPORARY_MODE_STRIPS, payTable: PayTable = PAYTABLE): RoundOutcome {
  return settleRound(input, strips, modeStrips, payTable);
}

/** 与麻将引擎相同的命名习惯：一条回放记录代表完整的一轮。 */
export const replaySpin = replayRound;
