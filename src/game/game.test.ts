import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REEL_STRIPS, ROWS, SCATTER, gridFromStops, windowAt } from '../engine/index.ts';
import { ACCEL_MS, MIN_STOP_DISTANCE, OVERSHOOT, ReelMotion, SPIN_SPEED } from './reelMotion.ts';
import { ReelTape } from './reelTape.ts';
import { ANTICIPATION_SLOW_MS, ANTICIPATION_SPIN_MS, FIRST_STOP_MS, STOP_INTERVAL_MS, SpinController } from './spinController.ts';
import { AUTO_SPIN_DELAY_MS, AutoSpinController, highestAllowedBet, isAutoSpinLongPress, isBetChangeLocked, LONG_PRESS_MS, type AutoStopReason } from './autoSpin.ts';

/** Run the motion frame by frame (60fps) until it lands; returns every position seen. */
function runUntilLanded(motion: ReelMotion, from: number): { positions: number[]; landedAt: number } {
  const positions: number[] = [];
  for (let now = from; now < from + 10_000; now += 16) {
    const landed = motion.update(now);
    positions.push(motion.position);
    if (landed) return { positions, landedAt: now };
  }
  throw new Error('Reel never landed');
}

describe('ReelMotion', () => {
  it('uses the slower, readable spin speed', () => {
    assert.ok(SPIN_SPEED >= 0.012 && SPIN_SPEED <= 0.014, `spin speed is ${SPIN_SPEED} symbols/ms`);
  });

  it('reaches full speed after the acceleration phase', () => {
    const motion = new ReelMotion();
    motion.start(0);
    motion.update(ACCEL_MS + 100);
    const a = motion.position;
    motion.update(ACCEL_MS + 200);
    assert.ok(Math.abs((motion.position - a) / 100 - SPIN_SPEED) < 1e-9);
    assert.ok(motion.canStop);
  });

  it('lands exactly on a whole-number target far enough ahead to place symbols off-screen', () => {
    const motion = new ReelMotion();
    motion.start(0);
    motion.update(1000);
    const before = motion.position;
    const target = motion.stop(1000);
    assert.ok(Number.isInteger(target));
    assert.ok(target >= Math.ceil(before) + MIN_STOP_DISTANCE);
    const { positions } = runUntilLanded(motion, 1016);
    assert.equal(motion.position, target);
    assert.ok(motion.isIdle);
    // Overshoots by OVERSHOOT, then springs back.
    assert.ok(Math.abs(Math.max(...positions) - (target + OVERSHOOT)) < 0.01);
  });

  it('keeps the same speed when it starts decelerating (no jolt)', () => {
    const motion = new ReelMotion();
    motion.start(0);
    motion.update(1000);
    motion.stop(1000);
    const start = motion.position;
    motion.update(1001);
    assert.ok(Math.abs((motion.position - start) - SPIN_SPEED) / SPIN_SPEED < 0.01);
  });

  it('only moves forward until the overshoot', () => {
    const motion = new ReelMotion();
    motion.start(0);
    motion.update(800);
    const target = motion.stop(800);
    const { positions } = runUntilLanded(motion, 816);
    const peak = positions.indexOf(Math.max(...positions));
    for (let i = 1; i <= peak; i += 1) assert.ok(positions[i] >= positions[i - 1]);
    assert.ok(positions[positions.length - 1] === target);
  });
});

describe('ReelTape', () => {
  it('shows the strip window for the anchor stop', () => {
    const tape = new ReelTape(REEL_STRIPS[0], 10);
    assert.deepEqual([0, 1, 2, 3].map((i) => tape.symbolAt(i)), REEL_STRIPS[0].slice(10, 14));
  });

  it('landing changes only the indices from the landing window upward', () => {
    const tape = new ReelTape(REEL_STRIPS[2], 0);
    const below = [-2, -1, 0, 1, 2].map((i) => tape.symbolAt(i));
    tape.land(-9, 30);
    assert.deepEqual([-9, -8, -7, -6].map((i) => tape.symbolAt(i)), REEL_STRIPS[2].slice(30, 34));
    assert.equal(tape.symbolAt(-10), REEL_STRIPS[2][29], 'above the window continues the real strip');
    assert.deepEqual([-2, -1, 0, 1, 2].map((i) => tape.symbolAt(i)), below, 'symbols already on screen are unchanged');
  });
});

