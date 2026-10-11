import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_HEIGHTS, CASCADE_MULTIPLIERS, FREE_CASCADE_MULTIPLIERS, MAHJONG_MATH_CONFIG, MAX_WIN_MULTIPLIER, boardFromStops, type Board, type Stops, type Token } from './engine/index.ts';
import { MahjongTile, SYMBOL_NAMES } from './MahjongTile.tsx';

// Mahjong Cascade game page (/mahjong?token=…). The server decides every
// result; this page only shows the boards it returns. STEP-28: tiles, board,
// balance/bet/win, spin, rules. Cascade animation comes in STEP-29.

type FreeSpins = { bet: number; remaining: number; played: number; totalWin: number } | null;
type Session = { playerName: string; gameId: string; allowedBets?: number[]; credits: number; freeSpins: FreeSpins };
type SpinResult = {
  roundId: string; mode: 'paid' | 'free'; bet: number; payout: number; credits: number | null;
  initialBoard: Board; finalBoard: Board; cascadeSteps: readonly unknown[]; huCount: number;
  freeSpinsAwarded: number; freeSpins: FreeSpins; freeSpinsFinished: { played: number; totalWin: number } | null; capped: boolean;
};

/** Time between one reel stopping and the next. */
export const MJ_STOP_INTERVAL_MS = 220;
/** How long the reels spin before the first one stops (also covers a slow server). */
export const MJ_FIRST_STOP_MS = 600;
/** Pause on the first board before jumping to the final board of a cascade (STEP-29 animates this). */
export const MJ_CASCADE_PAUSE_MS = 700;

const token = new URLSearchParams(location.search).get('token') ?? '';
const fmt = (n: number) => n.toLocaleString('zh-CN');

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '游戏服务器暂时无法连接'), { code: data.code, status: response.status });
  return data as T;
}

/** Any board for the first screen; purely decorative until the first server result arrives. */
function demoBoard(): Board {
  const stops = MAHJONG_MATH_CONFIG.strips.map((strip) => Math.floor(Math.random() * strip.length)) as unknown as Stops;
  return boardFromStops(MAHJONG_MATH_CONFIG.strips, stops);
}
const randomToken = (): Token => { const strip = MAHJONG_MATH_CONFIG.strips[Math.floor(Math.random() * 5)]; return strip[Math.floor(Math.random() * strip.length)]; };

function RulesModal({ bet, onClose }: { bet: number; onClose: () => void }) {
  const rows = Object.entries(MAHJONG_MATH_CONFIG.payTable).map(([symbolId, pays]) => ({ symbolId, pays }));
  const per = (m: unknown, run: 3 | 4 | 5) => { void run; const r = m as { numerator: number; denominator: number } | number | undefined; if (r === undefined) return '—'; const v = typeof r === 'number' ? bet * r : (bet * r.numerator) / r.denominator; return fmt(Math.round(v * 100) / 100); };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="麻将连连胡规则"><section className="modal-card mj-rules">
    <h2>麻将连连胡 · 规则与赔付</h2>
    <p>5 列盘面（4-5-5-5-4 格），2,000 种赢法：从最左列开始，连续 3 列以上出现同一种牌即中奖，每路赔付 × 各列该牌（含百搭）的张数相乘。演示游戏，只用虚拟积分。</p>
    <table><thead><tr><th>牌</th><th>3 列</th><th>4 列</th><th>5 列</th></tr></thead><tbody>
      {rows.map(({ symbolId, pays }) => <tr key={symbolId}><td>{SYMBOL_NAMES[symbolId as keyof typeof SYMBOL_NAMES]}</td><td>{per(pays[3], 3)}</td><td>{per(pays[4], 4)}</td><td>{per(pays[5], 5)}</td></tr>)}
    </tbody></table>
    <p className="mj-rules-note">上表为当前投注 {fmt(bet)} 时每一路的赔付。</p>
    <ul>
      <li><b>消除连锁</b>：中奖的牌消除，上方的牌落下、空位从上方补牌，可以继续中奖。同一次旋转第 1、2、3、4 次及以后的中奖分别 ×{CASCADE_MULTIPLIERS.join('、×')}。</li>
      <li><b>金色牌</b>（只在第 2~4 列）：参与中奖后不消除，变成百搭。百搭可替代除"胡"以外的所有牌。</li>
      <li><b>胡</b>：一次旋转结束时盘面有 3 个以上"胡"，送 10 次免费旋转，每多 1 个再加 2 次；免费旋转中可以追加。免费旋转倍数为 ×{FREE_CASCADE_MULTIPLIERS.join('、×')}。</li>
      <li><b>最高赢分</b>：一次付费旋转连同它触发的免费旋转，总赢分最高 {fmt(MAX_WIN_MULTIPLIER)} 倍投注，达到即结束。</li>
    </ul>
    <button type="button" className="primary" onClick={onClose}>知道了</button>
  </section></div>;
}

