import { useEffect, useRef, useState } from 'react';
import { ALLOWED_BETS, type SymbolId, type Win } from './engine/index.ts';
import { ReelBoard } from './ReelBoard.tsx';
import { useReels } from './useReels.ts';

type Config = { title: string; startingCredits: number; allowedBets: number[]; theoreticalRtp: number; maxWinMultiplier: number; mode: string; updatedAt: string | null };
type SpinResult = { stops: number[]; grid: SymbolId[][]; wins: Win[]; winningCells: string[]; payout: number; capped: boolean; credits: number };

const sessionId = 'local-browser-demo-v1';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '本机测试服务未启动');
  return body as T;
}

/** Count the win display up from 0, longer for bigger wins (0.6s–2.4s). */
function useCountUp(target: number, bet: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) { setValue(0); return; }
    const duration = Math.min(2400, 600 + (target / bet) * 120);
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const u = Math.min((now - start) / duration, 1);
      setValue(Math.round(target * (1 - (1 - u) ** 3)));
      if (u < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, bet]);
  return value;
}

export default function App() {
  const reels = useReels();
  const [config, setConfig] = useState<Config | null>(null);
  const [credits, setCredits] = useState(0);
  const [bet, setBet] = useState<number>(ALLOWED_BETS[1]);
  const [spinning, setSpinning] = useState(false);
  const [win, setWin] = useState<{ amount: number; bet: number; cells: string[] }>({ amount: 0, bet: 1, cells: [] });
  const [lastResult, setLastResult] = useState('按"旋转"或空格键开始');
  const [error, setError] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const displayWin = useCountUp(win.amount, win.bet);

  const loadSession = async () => {
    const session = await fetchJson<{ credits: number }>(`/api/session?sessionId=${encodeURIComponent(sessionId)}`);
    setCredits(session.credits);
  };

  useEffect(() => {
    (async () => {
      const next = await fetchJson<Config>('/api/config');
      setConfig(next);
      setBet((current) => (next.allowedBets.includes(current) ? current : next.allowedBets[0]));
      await loadSession();
    })().catch((e: Error) => setError(e.message));
  }, []);

  const spin = () => {
    if (spinning) { reels.quickStop(); return; }
    if (!config || adminOpen) return;
    if (credits < bet) { setError('演示积分不足。'); return; }

    setError('');
    setWin({ amount: 0, bet, cells: [] });
    setSpinning(true);
    setCredits((value) => value - bet);
    setLastResult('旋转中…');

    // The reels start now; the result lands whenever the server answers.
    let result: SpinResult | null = null;
    reels.start(() => {
      setSpinning(false);
      if (!result) { loadSession().catch(() => {}); setLastResult('本次请求失败，余额已重新读取'); return; }
      setCredits(result.credits);
      setWin({ amount: result.payout, bet, cells: result.winningCells });
      setLastResult(`投注 ${bet} · 赢分 ${result.payout}${result.capped ? '（已达上限）' : ''} · 余额 ${result.credits}`);
    });
    fetchJson<SpinResult>('/api/spin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bet, sessionId }) })
      .then((body) => { result = body; reels.setResult(body.stops); })
      .catch((e: Error) => { setError(e.message); reels.setResult(null); });
  };

  // Space bar spins (or stops early), unless the player is typing in a form.
  const spinRef = useRef(spin);
  spinRef.current = spin;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || (event.target as HTMLElement).closest('input, select, textarea, button')) return;
      event.preventDefault();
      spinRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const body = await fetchJson<Config>('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxWinMultiplier: Number(form.get('maxWin')) }) });
      setConfig(body);
      setAdminOpen(false);
      setError('本机测试参数已保存。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const showWin = !spinning && win.amount > 0;
  const spinDisabled = !config || (!spinning && credits < bet);

  return <main className="game-shell">
    <div className="demo-toolbar"><span>本机测试服 · 虚拟积分 {credits}</span><button type="button" onClick={() => setAdminOpen(true)} disabled={spinning}>测试管理</button></div>
    <section className={`reference-stage ${showWin ? 'has-win' : ''}`} aria-label="Wild Frontier 1024 Ways">
      <img className="chrome-image" src="/reference-base.png" alt="" aria-hidden="true" />
      <ReelBoard reels={reels} winningCells={showWin ? win.cells : []} />
      {showWin && <img className="coin-effect" src="/reels/coin.png" alt="" aria-hidden="true" />}
      <div className="result-overlay" aria-live="polite">{showWin ? displayWin : ''}</div>
      <div className={`spin-result-fx ${showWin ? 'is-visible' : ''}`} aria-hidden="true"><span>赢分</span></div>
      <button className="spin-hitbox" type="button" aria-label={spinning ? '停止' : '旋转'} onClick={spin} disabled={spinDisabled} />
    </section>
    <div className="demo-controls">
      <label>投注 <select value={bet} onChange={(e) => setBet(Number(e.target.value))} disabled={spinning}>{(config?.allowedBets ?? ALLOWED_BETS).map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
      <button type="button" onClick={spin} disabled={spinDisabled}>{spinning ? '停止' : '旋转'}</button>
      <span>理论 RTP：{config?.theoreticalRtp ?? '--'}%</span>
    </div>
    <p className="spin-summary" aria-live="polite">{lastResult}</p>
    {error && <p className="demo-message">{error}</p>}
    {adminOpen && config && <div className="admin-backdrop"><form className="admin-card" onSubmit={saveConfig}><h2>本机测试管理</h2><p>所有数值仅用于本机虚拟积分演示；没有充值、提现或真实货币。</p><p>理论 RTP：{config.theoreticalRtp}%（由卷轴条带和赔率表计算得出，修改方法见 src/engine）</p><label>单次最大赢分（投注的倍数，50–5000）<input name="maxWin" type="number" min="50" max="5000" step="1" defaultValue={config.maxWinMultiplier} /></label><div><button type="button" onClick={() => setAdminOpen(false)}>取消</button><button type="submit">保存到本机</button></div></form></div>}
  </main>;
}