describe('SpinController', () => {
  const visibleGrid = (controller: SpinController) =>
    controller.motions.map((motion, reel) => Array.from({ length: ROWS }, (_, row) => controller.tapes[reel].symbolAt(row - motion.position)));

  function spinTo(stops: number[], resultAt: number) {
    const controller = new SpinController([0, 0, 0, 0, 0]);
    controller.start(0);
    const landings: { reel: number; at: number }[] = [];
    let now = 0;
    for (; now < 10_000; now += 16) {
      if (now >= resultAt) controller.setResult(stops, now);
      const { landedReels, allLanded } = controller.tick(now);
      landedReels.forEach((reel) => landings.push({ reel, at: now }));
      if (allLanded) break;
    }
    return { controller, landings, finishedAt: now };
  }

  it('lands every reel on the server stops', () => {
    const stops = [5, 17, 33, 2, 60];
    const { controller, landings } = spinTo(stops, 120);
    assert.deepEqual(visibleGrid(controller), gridFromStops(stops));
    assert.deepEqual(landings.map((l) => l.reel), [0, 1, 2, 3, 4], 'reels land left to right');
    assert.ok(!controller.isSpinning);
  });

  it('waits for the minimum spin time, and for a slow server', () => {
    const fast = spinTo([1, 1, 1, 1, 1], 50);
    const slow = spinTo([1, 1, 1, 1, 1], 1500);
    // Reference game (frame-by-frame): first reel ≈ 0.5 s, whole spin ≈ 2.3–2.5 s.
    assert.ok(STOP_INTERVAL_MS >= 400 && STOP_INTERVAL_MS <= 500, `reel stop interval is ${STOP_INTERVAL_MS}ms`);
    assert.ok(fast.landings[0].at >= 700 && fast.landings[0].at <= 900, `first reel landed at ${fast.landings[0].at}ms`);
    assert.ok(slow.landings[0].at > 1500);
    assert.ok(fast.finishedAt >= 2300 && fast.finishedAt <= 2600, `normal spin finished at ${fast.finishedAt}ms`);
    const gaps = fast.landings.slice(1).map((l, i) => l.at - fast.landings[i].at);
    // Reels start decelerating exactly STOP_INTERVAL_MS apart; the braking distance
    // varies by up to one symbol, so landings can drift by up to 2/SPIN_SPEED ms.
    gaps.forEach((gap) => assert.ok(Math.abs(gap - STOP_INTERVAL_MS) <= 2 / SPIN_SPEED + 32, `gap ${gap}`));
  });

  it('quick stop lands much sooner and still on the right symbols', () => {
    const stops = [8, 9, 10, 11, 12];
    const controller = new SpinController([0, 0, 0, 0, 0]);
    controller.start(0);
    let now = 0;
    for (; now < 10_000; now += 16) {
      if (now >= 100) controller.setResult(stops, now);
      if (now >= 600) controller.quickStop(now);
      if (controller.tick(now).allLanded) break;
    }
    assert.ok(now < FIRST_STOP_MS + 4 * STOP_INTERVAL_MS, `finished at ${now}`);
    assert.deepEqual(visibleGrid(controller), gridFromStops(stops));
  });

  // Real strip positions whose visible window has exactly one coin, or none.
  const coinsAt = (reel: number, stop: number) => windowAt(reel, stop).filter((id) => id === SCATTER).length;
  const stopWith = (reel: number, coins: number) => REEL_STRIPS[reel].findIndex((_, stop) => coinsAt(reel, stop) === coins);

  it('after two coins, each later reel waits with a long, slow stop ("waiting for the third coin")', () => {
    const stops = [stopWith(0, 1), stopWith(1, 1), stopWith(2, 0), stopWith(3, 0), stopWith(4, 1)];
    const controller = new SpinController([0, 0, 0, 0, 0]);
    controller.start(0);
    const landings: number[] = [];
    const waiting = new Set<number>();
    let now = 0;
    for (; now < 20_000; now += 16) {
      if (now >= 100) controller.setResult(stops, now);
      const { landedReels, allLanded } = controller.tick(now);
      landedReels.forEach(() => landings.push(now));
      if (controller.anticipatingReel !== null) waiting.add(controller.anticipatingReel);
      if (allLanded) break;
    }
    assert.deepEqual([...waiting], [2, 3, 4], 'reels after the second coin anticipate one at a time');
    assert.deepEqual(visibleGrid(controller), gridFromStops(stops), 'still lands on the server stops');
    for (const reel of [2, 3, 4]) {
      const gap = landings[reel] - landings[reel - 1];
      assert.ok(gap >= ANTICIPATION_SPIN_MS + ANTICIPATION_SLOW_MS - 200, `reel ${reel} waited only ${gap}ms`);
    }
    assert.ok(landings[1] - landings[0] < STOP_INTERVAL_MS + 2 / SPIN_SPEED + 32, 'reels before the second coin stop normally');
    assert.equal(controller.anticipatingReel, null);
  });

  it('no anticipation with fewer than two coins, and quick stop never skips it', () => {
    const none = [stopWith(0, 1), stopWith(1, 0), stopWith(2, 0), stopWith(3, 0), stopWith(4, 0)];
    const plain = spinTo(none, 100);
    assert.ok(plain.finishedAt < FIRST_STOP_MS + 4 * STOP_INTERVAL_MS + 800, `finished at ${plain.finishedAt}`);

    const two = [stopWith(0, 1), stopWith(1, 1), stopWith(2, 0), stopWith(3, 0), stopWith(4, 0)];
    const controller = new SpinController([0, 0, 0, 0, 0]);
    controller.start(0);
    let now = 0;
    for (; now < 20_000; now += 16) {
      if (now >= 100) controller.setResult(two, now);
      if (now >= 600) controller.quickStop(now);
      if (controller.tick(now).allLanded) break;
    }
    assert.ok(now > 3 * (ANTICIPATION_SPIN_MS + ANTICIPATION_SLOW_MS) - 600, `quick stop skipped anticipation (finished at ${now})`);
    assert.deepEqual(visibleGrid(controller), gridFromStops(two));
  });

  it('a failed request (null result) still brings every reel to rest', () => {
    const controller = new SpinController([0, 0, 0, 0, 0]);
    controller.start(0);
    let now = 0;
    for (; now < 10_000; now += 16) {
      controller.setResult(null, now);
      if (controller.tick(now).allLanded) break;
    }
    assert.ok(!controller.isSpinning);
    controller.motions.forEach((motion) => assert.ok(Number.isInteger(motion.position)));
  });
});

