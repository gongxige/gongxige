import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ALL_SYMBOLS, REEL_STRIPS, REELS, ROWS, SCATTER, type SymbolId } from './engine/index.ts';
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
  const timer = useRef(0);
  const onLanded = useRef<() => void>(() => {});

  const draw = useCallback(() => {
    // While a reel waits for the third coin it glows, and the coins already landed pulse.
    const waiting = controller.anticipatingReel;
    controller.motions.forEach((motion, reel) => {
      const position = motion.position;
      const top = Math.floor(-position);
      columns.current[reel]?.classList.toggle('is-spinning', motion.isFast);
      columns.current[reel]?.classList.toggle('is-anticipating', reel === waiting);
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
        slot.classList.toggle('is-teaser', waiting !== null && motion.isIdle && symbol === SCATTER);
        slot.classList.toggle('is-hush', waiting !== null && motion.isIdle && symbol !== SCATTER);
      });
    });
  }, [controller]);

  // Browsers stop animation frames in hidden tabs; keep the spin moving with
  // a (throttled) timer there so it still lands instead of freezing mid-air.
  const schedule = () => {
    if (document.hidden) timer.current = window.setTimeout(() => loop(performance.now()), 100);
    else frame.current = requestAnimationFrame(loop);
  };

  const loop = useCallback((now: number) => {
    const { allLanded } = controller.tick(now);
    draw();
    if (allLanded) onLanded.current();
    else schedule();
  }, [controller, draw]);

  useLayoutEffect(draw, [draw]);

  useEffect(() => {
    // Preload every symbol so swapping images mid-spin never flashes.
    ALL_SYMBOLS.forEach((id) => { new Image().src = symbolSrc(id); });
    // Switch between animation frames and the timer when the tab is hidden or shown mid-spin.
    const onVisibility = () => {
      if (!controller.isSpinning) return;
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
      schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); cancelAnimationFrame(frame.current); clearTimeout(timer.current); };
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

  /** Show "×2"/"×3" on wilds (free spins). At rest only, like highlight; null clears. */
  const showMultipliers = useCallback((multipliers: readonly (readonly number[])[] | null) => {
    slots.current.forEach((reelSlots, reel) => reelSlots.forEach((slot, k) => {
      if (!slot) return;
      const m = multipliers && k < ROWS ? multipliers[reel][k] : 1;
      if (m > 1) slot.dataset.multiplier = `×${m}`;
      else delete slot.dataset.multiplier;
    }));
  }, []);

  return {
    highlight,
    showMultipliers,
    registerColumn: (reel: number) => (el: HTMLDivElement | null) => { columns.current[reel] = el; },
    registerSlot: (reel: number, k: number) => (el: HTMLDivElement | null) => { slots.current[reel][k] = el; },
    initialSymbols,
    start(landed: () => void) {
      highlight(null);
      showMultipliers(null);
      onLanded.current = landed;
      controller.start(performance.now());
      schedule();
    },
    setResult: (stops: number[] | null) => controller.setResult(stops, performance.now()),
    quickStop: () => controller.quickStop(performance.now()),
  };
}
