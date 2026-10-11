import { BOARD_HEIGHTS, type Board, type CascadeStep, type Coordinate } from './engine/index.ts';

// Turns the server's recorded cascade steps into the frames the page plays,
// one after another. It never evaluates rules itself: every board, highlighted
// cell, multiplier and amount comes straight from the server's steps, which is
// what the unit test checks.

export type FramePhase = 'win' | 'clear' | 'drop' | 'end';
export type Frame = {
  phase: FramePhase;
  board: Board;
  /** "x-y" keys of winning cells (win), cells being removed (clear) or cells that fell / were refilled (drop). */
  cells: readonly string[];
  /** "x-y" keys of golden tiles turning into wilds during this frame. */
  golden: readonly string[];
  /** 0-based position on the multiplier bar (4th and later cascades stay on the last chip). */
  multiplierIndex: number;
  multiplier: number;
  /** Win shown in the counter after this frame. */
  runningWin: number;
  holdMs: number;
};

export const FRAME_MS: Record<FramePhase, number> = { win: 700, clear: 320, drop: 460, end: 0 };
const key = ({ x, y }: Coordinate) => `${x}-${y}`;

/** Cells that moved down or were refilled: in each column, every row from the top down to the lowest removed cell. */
function droppedCells(step: CascadeStep): string[] {
  const lowest = BOARD_HEIGHTS.map(() => -1);
  for (const { x, y } of step.removed) lowest[x] = Math.max(lowest[x], y);
  return lowest.flatMap((bottom, x) => Array.from({ length: bottom + 1 }, (_, y) => `${x}-${y}`));
}

export function cascadeTimeline(initialBoard: Board, finalBoard: Board, steps: readonly CascadeStep[]): Frame[] {
  const frames: Frame[] = [];
  let runningWin = 0;
  steps.forEach((step, i) => {
    const multiplierIndex = Math.min(i, 3);
    const winCells = [...new Set(step.wins.flatMap((win) => win.cells.map(key)))];
    const golden = step.goldenTransforms.map(key);
    const base = { multiplierIndex, multiplier: step.cascadeMultiplier };
    frames.push({ ...base, phase: 'win', board: step.beforeBoard, cells: winCells, golden: [], runningWin, holdMs: FRAME_MS.win });
    runningWin += step.payout;
    if (step.capped) return; // the maximum win ends the round on this board
    frames.push({ ...base, phase: 'clear', board: step.beforeBoard, cells: step.removed.map(key), golden, runningWin, holdMs: FRAME_MS.clear });
    frames.push({ ...base, phase: 'drop', board: step.afterBoard, cells: droppedCells(step), golden: [], runningWin, holdMs: FRAME_MS.drop });
  });
  const last = frames.at(-1);
  frames.push({ phase: 'end', board: steps.length ? finalBoard : initialBoard, cells: [], golden: [], multiplierIndex: last?.multiplierIndex ?? 0, multiplier: last?.multiplier ?? 1, runningWin, holdMs: 0 });
  return frames;
}
