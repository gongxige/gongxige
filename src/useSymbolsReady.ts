import { useEffect, useState } from 'react';
import { ALL_SYMBOLS } from './engine/index.ts';
import { symbolSrc } from './useReels.ts';

/**
 * Loads and decodes every symbol image once. The game shows a loading cover
 * and keeps SPIN disabled until all are ready: on a slow connection (e.g. the
 * public tunnel) images arriving one by one otherwise leave blank reel cells.
 * A failed image still counts, so one broken file never blocks the game.
 */
export function useSymbolsReady() {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    let alive = true;
    ALL_SYMBOLS.forEach((id) => {
      const img = new Image();
      img.src = symbolSrc(id);
      img.decode().catch(() => undefined).finally(() => { if (alive) setLoaded((n) => n + 1); });
    });
    return () => { alive = false; };
  }, []);
  return { ready: loaded >= ALL_SYMBOLS.length, loaded, total: ALL_SYMBOLS.length };
}
