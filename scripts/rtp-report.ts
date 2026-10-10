// Prints the game's exact RTP per symbol, then cross-checks it with a
// Monte Carlo run (free spins included) and reports hit and trigger rates.
// Usage: npm run rtp [-- <rounds>]

import { randomInt } from 'node:crypto';
import { ALLOWED_BETS, computeRtp, playRound } from '../src/engine/index.ts';

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

const exact = computeRtp();
console.log('理论 RTP（精确计算）');
console.log('  付费旋转本身，各符号贡献：');
for (const [symbol, value] of Object.entries(exact.bySymbol).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${symbol.padEnd(9)} ${pct(value)}`);
}
console.log(`  付费旋转   ${pct(exact.basePerSpin)}`);
console.log(`  免费游戏   ${pct(exact.freeSpins)}（每局免费游戏 ${pct(exact.freePerSpin)}；触发率 1/${(1 / exact.triggerRate).toFixed(0)}，每次触发平均 ${exact.freeSpinsPerTrigger.toFixed(2)} 局，每局平均再加 ${exact.retriggerRate.toFixed(3)} 局）`);
console.log(`  总 RTP     ${pct(exact.total)}`);

const rounds = Number(process.argv[2] ?? 1_000_000);
const bet = ALLOWED_BETS[0];
let paid = 0;
let hits = 0;
let triggers = 0;
let freeSpins = 0;
let biggest = 0;
for (let i = 0; i < rounds; i += 1) {
  const round = playRound(bet, randomInt);
  paid += round.payout;
  if (round.payout > 0) hits += 1;
  if (round.freeSpinsPlayed > 0) triggers += 1;
  freeSpins += round.freeSpinsPlayed;
  biggest = Math.max(biggest, round.payout);
}
console.log(`\n模拟 ${rounds.toLocaleString()} 次付费旋转（投注 ${bet}，含免费游戏）`);
console.log(`  RTP          ${pct(paid / (bet * rounds))}`);
console.log(`  中奖率       ${pct(hits / rounds)}`);
console.log(`  免费游戏触发 1/${(rounds / Math.max(triggers, 1)).toFixed(0)}，平均每次 ${(freeSpins / Math.max(triggers, 1)).toFixed(2)} 局`);
console.log(`  最大单轮     ${biggest / bet}× 投注`);
