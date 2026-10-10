import { useEffect, useRef, useState } from 'react';
import { symbolSrc } from '../useReels.ts';

type Tier = { min: number; title: string; label: string; key: 'big' | 'mega' | 'super'; countMs: number; coinsPerSecond: number };

/** Win tiers by multiple of the bet, lowest first. */
export const BIG_WIN_TIERS: readonly Tier[] = [
  { min: 10, title: 'BIG WIN', label: '大奖', key: 'big', countMs: 3500, coinsPerSecond: 35 },
  { min: 25, title: 'MEGA WIN', label: '巨奖', key: 'mega', countMs: 5000, coinsPerSecond: 70 },
  { min: 50, title: 'SUPER WIN', label: '超级大奖', key: 'super', countMs: 6500, coinsPerSecond: 120 },
];

export function bigWinTier(amount: number, bet: number): Tier | null {
  return [...BIG_WIN_TIERS].reverse().find((tier) => amount >= tier.min * bet) ?? null;
}

/** How long the final number stays up before the celebration closes itself. */
const HOLD_MS = 2200;

type Props = { amount: number; bet: number; onDone: () => void };

/**
 * Full-screen celebration. The number counts up from zero and the title
 * climbs through the tiers as it passes each threshold. Click once to jump
 * to the final amount, again to close.
 */
export function BigWin({ amount, bet, onDone }: Props) {
  const finalTier = bigWinTier(amount, bet) ?? BIG_WIN_TIERS[0];
  const [value, setValue] = useState(0);
  const [counting, setCounting] = useState(true);
  const skip = useRef(false);

  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      // In a hidden tab there is nothing to watch: go straight to the total.
      const u = skip.current || document.hidden ? 1 : Math.min((now - start) / finalTier.countMs, 1);
      // Mostly linear so the title visibly climbs; eases only at the very end.
      setValue(Math.round(amount * (u < 0.85 ? u * 0.94 / 0.85 : 0.94 + 0.06 * (1 - (1 - (u - 0.85) / 0.15) ** 2))));
      if (u < 1) frame = requestAnimationFrame(step);
      else setCounting(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [amount, finalTier.countMs]);

  useEffect(() => {
    if (counting) return;
    const timer = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(timer);
  }, [counting, onDone]);

  const tier = bigWinTier(value, bet) ?? BIG_WIN_TIERS[0];
  const click = () => { if (counting) skip.current = true; else onDone(); };

  return (
    <button type="button" className={`big-win-overlay tier-${tier.key}`} onClick={click} aria-label={`${tier.label} ${amount}`}>
      <div className="big-win-rays" aria-hidden="true" />
      <CoinShower coinsPerSecond={counting ? tier.coinsPerSecond : tier.coinsPerSecond / 4} />
      <div className="big-win-content">
        <div className="big-win-title" key={tier.key}>
          <strong>{tier.title}</strong>
          <span>{tier.label}</span>
        </div>
        <div className={`big-win-amount ${counting ? '' : 'is-final'}`}>{value.toLocaleString('zh-CN')}</div>
        <div className="big-win-hint">{counting ? '点击跳过' : '点击继续'}</div>
      </div>
    </button>
  );
}

type Coin = { x: number; y: number; vx: number; vy: number; size: number; phase: number; spin: number };

/** Canvas fountain of spinning coins. */
function CoinShower({ coinsPerSecond }: { coinsPerSecond: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rate = useRef(coinsPerSecond);
  rate.current = coinsPerSecond;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = new Image();
    image.src = symbolSrc('coin');
    const coins: Coin[] = [];
    let last = performance.now();
    let owed = 0;
    let frame = requestAnimationFrame(function step(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      owed += rate.current * dt;
      while (owed >= 1 && coins.length < 320) {
        owed -= 1;
        coins.push({
          x: w * (0.5 + (Math.random() - 0.5) * 0.3),
          y: h + 20,
          vx: (Math.random() - 0.5) * w * 0.7,
          vy: -h * (1.1 + Math.random() * 0.6),
          size: w * (0.035 + Math.random() * 0.03),
          phase: Math.random() * Math.PI * 2,
          spin: 6 + Math.random() * 8,
        });
      }
      for (let i = coins.length - 1; i >= 0; i -= 1) {
        const c = coins[i];
        c.vy += h * 1.9 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.phase += c.spin * dt;
        if (c.y > h + 60 && c.vy > 0) { coins.splice(i, 1); continue; }
        if (!image.complete) continue;
        ctx.save();
        ctx.translate(c.x, c.y);
        // Squash horizontally with the spin phase so the coin looks like it flips.
        ctx.scale(Math.max(Math.abs(Math.cos(c.phase)), 0.08), 1);
        ctx.drawImage(image, -c.size / 2, -c.size / 2 * (171 / 202), c.size, c.size * (171 / 202));
        ctx.restore();
      }
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="coin-shower" aria-hidden="true" />;
}