export default function MahjongApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [board, setBoard] = useState<Board>(() => demoBoard());
  const [spinningReels, setSpinningReels] = useState<boolean[]>(() => BOARD_HEIGHTS.map(() => false));
  const [credits, setCredits] = useState(0);
  const [bet, setBet] = useState(0);
  const [win, setWin] = useState(0);
  const [message, setMessage] = useState('按"旋转"开始');
  const [freeSpins, setFreeSpins] = useState<FreeSpins>(null);
  const [rules, setRules] = useState(false);
  const busy = useRef(false);
  const [, force] = useState(0);
  const bets = session?.allowedBets ?? [];

  useEffect(() => {
    if (!token) { setError('请从平台大厅进入游戏。'); return; }
    api<Session>(`/api/session?token=${encodeURIComponent(token)}`).then((s) => {
      setSession(s); setCredits(s.credits); setBet(s.freeSpins?.bet ?? s.allowedBets?.[0] ?? 0); setFreeSpins(s.freeSpins);
      if (s.freeSpins) setMessage(`免费旋转 · 剩余 ${s.freeSpins.remaining} 次`);
    }).catch((e: Error) => setError(e.message));
  }, []);

  const spinning = spinningReels.some(Boolean);
  const inFree = Boolean(freeSpins && freeSpins.remaining > 0);
  const canSpin = Boolean(session) && !busy.current && (inFree || credits >= bet);

  async function spin() {
    if (!session || busy.current) return;
    if (!inFree && credits < bet) { setMessage('余额不足，请回大厅充值'); return; }
    busy.current = true; force((n) => n + 1);
    setWin(0); setMessage(inFree ? '免费旋转中…' : '旋转中…');
    if (!inFree) setCredits((c) => c - bet);
    setSpinningReels(BOARD_HEIGHTS.map(() => true));
    const started = performance.now();
    try {
      const result = await api<SpinResult>('/api/spin', { token, bet });
      await new Promise((r) => setTimeout(r, Math.max(0, MJ_FIRST_STOP_MS - (performance.now() - started))));
      setBoard(result.initialBoard);
      for (let reel = 0; reel < BOARD_HEIGHTS.length; reel += 1) {
        setSpinningReels((s) => s.map((v, i) => (i === reel ? false : v)));
        await new Promise((r) => setTimeout(r, MJ_STOP_INTERVAL_MS));
      }
      if (result.cascadeSteps.length > 0) { await new Promise((r) => setTimeout(r, MJ_CASCADE_PAUSE_MS)); setBoard(result.finalBoard); }
      setWin(result.payout);
      if (result.credits !== null) setCredits(result.credits);
      setFreeSpins(result.freeSpins);
      if (result.freeSpinsFinished) setMessage(`免费旋转结束 · 共 ${result.freeSpinsFinished.played} 次 · 赢 ${fmt(result.freeSpinsFinished.totalWin)}`);
      else if (result.freeSpinsAwarded > 0) setMessage(`${result.huCount} 个"胡"！获得 ${result.freeSpinsAwarded} 次免费旋转`);
      else if (result.freeSpins) setMessage(`免费旋转 · 剩余 ${result.freeSpins.remaining} 次`);
      else setMessage(result.payout > 0 ? `${result.cascadeSteps.length} 连消 · 赢 ${fmt(result.payout)}` : '本局未中奖，再来一次');
    } catch (e) {
      setSpinningReels(BOARD_HEIGHTS.map(() => false));
      const err = e as Error & { status?: number };
      if (err.status === 402) setMessage('余额不足，请回大厅充值');
      else setMessage(err.message);
      api<Session>(`/api/session?token=${encodeURIComponent(token)}`).then((s) => setCredits(s.credits)).catch(() => undefined);
    } finally { busy.current = false; force((n) => n + 1); }
  }

  // Space bar spins, like Wild Frontier.
  const spinRef = useRef(spin); spinRef.current = spin;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.code === 'Space' && !event.repeat && !(event.target as HTMLElement).closest('input, button')) { event.preventDefault(); spinRef.current(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filler = useMemo(() => BOARD_HEIGHTS.map((h) => Array.from({ length: h + 3 }, randomToken)), []);
  const betIndex = bets.indexOf(bet);

  return <main className="game-shell">
    <section className={`stage mj-stage ${inFree ? 'is-free' : ''}`} aria-label="麻将连连胡">
      <header className="mj-top">
        <a className="mj-icon" href="/" aria-label="返回大厅">⌂</a>
        <div className="mj-stats">
          <div><span>余额</span><strong className="gold">{fmt(credits)}</strong></div>
          <div><span>投注</span><strong className="red">{fmt(bet)}</strong></div>
          <div><span>赢分</span><strong className="gold">{fmt(win)}</strong></div>
        </div>
        <button type="button" className="mj-icon" onClick={() => setRules(true)} aria-label="规则与赔付">i</button>
        <p className="mj-demo">演示平台 · 仅虚拟积分 · 不涉及真实货币</p>
      </header>
      <div className="mj-title">麻将连连胡</div>
      <div className="mj-board" aria-label="盘面">
        {board.map((column, x) => <div key={x} className={`mj-col rows-${BOARD_HEIGHTS[x]} ${spinningReels[x] ? 'is-spinning' : ''}`}>
          {spinningReels[x]
            ? <div className="mj-strip">{filler[x].map((t, i) => <div className="mj-cell" key={i}><MahjongTile token={t} /></div>)}</div>
            : column.map((t, y) => <div className="mj-cell" key={`${y}-${t.symbolId}-${t.golden ? 'g' : ''}`}><MahjongTile token={t} /></div>)}
        </div>)}
      </div>
      <footer className="mj-bar">
        <button type="button" className="mj-round blue" disabled={spinning || inFree || betIndex <= 0} onClick={() => setBet(bets[betIndex - 1])} aria-label="减少投注">−</button>
        <div className="mj-bet">{fmt(bet)}</div>
        <button type="button" className="mj-round blue" disabled={spinning || inFree || betIndex < 0 || betIndex >= bets.length - 1} onClick={() => setBet(bets[betIndex + 1])} aria-label="增加投注">+</button>
        <div className="mj-message" role="status">{message}</div>
        <button type="button" className={`mj-spin ${inFree ? 'is-free' : ''}`} disabled={!canSpin} onClick={spin}>{spinning ? '…' : inFree ? `免费 ${freeSpins!.remaining}` : '旋转'}</button>
      </footer>
      {error && <div className="toast is-blocking" role="alert">{error} <a href="/">返回大厅</a></div>}
      {rules && <RulesModal bet={bet} onClose={() => setRules(false)} />}
    </section>
  </main>;
}
