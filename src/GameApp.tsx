import { useCallback, useEffect, useRef, useState } from 'react';
import { ALLOWED_BETS, ENGINE_VERSION, type SymbolId, type Win } from './engine/index.ts';
import { ReelBoard } from './ReelBoard.tsx';
import { useReels } from './useReels.ts';
import { useSymbolsReady } from './useSymbolsReady.ts';
import { ControlBar } from './ui/ControlBar.tsx';
import { RulesModal } from './ui/Modals.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { BigWin, bigWinTier } from './ui/BigWin.tsx';
import { useWinCycle } from './useWinCycle.ts';
import { AUTO_SPIN_DELAY_MS, AutoSpinController, highestAllowedBet, isBetChangeLocked, LONG_PRESS_MS, type AutoStopReason } from './game/autoSpin.ts';

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

/** Decorative SVG only: it stays inside the scaled stage and never receives input. */
function SavannaNight() {
  return <svg className="savanna-night" viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">
    <g className="night-stars">
      <circle cx="130" cy="106" r="2" /><circle cx="212" cy="180" r="1.4" /><circle cx="322" cy="82" r="1.7" />
      <circle cx="470" cy="147" r="1.2" /><circle cx="790" cy="94" r="1.6" /><circle cx="958" cy="148" r="1.3" />
      <circle cx="1104" cy="82" r="2" /><circle cx="1180" cy="190" r="1.2" />
    </g>
    <g className="distant-trees">
      <path d="M84 495v-116l-19-43 22 17 7-61 7 61 24-18-21 44v116z" />
      <path d="M103 340c-47 0-62-16-68-39 33-2 44-22 69-11 19-24 54-9 67 12-11 29-33 38-68 38z" />
      <path d="M1138 495V356l-25-52 29 20 9-74 8 74 32-21-28 54v138z" />
      <path d="M1147 300c-58 0-78-20-85-47 38-2 55-29 85-14 23-29 66-11 82 15-13 35-43 46-82 46z" />
      <path d="M1002 510v-98l-18-38 21 15 6-49 6 49 23-15-19 39v97z" />
      <path d="M1010 376c-39 0-55-14-60-33 27-1 38-20 61-10 17-21 48-8 60 11-10 24-31 32-61 32z" />
    </g>
    <path className="grass-back" d="M0 605c48-33 86-33 134 0 40-53 93-54 142 0 36-30 78-31 119 0 47-57 101-55 149 0 53-42 108-42 163 0 41-34 86-34 128 0 43-48 97-47 142 0 48-31 102-31 143 0 39-45 84-45 130 0v115H0z" />
    <path className="grass-front" d="M0 648l23-28 3 31 25-43 2 43 38-30-13 34 47-24-16 36 57-20-24 37 66-14-25 39 74-5-29 38 83 3-25 32 103 9-37 31h715l-36-33 99-7-28-35 89-2-26-39 76 8-21-43 64 16-19-42 51 24-13-38 42 32-4-45 33 42 5-34 25 27V720H0z" />
  </svg>;
}

