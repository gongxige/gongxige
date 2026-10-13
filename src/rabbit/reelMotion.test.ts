import assert from 'node:assert/strict';
import test from 'node:test';
import { COLUMN_DECEL_STARTS, COLUMN_START_DELAYS, REEL_MOTION, ReelMotion } from './reelMotion.ts';

const FRAME = 1 / 60;

/** 按 60 帧/秒跑到停下，返回每帧的位置和阶段。 */
function run(rows: number, delay: number, stopAt: number, quick = false) {
  const motion = new ReelMotion(rows);
  motion.start(0, delay);
  const frames: { t: number; p: number; phase: string }[] = [];
  let requested = false;
  for (let t = 0; t < 5; t += FRAME) {
    if (!requested && t >= stopAt) { motion.requestStop(t, quick); requested = true; }
    const { p, phase } = motion.sample(t);
    frames.push({ t, p, phase });
    if (phase === 'done') break;
  }
  return { motion, frames };
}

test('STEP-52 起转先上抬再往下走，全速约每秒 17 格', () => {
  const { frames } = run(4, 0, 0.5);
  const lift = Math.max(...frames.filter((f) => f.t < 0.1).map((f) => f.p));
  assert.ok(lift > 0.1 && lift <= REEL_MOTION.liftCells + 1e-9, `上抬 ${lift}`);
  const a = frames.find((f) => f.t >= 0.3)!;
  const b = frames.find((f) => f.t >= 0.4)!;
  const speed = (a.p - b.p) / (b.t - a.t);
  assert.ok(Math.abs(speed - 17) < 0.5, `全速 ${speed}`);
});

test('STEP-52 停下时正好停在整数格上，结果放上去时在视口外', () => {
  for (const rows of [3, 4]) {
    for (const stopAt of [0.31, 0.5, 0.77, 1.234]) {
      const motion = new ReelMotion(rows);
      motion.start(0);
      motion.sample(stopAt - FRAME);
      const before = motion.sample(stopAt).p;
      const stopK = motion.requestStop(stopAt)!;
      assert.equal(Number.isInteger(stopK), true);
      // 结果占滚动带 stopK ~ stopK+rows-1，换上去的瞬间整段都在视口顶端 p 的上方。
      assert.ok(stopK + rows <= before + 1e-9, `rows=${rows} stopK=${stopK} p=${before}`);
      let last = motion.sample(stopAt);
      for (let t = stopAt; last.phase !== 'done'; t += FRAME) last = motion.sample(t);
      assert.equal(last.p, stopK);
    }
  }
});

test('STEP-52 减速约 0.4 秒、末尾多走一点再退回', () => {
  const { frames } = run(4, 0, 0.5);
  const decel = frames.filter((f) => f.phase === 'decel');
  const duration = decel.at(-1)!.t - decel[0].t;
  assert.ok(duration > 0.3 && duration < 0.45, `减速 ${duration}`);
  const stopK = frames.at(-1)!.p;
  const lowest = Math.min(...frames.map((f) => f.p));
  assert.ok(stopK - lowest > 0.05 && stopK - lowest <= REEL_MOTION.overshootCells + 1e-9, `多走 ${stopK - lowest}`);
  // 减速段一直往下走（p 单调变小），回弹段一直往回（p 单调变大）。
  for (let i = 1; i < decel.length; i += 1) assert.ok(decel[i].p <= decel[i - 1].p);
  const bounce = frames.filter((f) => f.phase === 'bounce');
  for (let i = 1; i < bounce.length; i += 1) assert.ok(bounce[i].p >= bounce[i - 1].p);
});

test('STEP-52 按计划时间三列依次在约 0.9、1.15、1.45 秒停下', () => {
  const stops = COLUMN_START_DELAYS.map((delay, x) => {
    const { frames } = run(x === 1 ? 4 : 3, delay, COLUMN_DECEL_STARTS[x]);
    return frames.find((f) => f.phase === 'bounce')!.t;
  });
  [0.9, 1.15, 1.45].forEach((expected, x) => assert.ok(Math.abs(stops[x] - expected) < 0.1, `第 ${x + 1} 列停在 ${stops[x]}`));
});

test('STEP-52 还在加速时请求停下，等到全速后再定停点', () => {
  const motion = new ReelMotion(3);
  motion.start(0);
  assert.equal(motion.requestStop(0.05), null);
  let last = motion.sample(0.05);
  for (let t = 0.05; last.phase !== 'done'; t += FRAME) last = motion.sample(t);
  assert.equal(Number.isInteger(last.p), true);
});

test('STEP-52 下一局从上一局的停点接着转，停点仍是整数且在起点下方', () => {
  const motion = new ReelMotion(4);
  motion.start(0, 0, -14);
  assert.equal(motion.sample(0).p, -14);
  const stopK = motion.requestStop(0.6)!;
  let last = motion.sample(0.6);
  for (let t = 0.6; last.phase !== 'done'; t += FRAME) last = motion.sample(t);
  assert.equal(last.p, stopK);
  assert.ok(stopK < -14 - 4);
});
