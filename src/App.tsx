import { useEffect, useRef, useState } from 'react';
import { ALLOWED_BETS, type SymbolId, type Win } from './engine/index.ts';
import { ReelBoard } from './ReelBoard.tsx';
import { useReels } from './useReels.ts';
import { ControlBar } from './ui/ControlBar.tsx';
import { RulesModal, SettingsModal } from './ui/Modals.tsx';
import { TopBar } from './ui/TopBar.tsx';

type Config = { title: string; startingCredits: number; allowedBets: number[]; theoreticalRtp: number; maxWinMultiplier: number; mode: string; updatedAt: string | null };
type FreeSpins = { bet: number; remaining: number; played: number; totalWin: number };
type SpinResult = {
  mode: 'paid' | 'free';
  bet: number;
  stops: number[];
  grid: SymbolId[][];
  wins: Win[];
  winningCells: string[];
  payout: number;
  capped: boolean;
  credits: number;
  freeSpinsAwarded: number;
  freeSpins: FreeSpins | null;
  freeSpinsFinished: { played: number; totalWin: number } | null;
};
type Overlay = { kind: 'awarded'; count: number; retrigger: boolean } | { kind: 'finished'; played: number; totalWin: number };

/** Pause between free spins: longer after a win so it can be seen. */
const FREE_SPIN_DELAY_MS = { win: 1600, noWin: 700 };
const OVERLAY_MS = { awarded: 2600, finished: 3600 };

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
  const [freeSpins, setFreeSpins] = useState<FreeSpins | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const displayWin = useCountUp(win.amount, win.bet);
  const inFreeSpins = freeSpins !== null;

  const loadSession = async () => {
    const session = await fetchJson<{ credits: number; freeSpins: FreeSpins | null }>(`/api/session?sessionId=${encodeURIComponent(sessionId)}`);
    setCredits(session.credits);
    setFreeSpins(session.freeSpins ?? null);
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
    if (!config || modal || overlay) return;
    // Free spins use the bet they were won with and cost nothing.
    const spinBet = freeSpins ? freeSpins.bet : bet;
    if (!freeSpins && credits < bet) { setError('演示积分不足。'); return; }

    setError('');
    setWin({ amount: 0, bet: spinBet, cells: [] });
    setSpinning(true);
    if (!freeSpins) setCredits((value) => value - bet);
    setMessage(freeSpins ? '免费游戏中…' : '旋转中…');

    // The reels start now; the result lands whenever the server answers.
    let result: SpinResult | null = null;
    reels.start(() => {
      setSpinning(false);
      if (!result) { loadSession().catch(() => {}); setMessage('本次请求失败，余额已重新读取'); return; }
      setCredits(result.credits);
      setWin({ amount: result.payout, bet: result.bet, cells: result.winningCells });
      setFreeSpins(result.freeSpins ?? null);
      setMessage(result.payout > 0 ? '' : result.mode === 'free' ? '本局未中奖' : '本局未中奖，再来一次');
      if (result.capped) setError('本局赢分已达单次最大赢分上限。');
      if (result.freeSpinsAwarded > 0) setOverlay({ kind: 'awarded', count: result.freeSpinsAwarded, retrigger: result.mode === 'free' });
      else if (result.freeSpinsFinished) setOverlay({ kind: 'finished', ...result.freeSpinsFinished });
    });
    fetchJson<SpinResult>('/api/spin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bet, sessionId }) })
      .then((body) => { result = body; reels.setResult(body.stops); })
      .catch((e: Error) => { setError(e.message); reels.setResult(null); });
  };

  // Free spins play themselves: spin again shortly after each one lands.
  useEffect(() => {
    if (spinning || overlay || modal || !freeSpins || freeSpins.remaining <= 0) return;
    const timer = setTimeout(() => spinRef.current(), win.amount > 0 ? FREE_SPIN_DELAY_MS.win : FREE_SPIN_DELAY_MS.noWin);
    return () => clearTimeout(timer);
  }, [spinning, overlay, modal, freeSpins, win.amount]);

  // Announcements close by themselves (or on click).
  useEffect(() => {
    if (!overlay) return;
    const timer = setTimeout(() => setOverlay(null), OVERLAY_MS[overlay.kind]);
    return () => clearTimeout(timer);
  }, [overlay]);

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
  // During free spins the button only works as "stop".
  const spinDisabled = !config || (!spinning && (inFreeSpins || overlay !== null || credits < bet));
  const shownBet = freeSpins ? freeSpins.bet : bet;
  const freeMessage = freeSpins ? `免费游戏 · 剩余 ${freeSpins.remaining} 局 · 累计赢分 ${freeSpins.totalWin.toLocaleString('zh-CN')}` : '';

  return <main className="game-shell">
    <section className={`stage ${showWin ? 'has-win' : ''} ${inFreeSpins ? 'is-free' : ''}`} aria-label="Wild Frontier 1024 Ways">
      <TopBar credits={credits} bet={shownBet} win={showWin ? win.amount : 0} disabled={spinning || inFreeSpins} onRules={() => setModal('rules')} onSettings={() => setModal('settings')} />
      <div className="reel-frame" aria-hidden="true" />
      <div className="pillar left" aria-hidden="true"><span>1024 WAYS</span></div>
      <div className="pillar right" aria-hidden="true"><span>1024 WAYS</span></div>
      <ReelBoard reels={reels} winningCells={showWin ? win.cells : []} />
      {bigWin && <div className="big-win" aria-hidden="true"><img src="/reels/coin.png" alt="" /><strong>{displayWin.toLocaleString('zh-CN')}</strong><span>大奖</span></div>}
      {freeSpins && <div className="free-banner" aria-live="polite">{freeMessage}</div>}
      {overlay && (
        <button type="button" className={`feature-overlay is-${overlay.kind}`} onClick={() => setOverlay(null)}>
          <img src="/reels/coin.png" alt="" />
          {overlay.kind === 'awarded'
            ? <><strong>{overlay.retrigger ? '再获得' : '恭喜获得'}</strong><span><b>{overlay.count}</b> 次免费游戏</span></>
            : <><strong>免费游戏结束</strong><span>共 {overlay.played} 局 · 总赢分 <b>{overlay.totalWin.toLocaleString('zh-CN')}</b></span></>}
        </button>
      )}
      {error && <button type="button" className="toast" onClick={() => setError('')}>{error}</button>}
      <ControlBar bet={shownBet} bets={config?.allowedBets ?? ALLOWED_BETS} onBetChange={setBet} betLocked={spinning || inFreeSpins} winDisplay={showWin ? displayWin : null} message={freeSpins && !showWin ? freeMessage : message} spinning={spinning} freeSpins={inFreeSpins} winning={showWin} spinDisabled={spinDisabled} onSpin={spin} />
    </section>
    <p className="rotate-hint">横屏体验更好</p>
    {modal === 'rules' && <RulesModal bet={bet} onClose={() => setModal(null)} />}
    {modal === 'settings' && config && <SettingsModal rtp={config.theoreticalRtp} maxWinMultiplier={config.maxWinMultiplier} onSave={saveSettings} onClose={() => setModal(null)} />}
  </main>;
}
