import { useEffect, useMemo, useState } from 'react';
import type { SymbolId, Win } from './engine/index.ts';

const SYMBOL_NAMES: Partial<Record<SymbolId, string>> = { lion: '狮子', elephant: '大象', bull: '水牛', deer: '羚羊', zebra: '斑马', coin: '金币', wild: '百搭' };
export const symbolName = (id: SymbolId) => SYMBOL_NAMES[id] ?? id;

export function describeWin(win: Win): string {
  const amount = win.payout.toLocaleString('zh-CN');
  if (win.kind === 'scatter') return `金币 × ${win.count} = ${amount}`;
  return `${symbolName(win.symbol)} ${win.reelCount} 连 × ${win.ways} 路 = ${amount}`;
}

const cellKeys = (win: Win) => win.cells.map(({ row, reel }) => `${row}-${reel}`);

/** How long all wins show together, then how long each single win shows. */
export const ALL_WINS_MS = 1800;
export const EACH_WIN_MS = 1500;

/**
 * After a spin: show every win at once, then each win on its own with a
 * caption, then all again, and so on. `hold` keeps it on "all" (e.g. while
 * the big-win celebration is up). Returns null when there is nothing to show.
 */
export function useWinCycle(wins: readonly Win[] | null, hold: boolean): { cells: string[]; caption: string } | null {
  const [step, setStep] = useState(-1); // -1 = all wins

  useEffect(() => { setStep(-1); }, [wins]);

  useEffect(() => {
    if (!wins || wins.length < 2 || hold) return;
    const timer = setTimeout(() => setStep((s) => (s + 1 < wins.length ? s + 1 : -1)), step === -1 ? ALL_WINS_MS : EACH_WIN_MS);
    return () => clearTimeout(timer);
  }, [wins, hold, step]);

  return useMemo(() => {
    if (!wins || wins.length === 0) return null;
    const current = hold ? -1 : step;
    if (current >= 0 && current < wins.length) return { cells: cellKeys(wins[current]), caption: describeWin(wins[current]) };
    return {
      cells: [...new Set(wins.flatMap(cellKeys))],
      caption: wins.length === 1 ? describeWin(wins[0]) : `共 ${wins.length} 项中奖`,
    };
  }, [wins, hold, step]);
}
