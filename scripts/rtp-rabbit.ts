import {
  MAX_WIN_MULTIPLIER,
  ENGINE_VERSION,
  MATH_CONFIG_VERSION,
  MODE_TRIGGER_PROBABILITY,
  STRIP_REVISION,
  TEMPORARY_MODE_STRIPS,
  TEMPORARY_STRIPS,
  settleRound,
} from '../src/rabbit/engine/index.ts';

const rounds = Number(process.argv[2] ?? 10_000_000);
const bet = 100;
const batchCount = 20;
const seed = 0x39102026;

if (!Number.isSafeInteger(rounds) || rounds < batchCount) throw new Error(`回合数必须是不小于 ${batchCount} 的正整数`);

type Batch = {
  count: number;
  total: number;
};

const batches: Batch[] = Array.from({ length: batchCount }, () => ({ count: 0, total: 0 }));
const distribution = new Uint32Array(MAX_WIN_MULTIPLIER * bet + 1);
let sum = 0;
let sumSquares = 0;
let hits = 0;
let triggers = 0;
let lineContribution = 0;
let bonusContribution = 0;
let modeContribution = 0;
let maximum = 0;
let capped = 0;

for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
  const batchRounds = Math.floor(rounds / batchCount) + (batchIndex < rounds % batchCount ? 1 : 0);
  let state = (seed + Math.imul(batchIndex, 0x9e3779b9)) >>> 0;
  const nextUint32 = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  const nextUnit = (): number => nextUint32() / 0x1_0000_0000;
  const nextStops = (): [number, number, number] => [
    nextUint32() % TEMPORARY_STRIPS[0].length,
    nextUint32() % TEMPORARY_STRIPS[1].length,
    nextUint32() % TEMPORARY_STRIPS[2].length,
  ];

  for (let index = 0; index < batchRounds; index += 1) {
    const paidStops = nextStops();
    const triggerRoll = nextUnit();
    const triggered = triggerRoll < MODE_TRIGGER_PROBABILITY;
    const modeStops = triggered
      ? Array.from({ length: 8 }, () => [
        nextUint32() % TEMPORARY_MODE_STRIPS[0].length,
        nextUint32() % TEMPORARY_MODE_STRIPS[1].length,
        nextUint32() % TEMPORARY_MODE_STRIPS[2].length,
      ] as [number, number, number])
      : [];
    const outcome = settleRound({
      gameId: 'jade-rabbit',
      engineVersion: ENGINE_VERSION,
      mathConfigVersion: MATH_CONFIG_VERSION,
      stripRevision: STRIP_REVISION,
      bet,
      parentRoundId: `rtp-rabbit-${batchIndex}-${index}`,
      mode: 'paid',
      triggerRoll,
      paidStops,
      modeStops,
      capRemainingBefore: MAX_WIN_MULTIPLIER * bet,
    });

    const multiple = outcome.totalWin / bet;
    const paidLine = outcome.paidSpin.lineWins.reduce((total, win) => total + win.payout, 0) / bet;
    const paidBonus = outcome.paidSpin.bonusPayout / bet;
    const modeWin = outcome.modeSpins.reduce((total, spin) => total + spin.payout, 0) / bet;
    if (outcome.totalWin > MAX_WIN_MULTIPLIER * bet) throw new Error('模拟发现超过 5,000 倍封顶');

    sum += multiple;
    sumSquares += multiple ** 2;
    if (outcome.totalWin > 0) hits += 1;
    if (outcome.triggered) triggers += 1;
    lineContribution += paidLine;
    bonusContribution += paidBonus;
    modeContribution += modeWin;
    maximum = Math.max(maximum, outcome.totalWin);
    if (outcome.capped) capped += 1;
    distribution[outcome.totalWin] += 1;
    batches[batchIndex].count += 1;
    batches[batchIndex].total += multiple;
  }
}

const mean = sum / rounds;
const variance = Math.max(0, (sumSquares - sum ** 2 / rounds) / (rounds - 1));
const standardDeviation = Math.sqrt(variance);
const margin = 1.96 * standardDeviation / Math.sqrt(rounds);
const pct = (value: number): string => `${(value * 100).toFixed(4)}%`;
let cumulative = 0;
let percentile99 = 0;
for (let win = 0; win < distribution.length; win += 1) {
  cumulative += distribution[win];
  if (cumulative >= rounds * 0.99) {
    percentile99 = win / bet;
    break;
  }
}

const batchMeans = batches.map((batch) => batch.total / batch.count);
console.log(`玉兔送财数学模拟：${rounds.toLocaleString()} 个独立付费回合（20 批，固定种子 0x${seed.toString(16)})`);
console.log(`配置：${MATH_CONFIG_VERSION}；轴带：${STRIP_REVISION}；投注：${bet}；模式触发率：${pct(MODE_TRIGGER_PROBABILITY)}`);
console.log(`RTP：${pct(mean)}；95% 置信区间：[${pct(mean - margin)}, ${pct(mean + margin)}]`);
console.log(`线奖贡献：${pct(lineContribution / rounds)}；奖金符号贡献：${pct(bonusContribution / rounds)}；玉兔模式贡献：${pct(modeContribution / rounds)}`);
console.log(`中奖频率：${pct(hits / rounds)}；玉兔模式触发频率：${pct(triggers / rounds)}`);
console.log(`每局赢分标准差：${standardDeviation.toFixed(4)}×；第 99 百分位：${percentile99.toFixed(2)}×；最高赢分：${(maximum / bet).toFixed(2)}×；封顶频率：${pct(capped / rounds)}`);
console.log(`20 批均值范围：${Math.min(...batchMeans).toFixed(6)}× ~ ${Math.max(...batchMeans).toFixed(6)}×`);
