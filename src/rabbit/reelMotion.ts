// 阶段 15 / STEP-52：卷轴运动，参数按参考视频逐帧测量（docs/JADE_RABBIT_MOTION.md 第一节）。
// 只做数学，不碰 DOM：给定时间算出卷轴位置，方便单独测试。
//
// 位置 p 的单位是「格」，表示视口顶端对着滚动带的第几格。p 变小 = 符号往下走。
// 开始时 p = origin（视口正好显示转动前的盘面，通常是上一局的停点）；停下时 p 是一个整数 stopK，视口正好显示服务器结果。

export const REEL_MOTION = {
  /** 起转先向上抬的距离（格）和用时（秒）。 */
  liftCells: 0.15,
  liftSeconds: 0.07,
  /** 从 0 加到全速的用时（秒）。 */
  accelSeconds: 0.1,
  /** 全速：每秒滚过的格数。 */
  cellsPerSecond: 17,
  /** 减速段：终速是全速的多少，名义用时（秒）。 */
  decelEndRatio: 0.45,
  decelSeconds: 0.4,
  /** 减速结束时多走的距离（格），再用多少秒退回停点。 */
  overshootCells: 0.08,
  bounceSeconds: 0.13,
} as const;

/** 极速和「立即停止」用的减速：更短。 */
const QUICK_DECEL_SECONDS = 0.22;

export type ReelPhase = 'idle' | 'wait' | 'lift' | 'accel' | 'run' | 'decel' | 'bounce' | 'done';

type Decel = { t0: number; p0: number; v0: number; v1: number; duration: number; stopK: number };

export class ReelMotion {
  private startAt = 0;
  private origin = 0;
  private runFrom: { t: number; p: number } | null = null;
  private decel: Decel | null = null;
  private stopRequest: { quick: boolean } | null = null;
  private stopK: number | null = null;
  private active = false;

  private readonly rows: number;

  constructor(rows: number) { this.rows = rows; }

  /** 从 now 起 delay 秒后开始转，起点是 origin 格。 */
  start(now: number, delay = 0, origin = 0) {
    this.startAt = now + delay;
    this.origin = origin;
    this.runFrom = null;
    this.decel = null;
    this.stopRequest = null;
    this.stopK = null;
    this.active = true;
  }

  get isActive() { return this.active; }
  get target() { return this.stopK; }

  /**
   * 请求停下。返回停点 stopK（结果放在滚动带的 stopK ~ stopK+rows-1 格），还在加速时返回 null，
   * 等到全速后的第一次 sample 再定停点。停点一定在视口上方，换上结果时看不到跳图。
   */
  requestStop(now: number, quick = false): number | null {
    if (!this.active) return this.stopK;
    if (!this.stopRequest || (quick && !this.stopRequest.quick)) this.stopRequest = { quick };
    this.sample(now);
    return this.stopK;
  }

  /** 立即结束（减少动态效果、出错时）。 */
  snap() {
    this.active = false;
    this.decel = null;
    this.stopRequest = null;
  }

  private beginDecel(t: number, p: number) {
    const { cellsPerSecond, decelEndRatio, decelSeconds, overshootCells } = REEL_MOTION;
    const quick = this.stopRequest?.quick ?? false;
    const v0 = cellsPerSecond;
    const v1 = v0 * decelEndRatio;
    const nominal = ((v0 + v1) / 2) * (quick ? QUICK_DECEL_SECONDS : decelSeconds);
    // 结果整段都在视口上方：stopK + rows <= p。
    const stopK = Math.min(Math.ceil(p + overshootCells - nominal), Math.floor(p - this.rows));
    const distance = p - (stopK - overshootCells);
    this.stopK = stopK;
    this.decel = { t0: t, p0: p, v0, v1, duration: (2 * distance) / (v0 + v1), stopK };
  }

  /** 时间 now（秒）时的位置和阶段。 */
  sample(now: number): { p: number; phase: ReelPhase } {
    const { liftCells, liftSeconds, accelSeconds, cellsPerSecond, overshootCells, bounceSeconds } = REEL_MOTION;
    const o = this.origin;
    if (!this.active) return { p: this.stopK ?? o, phase: this.stopK === null ? 'idle' : 'done' };
    const t = now - this.startAt;
    if (t < 0) return { p: o, phase: 'wait' };
    if (t < liftSeconds) return { p: o + liftCells * Math.sin((Math.PI / 2) * (t / liftSeconds)), phase: 'lift' };
    if (t < liftSeconds + accelSeconds) {
      const a = t - liftSeconds;
      return { p: o + liftCells - (cellsPerSecond / accelSeconds) * a * a / 2, phase: 'accel' };
    }
    if (!this.runFrom) this.runFrom = { t: this.startAt + liftSeconds + accelSeconds, p: o + liftCells - (cellsPerSecond * accelSeconds) / 2 };
    if (!this.decel) {
      const p = this.runFrom.p - cellsPerSecond * (now - this.runFrom.t);
      if (!this.stopRequest) return { p, phase: 'run' };
      this.beginDecel(now, p);
    }
    const d = this.decel!;
    const td = now - d.t0;
    if (td < d.duration) {
      return { p: d.p0 - (d.v0 * td + ((d.v1 - d.v0) / d.duration) * td * td / 2), phase: 'decel' };
    }
    const tb = td - d.duration;
    if (tb < bounceSeconds) {
      // 多走的一小段用缓动退回停点。
      return { p: d.stopK - overshootCells * (0.5 + 0.5 * Math.cos(Math.PI * (tb / bounceSeconds))), phase: 'bounce' };
    }
    this.active = false;
    return { p: d.stopK, phase: 'done' };
  }
}

/** 三列开始转的时间（秒，从按下旋转算）。 */
export const COLUMN_START_DELAYS = [0, 0.06, 0.15] as const;
/** 三列开始减速的时间（秒，从按下旋转算）；加上减速约 0.4 秒，停在约 0.9、1.15、1.45 秒。 */
export const COLUMN_DECEL_STARTS = [0.5, 0.75, 1.1] as const;
export const COLUMN_DECEL_STARTS_FAST = [0.3, 0.4, 0.5] as const;
/** 相邻两列开始减速至少间隔（秒）：服务器结果晚到时也保持依次停下。 */
export const MIN_COLUMN_GAP = 0.22;
export const MIN_COLUMN_GAP_FAST = 0.1;
