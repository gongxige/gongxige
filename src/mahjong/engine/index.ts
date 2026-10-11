/** 麻将连连胡纯逻辑引擎；临时轴带和赔付表将在 STEP-26 调校。 */
export const BOARD_HEIGHTS = [4, 5, 5, 5, 4] as const;
export const CASCADE_MULTIPLIERS = [1, 2, 3, 5] as const;
export const FREE_CASCADE_MULTIPLIERS = [2, 4, 6, 10] as const;
export const MAX_WIN_MULTIPLIER = 1708;

export type PaidSymbolId = 'FA' | 'ZHONG' | 'BAI' | 'WAN8' | 'DOT1' | 'DOT2' | 'DOT3' | 'BAM1' | 'BAM2';
export type SymbolId = PaidSymbolId | 'WILD' | 'HU';
export type Token = Readonly<{ symbolId: SymbolId; golden?: boolean }>;
export type Board = readonly (readonly Token[])[];
export type Stops = readonly [number, number, number, number, number];
export type Coordinate = Readonly<{ x: number; y: number }>;
export interface Rational { readonly numerator: number; readonly denominator: number; }
export type PayoutMultiplier = number | Rational;
export type PayTable = Readonly<Partial<Record<PaidSymbolId, Readonly<Partial<Record<3 | 4 | 5, PayoutMultiplier>>>>>>;
export interface MahjongMathConfig {
  readonly version: string;
  readonly stripRevision: string;
  readonly strips: readonly (readonly Token[])[];
  readonly payTable: PayTable;
}
export type SpinMode = 'paid' | 'free';
export interface WaysWin { readonly symbolId: PaidSymbolId; readonly run: 3 | 4 | 5; readonly ways: number; readonly basePayout: number; readonly cascadeMultiplier: number; readonly payout: number; readonly cells: readonly Coordinate[]; }
export interface CascadeStep { readonly beforeBoard: Board; readonly afterBoard: Board; readonly wins: readonly WaysWin[]; readonly cascadeMultiplier: number; readonly candidatePayout: number; readonly payout: number; readonly capped: boolean; readonly goldenTransforms: readonly Coordinate[]; readonly removed: readonly Coordinate[]; readonly refills: readonly (readonly Token[])[]; }
export interface ReplayInput { readonly mode: SpinMode; readonly bet: number; readonly stops: Stops; readonly capRemainingBefore: number; }
export interface SpinOutcome { readonly stops: Stops; readonly mode: SpinMode; readonly initialBoard: Board; readonly cascadeSteps: readonly CascadeStep[]; readonly finalBoard: Board; readonly payout: number; readonly capped: boolean; readonly capRemainingAfter: number; readonly huCount: number; readonly freeSpinsAwarded: number; readonly replayInput: ReplayInput; }
export interface FreeSpinState { readonly bet: number; readonly remaining: number; readonly parentTotalWin: number; readonly capped: boolean; }

const paidSymbols: readonly PaidSymbolId[] = ['FA', 'ZHONG', 'BAI', 'WAN8', 'DOT1', 'DOT2', 'DOT3', 'BAM1', 'BAM2'];
/** 固定种子展开为不可变的 100 格轴带；不在旋转或连锁时取随机数。 */
function createStrip(seed: number, reel: number): readonly Token[] {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const order = [...paidSymbols];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return Array.from({ length: 100 }, (_, index) => {
    // 每轴两张胡；中间三轴另有五张金色普通牌。
    if (index % 50 === (seed % 50)) return { symbolId: 'HU' };
    const token: Token = { symbolId: order[Math.floor(index / 2) % order.length] };
    return reel >= 1 && reel <= 3 && index % 20 === (seed % 20) ? { ...token, golden: true } : token;
  });
}
export const MAHJONG_MATH_CONFIG: MahjongMathConfig = {
  version: 'mahjong-math-1.2.0', stripRevision: 'mahjong-strips-1.2.0',
  strips: [createStrip(0x1a2b3c01, 0), createStrip(0x1a2b3c02, 1), createStrip(0x1a2b3c03, 2), createStrip(0x1a2b3c04, 3), createStrip(0x1a2b3c05, 4)],
  payTable: {
    FA: { 3: { numerator: 1_097, denominator: 10_000 }, 4: { numerator: 3_292, denominator: 10_000 }, 5: { numerator: 13_165, denominator: 10_000 } },
    ZHONG: { 3: { numerator: 1_097, denominator: 10_000 }, 4: { numerator: 3_292, denominator: 10_000 }, 5: { numerator: 13_165, denominator: 10_000 } },
    BAI: { 3: { numerator: 1_097, denominator: 10_000 }, 4: { numerator: 3_292, denominator: 10_000 }, 5: { numerator: 13_165, denominator: 10_000 } },
    WAN8: { 3: { numerator: 1_097, denominator: 10_000 }, 4: { numerator: 3_292, denominator: 10_000 }, 5: { numerator: 13_165, denominator: 10_000 } },
    DOT1: { 3: { numerator: 778, denominator: 10_000 }, 4: { numerator: 2_332, denominator: 10_000 }, 5: { numerator: 9_339, denominator: 10_000 } },
    DOT2: { 3: { numerator: 2, denominator: 10_000 }, 4: { numerator: 5, denominator: 10_000 }, 5: { numerator: 18, denominator: 10_000 } },
    DOT3: { 3: { numerator: 2, denominator: 10_000 }, 4: { numerator: 5, denominator: 10_000 }, 5: { numerator: 18, denominator: 10_000 } },
    BAM1: { 3: { numerator: 2, denominator: 10_000 }, 4: { numerator: 5, denominator: 10_000 }, 5: { numerator: 18, denominator: 10_000 } },
    BAM2: { 3: { numerator: 2, denominator: 10_000 }, 4: { numerator: 5, denominator: 10_000 }, 5: { numerator: 18, denominator: 10_000 } },
  },
};
export const TEMPORARY_STRIPS = MAHJONG_MATH_CONFIG.strips;
export const TEMPORARY_PAY_TABLE = MAHJONG_MATH_CONFIG.payTable;

