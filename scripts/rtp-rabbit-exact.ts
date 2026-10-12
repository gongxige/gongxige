// 玉兔送财理论 RTP 的精确计算（不抽随机数，穷举全部停点）。
// 1.3.0 加入高倍牌匾后每局标准差约 10.7 倍，1,000 万局模拟的统计误差约 ±0.34 个百分点；
// 这里按轴带逐格精确计算，作为 RTP 的正式依据，模拟用来交叉核对和测波动。
// 用法：npm run rtp:rabbit:exact [数学版本]
import {
  BOARD_HEIGHTS,
  BONUS_MULTIPLIERS,
  MATH_CONFIG_VERSION,
  MODE_SPINS,
  mathConfigForVersion,
  type ReelStrips,
} from '../src/rabbit/engine/index.ts';

const version = process.argv[2] ?? MATH_CONFIG_VERSION;
const config = mathConfigForVersion(version);
const lineSymbols = ['WILD', 'YUANBAO', 'FU_BAG', 'RED_ENVELOPE', 'COPPER_COIN', 'FIRECRACKER', 'CARROT'] as const;

/** 线奖：每条线的三格分别在三列，各列停点独立且均匀，所以每格的符号分布就是该列轴带的符号频率。 */
function lineRtp(strips: ReelStrips): number {
  const frequency = strips.map((strip) => {
    const counts = new Map<string, number>();
    for (const entry of strip) counts.set(entry.symbolId, (counts.get(entry.symbolId) ?? 0) + 1);
    return (symbol: string) => (counts.get(symbol) ?? 0) / strip.length;
  });
  const pay = config.payTable as Record<string, number | undefined>;
  let perLine = 0;
  for (const a of lineSymbols) for (const b of lineSymbols) for (const c of lineSymbols) {
    const probability = frequency[0](a) * frequency[1](b) * frequency[2](c);
    if (probability === 0) continue;
    const trio = [a, b, c];
    let best = trio.every((symbol) => symbol === 'WILD') ? pay.WILD ?? 0 : 0;
    for (const symbol of lineSymbols.slice(1)) {
      if (trio.every((entry) => entry === symbol || entry === 'WILD')) best = Math.max(best, pay[symbol] ?? 0);
    }
    perLine += probability * best / 10; // 每线投注 = 总投注 ÷ 10
  }
  return perLine * config.paylines.length;
}

/** 奖金牌匾：穷举每列停点得到「这一列窗口里的牌匾数和倍数之和」，三列独立组合；5 个以上支付全部之和。 */
function plateRtp(strips: ReelStrips): { rtp: number; atLeastFive: number } {
  const columns = strips.map((strip, x) => {
    const outcomes = new Map<string, number>();
    for (let stop = 0; stop < strip.length; stop += 1) {
      let count = 0;
      let value = 0;
      for (let y = 0; y < BOARD_HEIGHTS[x]; y += 1) {
        const entry = strip[(stop + y) % strip.length];
        if (entry.symbolId === 'BONUS_PLATE') { count += 1; value += BONUS_MULTIPLIERS[entry.bonusTier ?? 0]; }
      }
      const key = `${count}|${value}`;
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1 / strip.length);
    }
    return [...outcomes].map(([key, probability]) => { const [count, value] = key.split('|').map(Number); return { count, value, probability }; });
  });
  let rtp = 0;
  let atLeastFive = 0;
  for (const a of columns[0]) for (const b of columns[1]) for (const c of columns[2]) {
    if (a.count + b.count + c.count < 5) continue;
    const probability = a.probability * b.probability * c.probability;
    rtp += probability * (a.value + b.value + c.value);
    atLeastFive += probability;
  }
  return { rtp, atLeastFive };
}

const pct = (value: number) => `${(value * 100).toFixed(4)}%`;
const line = lineRtp(config.strips);
const mainPlates = plateRtp(config.strips);
const modeSpin = plateRtp(config.modeStrips);
const mode = config.modeTriggerProbability * MODE_SPINS * modeSpin.rtp;
const total = line + mainPlates.rtp + mode;
console.log(`玉兔送财理论 RTP（精确计算）：${version}；轴带 ${config.stripRevision}`);
console.log(`轴带长度：主游戏 ${config.strips.map((strip) => strip.length).join('/')}，玉兔模式 ${config.modeStrips.map((strip) => strip.length).join('/')}`);
console.log(`线奖：${pct(line)}`);
console.log(`主游戏奖金牌匾：${pct(mainPlates.rtp)}（一次旋转出现 5 个以上牌匾的概率 ${pct(mainPlates.atLeastFive)}）`);
console.log(`玉兔模式：${pct(mode)}（触发率 ${pct(config.modeTriggerProbability)} × ${MODE_SPINS} 次 × 每次期望 ${modeSpin.rtp.toFixed(4)} 倍；每次 5 个以上牌匾的概率 ${pct(modeSpin.atLeastFive)}）`);
console.log(`合计：${pct(total)}（未扣 5,000 倍封顶；模拟中封顶频率为 0，影响可忽略）`);
