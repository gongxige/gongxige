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
export type PayTable = Readonly<Partial<Record<PaidSymbolId, Readonly<Partial<Record<3 | 4 | 5, number>>>>>>;
export type SpinMode = 'paid' | 'free';
export interface WaysWin { readonly symbolId: PaidSymbolId; readonly run: 3 | 4 | 5; readonly ways: number; readonly basePayout: number; readonly cascadeMultiplier: number; readonly payout: number; readonly cells: readonly Coordinate[]; }
export interface CascadeStep { readonly beforeBoard: Board; readonly afterBoard: Board; readonly wins: readonly WaysWin[]; readonly cascadeMultiplier: number; readonly candidatePayout: number; readonly payout: number; readonly capped: boolean; readonly goldenTransforms: readonly Coordinate[]; readonly removed: readonly Coordinate[]; readonly refills: readonly (readonly Token[])[]; }
export interface ReplayInput { readonly mode: SpinMode; readonly bet: number; readonly stops: Stops; readonly capRemainingBefore: number; }
export interface SpinOutcome { readonly stops: Stops; readonly mode: SpinMode; readonly initialBoard: Board; readonly cascadeSteps: readonly CascadeStep[]; readonly finalBoard: Board; readonly payout: number; readonly capped: boolean; readonly capRemainingAfter: number; readonly huCount: number; readonly freeSpinsAwarded: number; readonly replayInput: ReplayInput; }
export interface FreeSpinState { readonly bet: number; readonly remaining: number; readonly parentTotalWin: number; readonly capped: boolean; }

/** 临时轴带；STEP-26 会以经调校且版本化的正式轴带替换。 */
export const TEMPORARY_STRIPS: readonly (readonly Token[])[] = [
  [{ symbolId: 'FA' }, { symbolId: 'ZHONG' }, { symbolId: 'BAI' }, { symbolId: 'WAN8' }, { symbolId: 'DOT1' }, { symbolId: 'DOT2' }, { symbolId: 'DOT3' }, { symbolId: 'BAM1' }, { symbolId: 'BAM2' }],
  [{ symbolId: 'ZHONG' }, { symbolId: 'FA' }, { symbolId: 'WAN8' }, { symbolId: 'BAI' }, { symbolId: 'DOT2' }, { symbolId: 'DOT1' }, { symbolId: 'BAM1' }, { symbolId: 'DOT3' }, { symbolId: 'BAM2' }],
  [{ symbolId: 'BAI' }, { symbolId: 'WAN8' }, { symbolId: 'FA' }, { symbolId: 'ZHONG' }, { symbolId: 'DOT3' }, { symbolId: 'BAM2' }, { symbolId: 'DOT1' }, { symbolId: 'DOT2' }, { symbolId: 'BAM1' }],
  [{ symbolId: 'WAN8' }, { symbolId: 'BAI' }, { symbolId: 'ZHONG' }, { symbolId: 'FA' }, { symbolId: 'BAM1' }, { symbolId: 'BAM2' }, { symbolId: 'DOT2' }, { symbolId: 'DOT1' }, { symbolId: 'DOT3' }],
  [{ symbolId: 'DOT1' }, { symbolId: 'DOT2' }, { symbolId: 'DOT3' }, { symbolId: 'BAM1' }, { symbolId: 'BAM2' }, { symbolId: 'FA' }, { symbolId: 'ZHONG' }, { symbolId: 'BAI' }, { symbolId: 'WAN8' }],
] as const;
export const TEMPORARY_PAY_TABLE: PayTable = { FA: { 3: 1, 4: 2, 5: 4 }, ZHONG: { 3: 1, 4: 2, 5: 4 }, BAI: { 3: 1, 4: 2, 5: 4 }, WAN8: { 3: 1, 4: 2, 5: 4 }, DOT1: { 3: 1, 4: 2, 5: 3 }, DOT2: { 3: 1, 4: 2, 5: 3 }, DOT3: { 3: 1, 4: 2, 5: 3 }, BAM1: { 3: 1, 4: 2, 5: 3 }, BAM2: { 3: 1, 4: 2, 5: 3 } };

function mod(value: number, length: number): number { return ((value % length) + length) % length; }
function cloneBoard(board: Board): Board { return board.map((column) => column.map((token) => ({ ...token }))); }
function validStops(stops: readonly number[]): stops is Stops { return stops.length === 5 && stops.every(Number.isInteger); }
function isPaidSymbol(symbolId: SymbolId): symbolId is PaidSymbolId { return symbolId !== 'HU' && symbolId !== 'WILD'; }
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
    if (run < 3) continue; const payoutMultiplier = payTable[symbolId]?.[run as 3 | 4 | 5]; if (!payoutMultiplier || payoutMultiplier <= 0) continue;
    const ways = counts.slice(0, run).reduce((total, count) => total * count, 1); const basePayout = bet * payoutMultiplier * ways; if (!Number.isInteger(basePayout)) throw new Error('支付表必须产生整数虚拟积分');
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
