// Prints the game's exact RTP per symbol, then cross-checks it with a
// Monte Carlo run and reports hit rate and win distribution.
// Usage: npm run rtp [-- <spins>]

import { randomInt } from 'node:crypto';
import { ALLOWED_BETS, computeRtp, spin } from '../src/engine/index.ts';

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

const exact = computeRtp();
console.log('理论 RTP（精确计算）');
for (const [symbol, value] of Object.entries(exact.bySymbol).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${symbol.padEnd(9)} ${pct(value)}`);
}
console.log(`  ${'合计'.padEnd(8)} ${pct(exact.total)}`);

const spins = Number(process.argv[2] ?? 1_000_000);
const bet = ALLOWED_BETS[0];
let paid = 0;
let hits = 0;
let biggest = 0;
for (let i = 0; i < spins; i += 1) {
  const { payout } = spin(bet, randomInt);
  paid += payout;
  if (payout > 0) hits += 1;
  biggest = Math.max(biggest, payout);
}
console.log(`\n模拟 ${spins.toLocaleString()} 次（投注 ${bet}）`);
console.log(`  RTP      ${pct(paid / (bet * spins))}`);
console.log(`  中奖率   ${pct(hits / spins)}`);
console.log(`  最大单次 ${biggest / bet}× 投注`);
