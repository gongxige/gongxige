import { useCallback, useEffect, useRef, useState } from 'react';
import { ALLOWED_BETS, ENGINE_VERSION, type SymbolId, type Win } from './engine/index.ts';
import { ReelBoard } from './ReelBoard.tsx';
import { useReels } from './useReels.ts';
import { ControlBar } from './ui/ControlBar.tsx';
import { RulesModal } from './ui/Modals.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { BigWin, bigWinTier } from './ui/BigWin.tsx';
import { useWinCycle } from './useWinCycle.ts';

type Config = { engineVersion?: string; protocol?: string; title: string; allowedBets: number[]; theoreticalRtp: number; maxWinMultiplier: number; mode: string; lobbyUrl?: string };
type FreeSpins = { bet: number; remaining: number; played: number; totalWin: number };
type SpinResult = {
  engineVersion?: string;
  roundId: string;
  mode: 'paid' | 'free';
  bet: number;
  stops: number[];
  grid: SymbolId[][];
  multipliers?: number[][];
  wins: Win[];
  winningCells: string[];
  payout: number;
  capped: boolean;
  credits: number;
  /** The operator has not confirmed the win yet; the server keeps retrying. */
  settlementPending?: boolean;
  freeSpinsAwarded: number;
  freeSpins: FreeSpins | null;
  freeSpinsFinished: { played: number; totalWin: number } | null;
};
type Overlay = { kind: 'awarded'; count: number; retrigger: boolean } | { kind: 'finished'; played: number; totalWin: number };

/** Pause between free spins: longer after a win so it can be seen. */
const FREE_SPIN_DELAY_MS = { win: 1600, noWin: 700 };
const OVERLAY_MS = { awarded: 2600, finished: 3600 };

/** Must match SERVER_PROTOCOL in server.mjs. */
const PROTOCOL = 'provider-v1';
// The operator's lobby opens the game with ?token=…; the token identifies the player's session on the game server.
const token = new URLSearchParams(location.search).get('token') ?? '';
const STALE_API_MESSAGE = '游戏服务器还是旧版本，规则和网页不一致。请在运行 npm start 的终端按 Ctrl+C，再重新运行 npm start，然后从平台大厅重新进入。';

class ApiError extends Error {
  code?: string;
  lobbyUrl?: string;
  constructor(message: string, code?: string, lobbyUrl?: string) { super(message); this.code = code; this.lobbyUrl = lobbyUrl; }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || '游戏服务器未启动', body.code, body.lobbyUrl);
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