describe('AutoSpinController', () => {
  it('counts down every reserved spin and MAX always means the highest offered bet', () => {
    const auto = new AutoSpinController();
    auto.start(3);
    assert.equal(highestAllowedBet([40, 80, 200, 400]), 400, 'MAX selects the highest allowed bet');
    assert.deepEqual([auto.takeSpin(), auto.remaining, auto.takeSpin(), auto.remaining, auto.takeSpin(), auto.remaining], [true, 2, true, 1, true, 0]);
    assert.equal(auto.takeSpin(), false);
  });

  for (const reason of ['insufficient-funds', 'free-spins', 'request-error', 'player-stopped'] as const satisfies readonly AutoStopReason[]) {
    it(`stops immediately for ${reason}`, () => {
      const auto = new AutoSpinController();
      auto.start(50);
      auto.stop(reason);
      assert.equal(auto.active, false);
      assert.equal(auto.takeSpin(), false);
    });
  }

  it('recognises a 0.6 second SPIN hold as automatic play', () => {
    assert.equal(isAutoSpinLongPress(LONG_PRESS_MS - 1), false);
    assert.equal(isAutoSpinLongPress(LONG_PRESS_MS), true);
  });

  it('keeps winning paid auto spins visible for at least two seconds, while misses keep the short gap', () => {
    assert.ok(AUTO_SPIN_DELAY_MS.win >= 2000);
    assert.equal(AUTO_SPIN_DELAY_MS.noWin, 280);
    assert.ok(AUTO_SPIN_DELAY_MS.noWin < AUTO_SPIN_DELAY_MS.win);
  });

  it('keeps wager controls locked between automatic spins', () => {
    const auto = new AutoSpinController();
    auto.start(50);
    assert.equal(auto.takeSpin(), true);
    assert.equal(isBetChangeLocked(false, false, auto.active), true, 'the post-settlement gap remains locked');
    auto.stop('player-stopped');
    assert.equal(isBetChangeLocked(false, false, auto.active), false);
  });
});
