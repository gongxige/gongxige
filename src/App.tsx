import { useEffect, useRef, useState } from 'react';
import { ALLOWED_BETS, type SymbolId, type Win } from './engine/index.ts';
import { ReelBoard } from './ReelBoard.tsx';
import { useReels } from './useReels.ts';
import { ControlBar } from './ui/ControlBar.tsx';
import { RulesModal, SettingsModal } from './ui/Modals.tsx';
import { TopBar } from './ui/TopBar.tsx';

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
  const [message, setMessage] = useState('按"旋转"或空格键开始');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'rules' | 'settings' | null>(null);
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
    if (!config || modal) return;
    if (credits < bet) { setError('演示积分不足。'); return; }

    setError('');
    setWin({ amount: 0, bet, cells: [] });
    setSpinning(true);
    setCredits((value) => value - bet);
    setMessage('旋转中…');

    // The reels start now; the result lands whenever the server answers.
    let result: SpinResult | null = null;
    reels.start(() => {
      setSpinning(false);
      if (!result) { loadSession().catch(() => {}); setMessage('本次请求失败，余额已重新读取'); return; }
      setCredits(result.credits);
      setWin({ amount: result.payout, bet, cells: result.winningCells });
      setMessage(result.payout > 0 ? '' : '本局未中奖，再来一次');
      if (result.capped) setError('本局赢分已达单次最大赢分上限。');
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

  const saveSettings = async (maxWinMultiplier: number) => {
    try {
      const body = await fetchJson<Config>('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxWinMultiplier }) });
      setConfig(body);
      setModal(null);
      setError('本机测试参数已保存。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const showWin = !spinning && win.amount > 0;
  const bigWin = showWin && win.amount >= 10 * win.bet;
  const spinDisabled = !config || (!spinning && credits < bet);

  return <main className="game-shell">
    <section className={`stage ${showWin ? 'has-win' : ''}`} aria-label="Wild Frontier 1024 Ways">
      <TopBar credits={credits} bet={bet} win={showWin ? win.amount : 0} disabled={spinning} onRules={() => setModal('rules')} onSettings={() => setModal('settings')} />
      <div className="reel-frame" aria-hidden="true" />
      <div className="pillar left" aria-hidden="true"><span>1024 WAYS</span></div>
      <div className="pillar right" aria-hidden="true"><span>1024 WAYS</span></div>
      <ReelBoard reels={reels} winningCells={showWin ? win.cells : []} />
      {bigWin && <div className="big-win" aria-hidden="true"><img src="/reels/coin.png" alt="" /><strong>{displayWin.toLocaleString('zh-CN')}</strong><span>大奖</span></div>}
      {error && <button type="button" className="toast" onClick={() => setError('')}>{error}</button>}
      <ControlBar bet={bet} bets={config?.allowedBets ?? ALLOWED_BETS} onBetChange={setBet} winDisplay={showWin ? displayWin : null} message={message} spinning={spinning} winning={showWin} spinDisabled={spinDisabled} onSpin={spin} />
    </section>
    <p className="rotate-hint">横屏体验更好</p>
    {modal === 'rules' && <RulesModal bet={bet} onClose={() => setModal(null)} />}
    {modal === 'settings' && config && <SettingsModal rtp={config.theoreticalRtp} maxWinMultiplier={config.maxWinMultiplier} onSave={saveSettings} onClose={() => setModal(null)} />}
  </main>;
}