export default function GameApp() {
  const reels = useReels();
  const [config, setConfig] = useState<Config | null>(null);
  const [credits, setCredits] = useState(0);
  const [bet, setBet] = useState<number>(ALLOWED_BETS[1]);
  const [spinning, setSpinning] = useState(false);
  const [win, setWin] = useState<{ amount: number; bet: number; wins: Win[] }>({ amount: 0, bet: 1, wins: [] });
  // Big-win celebration in progress; free-spin announcements wait for it.
  const [celebrating, setCelebrating] = useState(false);
  const [pendingOverlay, setPendingOverlay] = useState<Overlay | null>(null);
  const [message, setMessage] = useState('按"旋转"或空格键开始');
  const [error, setError] = useState('');
  // The API process was started before the current game rules: refuse to spin.
  const [staleApi, setStaleApi] = useState(false);
  const [modal, setModal] = useState<'rules' | null>(null);
  const [freeSpins, setFreeSpins] = useState<FreeSpins | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // No valid session (opened without ?token= or it expired): the player must come in through the operator's lobby.
  const [noSession, setNoSession] = useState(false);
  const [roundId, setRoundId] = useState('');
  const displayWin = useCountUp(win.amount, win.bet);
  const inFreeSpins = freeSpins !== null;

  const loadSession = async () => {
    const session = await fetchJson<{ credits: number; freeSpins: FreeSpins | null }>(`/api/session?token=${encodeURIComponent(token)}`);
    setCredits(session.credits);
    setFreeSpins(session.freeSpins ?? null);
  };

  useEffect(() => {
    (async () => {
      const next = await fetchJson<Config>('/api/config');
      if (next.engineVersion !== ENGINE_VERSION || next.protocol !== PROTOCOL) setStaleApi(true);
      setConfig(next);
      setBet((current) => (next.allowedBets.includes(current) ? current : next.allowedBets[0]));
      await loadSession();
    })().catch((e: Error) => { if (e instanceof ApiError && e.code === 'SESSION_INVALID') setNoSession(true); else setError(e.message); });
  }, []);

  const spin = () => {
    if (spinning) { reels.quickStop(); return; }
    if (!config || modal || overlay || celebrating || staleApi || noSession) return;
    // Free spins use the bet they were won with and cost nothing.
    const spinBet = freeSpins ? freeSpins.bet : bet;
    if (!freeSpins && credits < bet) { setError('平台余额不足。'); return; }

    setError('');
    setWin({ amount: 0, bet: spinBet, wins: [] });
    setSpinning(true);
    if (!freeSpins) setCredits((value) => value - bet);
    setMessage(freeSpins ? '免费游戏中…' : '旋转中…');

    // The reels start now; the result lands whenever the server answers.
    let result: SpinResult | null = null;
    reels.start(() => {
      setSpinning(false);
      if (!result) { loadSession().catch(() => {}); setMessage('本次请求失败，余额已重新读取'); return; }
      setCredits(result.credits);
      setRoundId(result.roundId);
      setWin({ amount: result.payout, bet: result.bet, wins: result.wins });
      if (result.mode === 'free' && result.multipliers) reels.showMultipliers(result.multipliers);
      setFreeSpins(result.freeSpins ?? null);
      setMessage(result.payout > 0 ? '' : result.mode === 'free' ? '本局未中奖' : '本局未中奖，再来一次');
      if (result.capped) setError('本局赢分已达单次最大赢分上限。');
      if (result.settlementPending) setError('平台派彩稍有延迟，赢分会自动到账。');
      const next: Overlay | null = result.freeSpinsAwarded > 0
        ? { kind: 'awarded', count: result.freeSpinsAwarded, retrigger: result.mode === 'free' }
        : result.freeSpinsFinished ? { kind: 'finished', ...result.freeSpinsFinished } : null;
      // A big win is celebrated first; any free-spin announcement follows it.
      if (bigWinTier(result.payout, result.bet)) { setCelebrating(true); setPendingOverlay(next); } else setOverlay(next);
    });
    fetchJson<SpinResult>('/api/spin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bet, token }) })
      .then((body) => {
        // Never land the reels on a result computed with different rules.
        if (body.engineVersion !== ENGINE_VERSION) { setStaleApi(true); reels.setResult(null); return; }
        result = body;
        reels.setResult(body.stops);
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.code === 'SESSION_INVALID') setNoSession(true); else setError(e.message);
        reels.setResult(null);
      });
  };

  // Free spins play themselves: spin again shortly after each one lands.
  useEffect(() => {
    if (spinning || overlay || celebrating || modal || !freeSpins || freeSpins.remaining <= 0) return;
    const timer = setTimeout(() => spinRef.current(), win.amount > 0 ? FREE_SPIN_DELAY_MS.win : FREE_SPIN_DELAY_MS.noWin);
    return () => clearTimeout(timer);
  }, [spinning, overlay, celebrating, modal, freeSpins, win.amount]);

  // Dev-only preview of the celebration: /?preview-bigwin=30 shows a 30× bet win.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const multiple = Number(new URLSearchParams(location.search).get('preview-bigwin'));
    if (multiple > 0) { setWin({ amount: multiple * ALLOWED_BETS[1], bet: ALLOWED_BETS[1], wins: [] }); setCelebrating(true); }
  }, []);

  const endCelebration = useCallback(() => {
    setCelebrating(false);
    setOverlay(pendingOverlay);
    setPendingOverlay(null);
  }, [pendingOverlay]);

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

  const showWin = !spinning && win.amount > 0;
  // Winning symbols animate: all wins together, then one win at a time.
  const cycle = useWinCycle(showWin ? win.wins : null, celebrating);
  const highlightKey = cycle ? cycle.cells.join(',') : '';
  useEffect(() => { reels.highlight(highlightKey ? highlightKey.split(',') : null); }, [highlightKey, reels.highlight]);
  // During free spins the button only works as "stop".
  const spinDisabled = !config || staleApi || noSession || (!spinning && (inFreeSpins || overlay !== null || celebrating || credits < bet));
  const shownBet = freeSpins ? freeSpins.bet : bet;
  const freeMessage = freeSpins ? `免费游戏 · 剩余 ${freeSpins.remaining} 局 · 累计赢分 ${freeSpins.totalWin.toLocaleString('zh-CN')}` : '';

  return <main className="game-shell">
    <div className="demo-notice game-demo-notice">演示平台 · 仅虚拟积分 · 不涉及真实货币</div>
    <section className={`stage ${showWin ? 'has-win' : ''} ${inFreeSpins ? 'is-free' : ''}`} aria-label="Wild Frontier 1024 Ways">
      <TopBar credits={credits} bet={shownBet} win={showWin ? win.amount : 0} disabled={spinning || inFreeSpins} onRules={() => setModal('rules')} />
      <div className="reel-frame" aria-hidden="true" />
      <div className="pillar left" aria-hidden="true"><span>1024 WAYS</span></div>
      <div className="pillar right" aria-hidden="true"><span>1024 WAYS</span></div>
      <ReelBoard reels={reels} winningCells={cycle ? cycle.cells : []} />
      {cycle && !celebrating && <div className="win-caption" key={cycle.caption}>{cycle.caption}</div>}
      {celebrating && <BigWin amount={win.amount} bet={win.bet} onDone={endCelebration} />}
      {freeSpins && <div className="free-banner" aria-live="polite">{freeMessage}</div>}
      {overlay && (
        <button type="button" className={`feature-overlay is-${overlay.kind}`} onClick={() => setOverlay(null)}>
          <img src="/reels/coin.png" alt="" />
          {overlay.kind === 'awarded'
            ? <><strong>{overlay.retrigger ? '再获得' : '恭喜获得'}</strong><span><b>{overlay.count}</b> 次免费游戏</span></>
            : <><strong>免费游戏结束</strong><span>共 {overlay.played} 局 · 总赢分 <b>{overlay.totalWin.toLocaleString('zh-CN')}</b></span></>}
        </button>
      )}
      {roundId && <div className="round-id" title="把局号发给平台或客服，可以查到这一局的回放">局号<span>{roundId}</span></div>}
      {staleApi && <div className="toast is-blocking" role="alert">{STALE_API_MESSAGE}</div>}
      {noSession && !staleApi && <div className="toast is-blocking" role="alert">请从平台大厅进入游戏（会话无效或已过期）。<a href={config?.lobbyUrl ?? 'http://127.0.0.1:8788'}>打开平台大厅</a></div>}
      {error && !staleApi && !noSession && <button type="button" className="toast" onClick={() => setError('')}>{error}</button>}
      <ControlBar bet={shownBet} bets={config?.allowedBets ?? ALLOWED_BETS} onBetChange={setBet} betLocked={spinning || inFreeSpins} winDisplay={showWin ? displayWin : null} message={freeSpins && !showWin ? freeMessage : message} spinning={spinning} freeSpins={inFreeSpins} winning={showWin} spinDisabled={spinDisabled} onSpin={spin} />
    </section>
    <p className="rotate-hint">横屏体验更好</p>
    {modal === 'rules' && <RulesModal bet={bet} onClose={() => setModal(null)} />}
  </main>;
}