function mod(value: number, length: number): number { return ((value % length) + length) % length; }
function cloneBoard(board: Board): Board { return board.map((column) => column.map((token) => ({ ...token }))); }
function validStops(stops: readonly number[]): stops is Stops { return stops.length === 5 && stops.every(Number.isInteger); }
function isPaidSymbol(symbolId: SymbolId): symbolId is PaidSymbolId { return symbolId !== 'HU' && symbolId !== 'WILD'; }
function payoutFor(bet: number, multiplier: PayoutMultiplier, ways: number): number {
  const value = typeof multiplier === 'number' ? bet * multiplier * ways : bet * multiplier.numerator * ways / multiplier.denominator;
  if (!Number.isInteger(value)) throw new Error('支付表必须产生整数虚拟积分');
  return value;
}
function assertStrips(strips: readonly (readonly Token[])[]): void {
  if (strips.length !== BOARD_HEIGHTS.length) throw new Error('需要五条轴带');
  strips.forEach((strip, x) => strip.forEach((token) => {
    if (token.symbolId === 'WILD') throw new Error('轴带不能含有百搭');
    if (token.golden && (!isPaidSymbol(token.symbolId) || x < 1 || x > 3)) throw new Error('金色牌只允许在第 2~4 卷轴的普通牌');
  }));
}
export function boardFromStops(strips: readonly (readonly Token[])[], stops: Stops): Board {
  if (!validStops(stops)) throw new Error('需要五个整数停点'); assertStrips(strips);
  return BOARD_HEIGHTS.map((height, x) => { const strip = strips[x]; if (strip.length === 0) throw new Error(`轴带 ${x} 不能为空`); return Array.from({ length: height }, (_, y) => ({ ...strip[mod(stops[x] + y, strip.length)] })); });
}
export function multiplierForCascade(cascadeIndex: number, mode: SpinMode = 'paid'): number {
  if (!Number.isInteger(cascadeIndex) || cascadeIndex < 1) throw new Error('连锁序号必须从 1 开始');
  const sequence = mode === 'free' ? FREE_CASCADE_MULTIPLIERS : CASCADE_MULTIPLIERS;
  return sequence[Math.min(cascadeIndex, sequence.length) - 1];
}
export function freeSpinsForHu(huCount: number): number { return huCount >= 3 ? 10 + (huCount - 3) * 2 : 0; }
export function evaluateWays(board: Board, bet: number, payTable: PayTable, cascadeIndex = 1, mode: SpinMode = 'paid'): readonly WaysWin[] {
  if (!Number.isFinite(bet) || bet <= 0) throw new Error('投注必须为正数'); const cascadeMultiplier = multiplierForCascade(cascadeIndex, mode); const wins: WaysWin[] = [];
  for (const symbolId of Object.keys(payTable) as PaidSymbolId[]) {
    const counts = board.map((column) => column.filter((token) => token.symbolId === symbolId || token.symbolId === 'WILD').length); let run = 0; while (run < counts.length && counts[run] > 0) run += 1;
    if (run < 3) continue; const payoutMultiplier = payTable[symbolId]?.[run as 3 | 4 | 5]; if (!payoutMultiplier) continue;
    const ways = counts.slice(0, run).reduce((total, count) => total * count, 1); const basePayout = payoutFor(bet, payoutMultiplier, ways); if (basePayout <= 0) continue;
    const cells = board.flatMap((column, x) => column.flatMap((token, y) => x < run && (token.symbolId === symbolId || token.symbolId === 'WILD') ? [{ x, y }] : []));
    wins.push({ symbolId, run: run as 3 | 4 | 5, ways, basePayout, cascadeMultiplier, payout: basePayout * cascadeMultiplier, cells });
  } return wins;
}
export function settleSpin(stops: Stops, bet: number, strips = TEMPORARY_STRIPS, payTable = TEMPORARY_PAY_TABLE, options: Readonly<{ mode?: SpinMode; capRemainingBefore?: number }> = {}): SpinOutcome {
  const mode = options.mode ?? 'paid'; const capRemainingBefore = options.capRemainingBefore ?? bet * MAX_WIN_MULTIPLIER;
  if (!Number.isInteger(capRemainingBefore) || capRemainingBefore < 0) throw new Error('封顶余额必须为非负整数');
  const initialBoard = boardFromStops(strips, stops); let board = cloneBoard(initialBoard); let capRemaining = capRemainingBefore; let payout = 0; let capped = false;
  const refillsUsed = [0, 0, 0, 0, 0]; const cascadeSteps: CascadeStep[] = [];
  for (let cascadeIndex = 1; ; cascadeIndex += 1) {
    const beforeBoard = cloneBoard(board); const wins = evaluateWays(beforeBoard, bet, payTable, cascadeIndex, mode); if (wins.length === 0) break;
    const candidatePayout = wins.reduce((total, win) => total + win.payout, 0); const stepPayout = Math.min(candidatePayout, capRemaining); const stepCapped = candidatePayout >= capRemaining;
    payout += stepPayout; capRemaining -= stepPayout;
    if (stepCapped) { cascadeSteps.push({ beforeBoard, afterBoard: beforeBoard, wins, cascadeMultiplier: multiplierForCascade(cascadeIndex, mode), candidatePayout, payout: stepPayout, capped: true, goldenTransforms: [], removed: [], refills: [] }); capped = true; break; }
    const cells = [...new Map(wins.flatMap((win) => win.cells).map((cell) => [`${cell.x}:${cell.y}`, cell])).values()]; const goldenTransforms = cells.filter(({ x, y }) => Boolean(beforeBoard[x][y].golden));
    const transformKeys = new Set(goldenTransforms.map(({ x, y }) => `${x}:${y}`)); const removed = cells.filter(({ x, y }) => !transformKeys.has(`${x}:${y}`)); const removedKeys = new Set(removed.map(({ x, y }) => `${x}:${y}`)); const refills: Token[][] = [];
    board = board.map((column, x) => { const transformed = column.map((token, y) => transformKeys.has(`${x}:${y}`) ? { symbolId: 'WILD' as const } : { ...token }); const falling = transformed.filter((_, y) => !removedKeys.has(`${x}:${y}`)); const emptyCount = BOARD_HEIGHTS[x] - falling.length; const strip = strips[x]; const filled = Array.from({ length: emptyCount }, (_, y) => ({ ...strip[mod(stops[x] - refillsUsed[x] - emptyCount + y, strip.length)] })); refillsUsed[x] += emptyCount; refills.push(filled); return [...filled, ...falling]; });
    cascadeSteps.push({ beforeBoard, afterBoard: cloneBoard(board), wins, cascadeMultiplier: multiplierForCascade(cascadeIndex, mode), candidatePayout, payout: stepPayout, capped: false, goldenTransforms, removed, refills });
  }
  const huCount = board.flat().filter((token) => token.symbolId === 'HU').length; const freeSpinsAwarded = capped ? 0 : freeSpinsForHu(huCount);
  return { stops, mode, initialBoard, cascadeSteps, finalBoard: cloneBoard(board), payout, capped, capRemainingAfter: capRemaining, huCount, freeSpinsAwarded, replayInput: { mode, bet, stops, capRemainingBefore } };
}
export function replaySpin(input: ReplayInput, strips = TEMPORARY_STRIPS, payTable = TEMPORARY_PAY_TABLE): SpinOutcome { return settleSpin(input.stops, input.bet, strips, payTable, { mode: input.mode, capRemainingBefore: input.capRemainingBefore }); }
export function freeStateFromPaidSpin(outcome: SpinOutcome): FreeSpinState | undefined { return outcome.mode === 'paid' && !outcome.capped && outcome.freeSpinsAwarded > 0 ? { bet: outcome.replayInput.bet, remaining: outcome.freeSpinsAwarded, parentTotalWin: outcome.payout, capped: false } : undefined; }
export function settleFreeSpin(state: FreeSpinState, stops: Stops, strips = TEMPORARY_STRIPS, payTable = TEMPORARY_PAY_TABLE): Readonly<{ outcome: SpinOutcome; state: FreeSpinState | undefined }> {
  if (state.remaining <= 0 || state.capped) throw new Error('没有可用免费旋转'); const outcome = settleSpin(stops, state.bet, strips, payTable, { mode: 'free', capRemainingBefore: state.bet * MAX_WIN_MULTIPLIER - state.parentTotalWin });
  if (outcome.capped) return { outcome, state: undefined }; const remaining = state.remaining - 1 + outcome.freeSpinsAwarded;
  return { outcome, state: remaining > 0 ? { bet: state.bet, remaining, parentTotalWin: state.parentTotalWin + outcome.payout, capped: false } : undefined };
}
