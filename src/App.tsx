import { useEffect, useRef, useState } from 'react';
import { ALLOWED_BETS, ROWS, type SymbolId, type Win } from './engine/index.ts';

type Config = { title: string; startingCredits: number; allowedBets: number[]; theoreticalRtp: number; maxWinMultiplier: number; mode: string; updatedAt: string | null };
type SpinResult = { grid: SymbolId[][]; wins: Win[]; winningCells: string[]; payout: number; capped: boolean; credits: number };

const STOP_TIMES = [800, 1260, 1800, 2260, 2800];
const WIN_START_TIME = 3200;
const initialColumns: SymbolId[][] = [['Q', 'elephant', 'deer', 'lion'], ['Q', 'bull', 'J', 'A'], ['K', '10', '10', '10'], ['10', 'J', 'A', 'coin'], ['lion', 'K', 'lion', '10']];
const symbolSrc = (id: SymbolId) => `/reels/${id}.png`;
const sessionId = 'local-browser-demo-v1';

export default function App() {
  const [tracks, setTracks] = useState<SymbolId[][]>(initialColumns);
  const [offsets, setOffsets] = useState<number[]>([0, 0, 0, 0, 0]);
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false, false, false]);
  const [transitioning, setTransitioning] = useState<boolean[]>([false, false, false, false, false]);
  const [winningCells, setWinningCells] = useState<string[]>([]);
  const [winningCellsCleared, setWinningCellsCleared] = useState(false);
  const [winAmount, setWinAmount] = useState(0);
  const [displayWin, setDisplayWin] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credits, setCredits] = useState(0);
  const [lastResult, setLastResult] = useState('等待旋转');
  const [bet, setBet] = useState<number>(ALLOWED_BETS[1]);
  const [config, setConfig] = useState<Config | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const timers = useRef<number[]>([]);

  const fetchConfig = async () => {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('本机测试服务未启动');
    const next = await response.json() as Config;
    const sessionResponse = await fetch(`/api/session?sessionId=${encodeURIComponent(sessionId)}`);
    if (!sessionResponse.ok) throw new Error('无法读取本机会话余额');
    const session = await sessionResponse.json() as { credits: number };
    setConfig(next); setCredits(session.credits);
    if (!next.allowedBets.includes(bet)) setBet(next.allowedBets[0]);
  };
  useEffect(() => { fetchConfig().catch((e: Error) => setError(e.message)); }, []);

  const spin = async () => {
    if (busy || !config) return;
    setError(''); setLastResult('正在向本机服务请求结果…'); setBusy(true);
    let result: SpinResult;
    try {
      const response = await fetch('/api/spin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bet, sessionId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '旋转失败');
      result = body as SpinResult;
    } catch (e) { setError(e instanceof Error ? e.message : '连接本机服务失败'); setLastResult('本次请求失败'); setBusy(false); return; }
    timers.current.forEach((timer) => window.clearTimeout(timer));
    const nextTracks = tracks.map((current, column) => [...result.grid[column], ...Array.from({ length: 12 }, () => current[Math.floor(Math.random() * ROWS)]), ...current]);
    setTracks(nextTracks); setOffsets(nextTracks.map((track) => -((track.length - ROWS) / track.length) * 100));
    setTransitioning([false, false, false, false, false]); setSpinning([true, true, true, true, true]);
    setWinningCells([]); setWinningCellsCleared(false); setWinAmount(0); setDisplayWin(0);
    requestAnimationFrame(() => { setTransitioning([true, true, true, true, true]); setOffsets([0, 0, 0, 0, 0]); });
    STOP_TIMES.forEach((delay, column) => timers.current.push(window.setTimeout(() => setSpinning((current) => current.map((value, index) => index === column ? false : value)), delay)));
    timers.current.push(window.setTimeout(() => {
      setTracks(result.grid); setOffsets([0, 0, 0, 0, 0]); setTransitioning([false, false, false, false, false]); setSpinning([false, false, false, false, false]);
      setWinningCells(result.winningCells); setWinAmount(result.payout); setCredits(result.credits); setLastResult(`投注 ${bet} · 派彩 ${result.payout} · 余额 ${result.credits}`); setBusy(false);
      if (result.payout > 0) { timers.current.push(window.setTimeout(() => setDisplayWin(Math.round(result.payout / 2)), 120)); timers.current.push(window.setTimeout(() => setWinningCellsCleared(true), 700)); timers.current.push(window.setTimeout(() => setDisplayWin(result.payout), 820)); }
    }, WIN_START_TIME));
  };

  const saveConfig = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!config) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ maxWinMultiplier: Number(form.get('maxWin')) }) });
    const body = await response.json(); if (!response.ok) { setError(body.error || '保存失败'); return; }
    setConfig(body); setAdminOpen(false); setError('本机测试参数已保存。');
  };

  return <main className="game-shell">
    <div className="demo-toolbar"><span>本机测试服 · 虚拟积分 {credits}</span><button type="button" onClick={() => setAdminOpen(true)}>测试管理</button></div>
    <section className={`reference-stage ${winningCells.length ? 'has-win' : ''}`} aria-label="Wild Frontier 1024 Ways">
      <img className="chrome-image" src="/reference-base.png" alt="" aria-hidden="true" />
      <div className="reel-board" aria-label="五列四行滚轮">{tracks.map((track, column) => <div className={`reel-column ${spinning[column] ? 'is-spinning' : ''}`} key={column}><div className="reel-track" style={{ height: `${(track.length / ROWS) * 100}%`, transform: `translateY(${offsets[column]}%)`, transition: transitioning[column] ? `transform ${STOP_TIMES[column]}ms cubic-bezier(.12,.78,.18,1)` : 'none', ['--track-length' as string]: track.length }}>{track.map((id, index) => <div className={`reel-symbol ${track.length === ROWS && winningCells.includes(`${index}-${column}`) ? `is-winning ${winningCellsCleared ? 'is-cleared' : ''}` : ''}`} key={`${column}-${index}-${id}`}><img src={symbolSrc(id)} alt={id} /></div>)}</div></div>)}</div>
      {winAmount > 0 && <img className="coin-effect" src="/reels/coin.png" alt="" aria-hidden="true" />}
      <div className="result-overlay" aria-live="polite">{displayWin > 0 ? displayWin : ''}</div><div className={`spin-result-fx ${winAmount > 0 ? 'is-visible' : ''}`} aria-hidden="true"><span>赢分</span></div>
      <button className="spin-hitbox" type="button" aria-label="旋转" onClick={spin} disabled={busy || !config} />
    </section>
    <div className="demo-controls"><label>投注 <select value={bet} onChange={(e) => setBet(Number(e.target.value))}>{(config?.allowedBets ?? ALLOWED_BETS).map((value) => <option value={value} key={value}>{value}</option>)}</select></label><button type="button" onClick={spin} disabled={busy || !config}>{busy ? '旋转中…' : '旋转'}</button><span>理论 RTP：{config?.theoreticalRtp ?? '--'}%</span></div>
    <p className="spin-summary" aria-live="polite">{lastResult}</p>
    {error && <p className="demo-message">{error}</p>}
    {adminOpen && config && <div className="admin-backdrop"><form className="admin-card" onSubmit={saveConfig}><h2>本机测试管理</h2><p>所有数值仅用于本机虚拟积分演示；没有充值、提现或真实货币。</p><p>理论 RTP：{config.theoreticalRtp}%（由卷轴条带和赔率表计算得出，修改方法见 src/engine）</p><label>单次最大赢分（投注的倍数，50–5000）<input name="maxWin" type="number" min="50" max="5000" step="1" defaultValue={config.maxWinMultiplier} /></label><div><button type="button" onClick={() => setAdminOpen(false)}>取消</button><button type="submit">保存到本机</button></div></form></div>}
  </main>;
}
