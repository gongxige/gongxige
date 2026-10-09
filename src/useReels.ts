import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ALL_SYMBOLS, REEL_STRIPS, REELS, ROWS, type SymbolId } from './engine/index.ts';
import { SpinController } from './game/spinController.ts';

export const symbolSrc = (id: SymbolId) => `/reels/${id}.png`;

/** One slot more than the window, so a partly visible symbol is always drawn at the top. */
export const SLOTS_PER_REEL = ROWS + 1;

/**
 * Drives the reels from requestAnimationFrame. Each frame writes transforms
 * and image sources straight to the DOM, so spinning never re-renders React.
 */
export function useReels() {
  const controllerRef = useRef<SpinController | null>(null);
  controllerRef.current ??= new SpinController(REEL_STRIPS.map((strip) => Math.floor(Math.random() * strip.length)));
  const controller = controllerRef.current;
  // React only ever renders these first symbols, so it never fights the
  // animation loop over an <img src>; every later change goes through draw().
  const initialSymbols = useRef(controller.tapes.map((tape) => Array.from({ length: SLOTS_PER_REEL }, (_, k) => tape.symbolAt(k)))).current;

  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const slots = useRef<(HTMLDivElement | null)[][]>(Array.from({ length: REELS }, () => []));
  const frame = useRef(0);
  const onLanded = useRef<() => void>(() => {});

  const draw = useCallback(() => {
    controller.motions.forEach((motion, reel) => {
      const position = motion.position;
      const top = Math.floor(-position);
      columns.current[reel]?.classList.toggle('is-spinning', motion.isFast);
      slots.current[reel].forEach((slot, k) => {
        if (!slot) return;
        const index = top + k;
        slot.style.transform = `translateY(${(index + position) * 100}%)`;
        const symbol = controller.tapes[reel].symbolAt(index);
        if (slot.dataset.symbol !== symbol) {
          slot.dataset.symbol = symbol;
          const img = slot.firstElementChild as HTMLImageElement;
          img.src = symbolSrc(symbol);
          img.alt = symbol;
        }
      });
    });
  }, [controller]);

  const loop = useCallback((now: number) => {
    const { allLanded } = controller.tick(now);
    draw();
    if (allLanded) onLanded.current();
    else frame.current = requestAnimationFrame(loop);
  }, [controller, draw]);

  useLayoutEffect(draw, [draw]);

  useEffect(() => {
    // Preload every symbol so swapping images mid-spin never flashes.
    ALL_SYMBOLS.forEach((id) => { new Image().src = symbolSrc(id); });
    return () => cancelAnimationFrame(frame.current);
  }, []);

  /**
   * Animate the winning symbols and dim the rest. Only valid at rest, when
   * slot k of each reel shows row k. `cells` holds "row-reel" keys; null
   * clears everything.
   */
  const highlight = useCallback((cells: readonly string[] | null) => {
    slots.current.forEach((reelSlots, reel) => reelSlots.forEach((slot, k) => {
      if (!slot) return;
      const winning = cells !== null && k < ROWS && cells.includes(`${k}-${reel}`);
      slot.classList.toggle('is-win', winning);
      slot.classList.toggle('is-dim', cells !== null && !winning);
    }));
  }, []);

  return {
    highlight,
    registerColumn: (reel: number) => (el: HTMLDivElement | null) => { columns.current[reel] = el; },
    registerSlot: (reel: number, k: number) => (el: HTMLDivElement | null) => { slots.current[reel][k] = el; },
    initialSymbols,
    start(landed: () => void) {
      highlight(null);
      onLanded.current = landed;
      controller.start(performance.now());
      frame.current = requestAnimationFrame(loop);
    },
    setResult: (stops: number[] | null) => controller.setResult(stops, performance.now()),
    quickStop: () => controller.quickStop(performance.now()),
  };
}
