import { MAHJONG_MATH_CONFIG, MAX_WIN_MULTIPLIER, settleFreeSpin, settleSpin } from '../src/mahjong/engine/index.ts';

const rounds = Number(process.argv[2] ?? 10_000_000);
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('回合数必须是正整数');
const bet = 100;
let state = 0x26_10_2026;
const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
const stops = () => [next() % 100, next() % 100, next() % 100, next() % 100, next() % 100] as const;
let paid = 0, free = 0, hits = 0, triggers = 0, capped = 0, maximum = 0, sum = 0, sumSquares = 0;
const batches = Array.from({ length: 20 }, () => ({ total: 0, count: 0 }));
const distribution = new Uint32Array(bet * MAX_WIN_MULTIPLIER + 1);
for (let index = 0; index < rounds; index += 1) {
  let outcome = settleSpin(stops(), bet, MAHJONG_MATH_CONFIG.strips, MAHJONG_MATH_CONFIG.payTable);
  let totalWin = outcome.payout;
  paid += outcome.payout;
  if (outcome.freeSpinsAwarded > 0) triggers += 1;
  let remaining = outcome.freeSpinsAwarded;
  while (remaining > 0 && !outcome.capped) {
    const settled = settleFreeSpin({ bet, remaining, parentTotalWin: totalWin, capped: false }, stops(), MAHJONG_MATH_CONFIG.strips, MAHJONG_MATH_CONFIG.payTable);
    outcome = settled.outcome;
    totalWin += outcome.payout;
    free += outcome.payout;
    remaining = settled.state?.remaining ?? 0;
  }
  if (totalWin > 0) hits += 1;
  if (outcome.capped) capped += 1;
  if (totalWin > bet * MAX_WIN_MULTIPLIER) throw new Error('模拟发现超过封顶的支付');
  maximum = Math.max(maximum, totalWin);
  const multiple = totalWin / bet;
  distribution[totalWin] += 1;
  sum += multiple;
  sumSquares += multiple ** 2;
  const batch = batches[index % batches.length]; batch.total += multiple; batch.count += 1;
}
const mean = sum / rounds;
const variance = Math.max(0, (sumSquares - sum ** 2 / rounds) / (rounds - 1));
const standardDeviation = Math.sqrt(variance);
const margin = 1.96 * standardDeviation / Math.sqrt(rounds);
const pct = (value: number) => `${(value * 100).toFixed(4)}%`;
let cumulative = 0, percentile99 = 0;
for (let win = 0; win < distribution.length; win += 1) { cumulative += distribution[win]; if (cumulative >= rounds * 0.99) { percentile99 = win / bet; break; } }
console.log(`麻将连连胡数学模拟：${rounds.toLocaleString()} 个独立付费回合（固定种子 0x26102026）`);
console.log(`配置：${MAHJONG_MATH_CONFIG.version}；轴带：${MAHJONG_MATH_CONFIG.stripRevision}`);
console.log(`RTP：${pct(mean)}；95% 置信区间：[${pct(mean - margin)}, ${pct(mean + margin)}]`);
console.log(`付费贡献：${pct(paid / (bet * rounds))}；免费贡献：${pct(free / (bet * rounds))}`);
console.log(`中奖频率：${pct(hits / rounds)}；免费触发频率：${pct(triggers / rounds)}`);
console.log(`标准差：${standardDeviation.toFixed(4)}×；第 99 百分位：${percentile99.toFixed(2)}×；最高赢分：${(maximum / bet).toFixed(2)}×；封顶频率：${pct(capped / rounds)}`);
console.log(`20 批均值范围：${Math.min(...batches.map((batch) => batch.total / batch.count)).toFixed(6)}× ~ ${Math.max(...batches.map((batch) => batch.total / batch.count)).toFixed(6)}×`);