function ReelFrame() {
  return <div className="reel-frame" aria-hidden="true">
    <svg className="frame-knots" viewBox="0 0 100 100" preserveAspectRatio="none">
      <g className="rope-knot">
        <g transform="translate(4 4)"><circle cx="0" cy="0" r="4" /><path d="M-6-6 6 6M6-6-6 6" /></g>
        <g transform="translate(92 4)"><circle cx="0" cy="0" r="4" /><path d="M-6-6 6 6M6-6-6 6" /></g>
        <g transform="translate(4 92)"><circle cx="0" cy="0" r="4" /><path d="M-6-6 6 6M6-6-6 6" /></g>
        <g transform="translate(92 92)"><circle cx="0" cy="0" r="4" /><path d="M-6-6 6 6M6-6-6 6" /></g>
      </g>
    </svg>
    <span className="frame-marker" />
  </div>;
}

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
  const symbols = useSymbolsReady();
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
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const autoSpin = useRef(new AutoSpinController());
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldSpin = useRef(false);
  const displayWin = useCountUp(win.amount, win.bet);
  const inFreeSpins = freeSpins !== null;

  const stopAuto = (reason: AutoStopReason) => {
    autoSpin.current.stop(reason);
    setAutoRemaining(null);
  };

  const startAuto = (count: number) => {
    autoSpin.current.start(count);
    setAutoRemaining(autoSpin.current.remaining);
  };

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

  const spin = (automatic = false) => {
    if (spinning) { if (!automatic) stopAuto('player-stopped'); reels.quickStop(); return; }
    if (!automatic && autoSpin.current.active) { stopAuto('player-stopped'); setMessage('自动旋转已停止'); return; }
    if (!config || !symbols.ready || modal || overlay || celebrating || staleApi || noSession) return;
    // Free spins use the bet they were won with and cost nothing.
    const spinBet = freeSpins ? freeSpins.bet : bet;
    if (!freeSpins && credits < bet) { stopAuto('insufficient-funds'); setInsufficientFunds(true); return; }

    if (automatic) {
      if (!autoSpin.current.takeSpin()) return;
      setAutoRemaining(autoSpin.current.remaining);
    }

    setError('');
    setWin({ amount: 0, bet: spinBet, wins: [] });
    setSpinning(true);
    if (!freeSpins) setCredits((value) => value - bet);
    setMessage(freeSpins ? '免费游戏中…' : '旋转中…');

    // The reels start now; the result lands whenever the server answers.
    let result: SpinResult | null = null;
    reels.start(() => {
      setSpinning(false);
      if (!result) { stopAuto('request-error'); loadSession().catch(() => {}); setMessage('本次请求失败，余额已重新读取'); return; }
      setCredits(result.credits);
      setRoundId(result.roundId);
      setWin({ amount: result.payout, bet: result.bet, wins: result.wins });
      if (result.mode === 'free' && result.multipliers) reels.showMultipliers(result.multipliers);
      setFreeSpins(result.freeSpins ?? null);
      if (result.freeSpins) stopAuto('free-spins');
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
        stopAuto('request-error');
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

  // Paid auto spins start only after the prior result is settled. This keeps a
  // stale local balance from ever submitting an extra wager.
  useEffect(() => {
    if (!autoSpin.current.active || spinning || overlay || celebrating || modal) return;
    if (freeSpins) { stopAuto('free-spins'); return; }
    if (autoSpin.current.remaining === 0) { stopAuto('player-stopped'); return; }
    if (credits < bet) { stopAuto('insufficient-funds'); setInsufficientFunds(true); return; }
    const timer = setTimeout(() => spinRef.current(true), win.amount > 0 ? AUTO_SPIN_DELAY_MS.win : AUTO_SPIN_DELAY_MS.noWin);
    return () => clearTimeout(timer);
  }, [autoRemaining, spinning, overlay, celebrating, modal, freeSpins, credits, bet, win.amount]);

  // Dev-only preview of the celebration: /?preview-bigwin=30 shows a 30× bet win.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const multiple = Number(new URLSearchParams(location.search).get('preview-bigwin'));
    if (multiple > 0) { setWin({ amount: multiple * ALLOWED_BETS[1], bet: ALLOWED_BETS[1], wins: [] }); setCelebrating(true); }
  }, []);

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

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
  const spinDisabled = !config || !symbols.ready || staleApi || noSession || (!spinning && autoRemaining === null && (inFreeSpins || overlay !== null || celebrating || credits < bet));
  const shownBet = freeSpins ? freeSpins.bet : bet;
  const freeMessage = freeSpins ? `免费游戏 · 剩余 ${freeSpins.remaining} 局 · 累计赢分 ${freeSpins.totalWin.toLocaleString('zh-CN')}` : '';

  return <main className="game-shell">
    <section className={`stage ${showWin ? 'has-win' : ''} ${inFreeSpins ? 'is-free' : ''}`} aria-label="Wild Frontier 1024 Ways">
      <SavannaNight />
      <TopBar credits={credits} bet={shownBet} win={showWin ? win.amount : 0} onRules={() => setModal('rules')} />
      <ReelFrame />
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
      {!symbols.ready && <div className="loading-cover" role="status"><span>游戏加载中… {symbols.loaded} / {symbols.total}</span><i style={{ width: `${(symbols.loaded / symbols.total) * 100}%` }} /></div>}
      {staleApi && <div className="toast is-blocking" role="alert">{STALE_API_MESSAGE}</div>}
      {noSession && !staleApi && <div className="toast is-blocking" role="alert">请从平台大厅进入游戏（会话无效或已过期）。<a href="/">打开平台大厅</a></div>}
      {error && !staleApi && !noSession && <button type="button" className="toast" onClick={() => setError('')}>{error}</button>}
      <ControlBar bet={shownBet} bets={config?.allowedBets ?? ALLOWED_BETS} onBetChange={setBet} betLocked={isBetChangeLocked(spinning, inFreeSpins, autoSpin.current.active)} winDisplay={showWin ? displayWin : null} message={freeSpins && !showWin ? freeMessage : message} spinning={spinning} celebrating={celebrating} freeSpins={inFreeSpins} winning={showWin} spinDisabled={spinDisabled} autoRemaining={autoRemaining} onRules={() => setModal('rules')} onMax={() => setBet(highestAllowedBet(config?.allowedBets ?? ALLOWED_BETS))} onAuto={(count) => { if (count) { if (credits < bet) { setInsufficientFunds(true); return; } startAuto(count); } else stopAuto('player-stopped'); }} onSpinHoldStart={() => { heldSpin.current = false; if (autoSpin.current.active) return; holdTimer.current = setTimeout(() => { if (!spinning && !inFreeSpins && !autoSpin.current.active && credits >= bet) { heldSpin.current = true; startAuto(50); } }, LONG_PRESS_MS); }} onSpinHoldEnd={() => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; }} onSpin={() => { if (celebrating) { endCelebration(); return; } if (!heldSpin.current) spin(); heldSpin.current = false; }} />
      {modal === 'rules' && <RulesModal bet={bet} onClose={() => setModal(null)} />}
      {insufficientFunds && <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-label="余额不足"><section className="modal-card insufficient-card"><h2>提示</h2><p>余额不足，请回大厅充值</p><div className="modal-actions"><button type="button" onClick={() => setInsufficientFunds(false)}>确定</button><a className="primary" href="/">返回大厅</a></div></section></div>}
    </section>
  </main>;
}
