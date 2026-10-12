import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_HEIGHTS,
  BONUS_MULTIPLIERS,
  MAX_WIN_MULTIPLIER,
  PAYLINES,
  PAYTABLE,
  type Board,
  type BonusTier,
  type LineSymbolId,
  type SymbolId,
  type Token,
} from './engine/index.ts';

type FreeSpins = { bet: number; remaining: number; played: number; totalWin: number } | null;
type Session = { playerName: string; gameId: string; allowedBets?: number[]; credits: number; freeSpins: FreeSpins };
type SpinResult = {
  gameId: string;
  engineVersion?: string;
  roundId: string;
  parentRoundId: string | null;
  mode: 'paid' | 'free';
  bet: number;
  grid: Board;
  lineWins?: readonly { lineNumber: number; symbolId: SymbolId; payout: number; coordinates: readonly [{ x: 0 | 1 | 2; y: number }, { x: 0 | 1 | 2; y: number }, { x: 0 | 1 | 2; y: number }] }[];
  bonusWins?: readonly { coordinates: { x: 0 | 1 | 2; y: number }; value: number; tier: BonusTier }[];
  payout: number;
  roundTotalWin: number;
  triggered: boolean;
  capped: boolean;
  credits: number | null;
  settlementPending?: boolean;
  freeSpinsAwarded: number;
  freeSpins: FreeSpins;
  freeSpinsFinished: { played: number; totalWin: number } | null;
};

const token = new URLSearchParams(location.search).get('token') ?? '';
const fmt = (value: number) => value.toLocaleString('zh-CN');
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const EMPTY_TOKEN: Token = { symbolId: 'BLANK', stackGroupId: 'empty' };
const EMPTY_BOARD: Board = [
  [EMPTY_TOKEN, EMPTY_TOKEN, EMPTY_TOKEN],
  [EMPTY_TOKEN, EMPTY_TOKEN, EMPTY_TOKEN, EMPTY_TOKEN],
  [EMPTY_TOKEN, EMPTY_TOKEN, EMPTY_TOKEN],
];
const PAYTABLE_LABELS: Record<string, string> = {
  WILD: '玉云百搭', YUANBAO: '元宝', FU_BAG: '福袋', RED_ENVELOPE: '红包',
  COPPER_COIN: '铜钱', FIRECRACKER: '鞭炮', CARROT: '胡萝卜',
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || '游戏服务器暂时无法连接'), { status: response.status, code: data.code });
  return data as T;
}

function RabbitMascot({ mood }: { mood: 'idle' | 'spin' | 'win' | 'mode' }) {
  return <svg className={`rabbit-mascot rabbit-mascot-${mood}`} viewBox="0 0 140 116" role="img" aria-label="原创云耳玉兔吉祥物">
    <path className="rabbit-ear" d="M48 42C21 27 22 3 38 4c15 1 25 18 24 38z" />
    <path className="rabbit-ear rabbit-ear-back" d="M91 37c22-17 39-8 35 6-4 14-21 21-37 18z" />
    <ellipse className="rabbit-body" cx="70" cy="77" rx="42" ry="31" />
    <circle className="rabbit-head" cx="70" cy="50" r="31" />
    <circle className="rabbit-eye" cx="59" cy="48" r="3.2" /><circle className="rabbit-eye" cx="81" cy="48" r="3.2" />
    <path className="rabbit-smile" d="M63 61q7 7 14 0" />
    <path className="rabbit-cheek" d="M44 58h9M87 58h9" />
    <ellipse className="rabbit-jade" cx="70" cy="78" rx="11" ry="14" />
    <path className="rabbit-jade-mark" d="M66 78q4-7 8 0t-8 0z" />
    <path className="rabbit-tail" d="M111 78q25-17 22 7-3 17-25 10" />
    <path className="rabbit-foot" d="M43 100q-10 12-20 4M96 100q10 12 20 4" />
  </svg>;
}

function RabbitSymbol({ entry, bet }: { entry: Token; bet: number }) {
  const id = entry.symbolId;
  if (id === 'BONUS_PLATE') {
    const tier = entry.bonusTier ?? 0;
    const value = Math.round(BONUS_MULTIPLIERS[tier] * bet);
    return <svg className="rabbit-symbol rabbit-bonus-symbol" viewBox="0 0 120 88" aria-label={`奖金牌匾 ${value}`}>
      <path className="bonus-ribbon" d="M10 18 18 9h84l8 9v52l-8 9H18l-8-9z" />
      <path className="bonus-rim" d="M16 21 22 15h76l6 6v46l-6 6H22l-6-6z" />
      <circle cx="24" cy="26" r="4" /><circle cx="96" cy="26" r="4" /><circle cx="24" cy="62" r="4" /><circle cx="96" cy="62" r="4" />
      <text x="60" y="45" className="bonus-multiplier" textAnchor="middle">×{BONUS_MULTIPLIERS[tier]}</text>
      <text x="60" y="63" className="bonus-value" textAnchor="middle">{fmt(value)}</text>
    </svg>;
  }
  if (id === 'BLANK') return <svg className="rabbit-symbol" viewBox="0 0 120 88" aria-label="空白格"><path className="blank-knot" d="M60 17c-17 0-25 15-9 22-16 7-8 22 9 22s25-15 9-22c16-7 8-22-9-22zM60 61v13M52 70h16" /></svg>;
  return <svg className={`rabbit-symbol symbol-${id.toLowerCase()}`} viewBox="0 0 120 88" aria-label={PAYTABLE_LABELS[id] ?? id}>
    {id === 'WILD' && <><path className="wild-cloud" d="M24 55c-10-15 4-28 18-24 3-19 31-22 39-4 19-6 34 14 22 28-6 7-17 9-28 8H40c-8 0-13-3-16-8z" /><path className="wild-swirl" d="M50 44q21-15 23 4-1 14-19 7" /></>}
    {id === 'YUANBAO' && <><path className="yuanbao" d="M22 38c5-13 18-20 38-20s33 7 38 20l-9 27c-11 10-47 10-58 0z" /><path className="yuanbao-top" d="M30 38q30 12 60 0l-5-11H35z" /><circle cx="50" cy="36" r="3" /><circle cx="70" cy="36" r="3" /></>}
    {id === 'FU_BAG' && <><path className="fu-bag" d="M34 27q26 9 52 0l7 42q-33 14-66 0z" /><path className="fu-tie" d="M42 28q18 10 36 0M48 20q12 13 24 0" /><path className="fu-mark" d="M54 49h12v12H54z" /></>}
    {id === 'RED_ENVELOPE' && <><path className="red-envelope" d="m20 27 40-13 40 13-6 40H26z" /><path className="red-fold" d="m20 27 40 22 40-22" /><circle className="red-jade" cx="60" cy="45" r="10" /><path d="M55 45h10M60 40v10" className="red-jade-mark" /></>}
    {id === 'COPPER_COIN' && <><circle className="copper-coin" cx="60" cy="44" r="31" /><rect className="copper-hole" x="51" y="35" width="18" height="18" rx="2" /><path className="coin-stroke" d="M38 25l8 6M82 25l-8 6M38 63l8-6M82 63l-8-6" /></>}
    {id === 'FIRECRACKER' && <><path className="firecracker" d="M28 29h18v35H28zM51 22h18v42H51zM74 29h18v35H74z" /><path className="fire-line" d="M60 22q-4-12 8-17" /><circle className="spark" cx="70" cy="8" r="3" /><circle className="spark" cx="82" cy="13" r="2" /></>}
    {id === 'CARROT' && <><path className="carrot-leaf" d="M60 35q-3-21-17-24 16-3 22 13 7-17 21-12-16 10-17 25z" /><path className="carrot" d="M60 27q27 3 28 18-1 23-28 35-27-12-28-35 1-15 28-18z" /><path className="carrot-line" d="M47 51q12 6 26 0M51 61q9 4 18 0" /></>}
  </svg>;
}

function RulesModal({ bet, onClose }: { bet: number; onClose: () => void }) {
  return <div className="rabbit-modal-backdrop" role="dialog" aria-modal="true" aria-label="玉兔送财规则与赔付表">
    <section className="rabbit-modal">
      <div className="rabbit-modal-heading"><span>玉兔送财</span><button type="button" onClick={onClose} aria-label="关闭规则">×</button></div>
      <div className="rabbit-rule-tabs"><b>游戏规则</b><b>赔付表</b></div>
      <p>3-4-3 三列盘面，共 10 条固定中奖线；每线从左到右连成三枚相同普通符号（百搭可替代），按最高赔付结算。奖金牌匾不参加线奖。</p>
      <div className="rabbit-paytable">
        {Object.entries(PAYTABLE).map(([id, multiplier]) => <div key={id}><RabbitSymbol entry={{ symbolId: id as LineSymbolId | 'WILD', stackGroupId: `rules-${id}` }} bet={bet} /><span>{PAYTABLE_LABELS[id]}</span><strong>×{multiplier}</strong></div>)}
      </div>
      <ul>
        <li>盘面出现 5 个或以上奖金牌匾时，支付所有牌匾数值之和；档位为 ×0.5、×1、×2、×5、×10、×20、×50、×100、×250、×500。</li>
        <li>奖金牌匾可能随机带来 8 次财富旋转，模式中只会出现牌匾和空白格。</li>
        <li>本轮（含财富旋转）最高赢分为 {fmt(MAX_WIN_MULTIPLIER)} 倍投注；本页面只使用虚拟积分。</li>
      </ul>
      <p className="rabbit-rule-note">当前总投注 {fmt(bet)}；牌匾数值由服务器盘面中的档位决定。</p>
      <button className="rabbit-primary" type="button" onClick={onClose}>知道了</button>
    </section>
  </div>;
}

function RollingColumn({ height, bet, seed }: { height: number; bet: number; seed: readonly Token[] }) {
  const rolling = useMemo(() => Array.from({ length: height + 5 }, (_, index) => seed[index % seed.length] ?? EMPTY_TOKEN), [height, seed]);
  return <div className="rabbit-rolling-track">{rolling.map((entry, index) => <div className="rabbit-cell" key={`${entry.stackGroupId}-${index}`}><RabbitSymbol entry={entry} bet={bet} /></div>)}</div>;
}

export default function JadeRabbitApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [spinningReels, setSpinningReels] = useState<boolean[]>([false, false, false]);
  const [anticipating, setAnticipating] = useState(false);
  const [credits, setCredits] = useState(0);
  const [bet, setBet] = useState(0);
  const [win, setWin] = useState(0);
  const [message, setMessage] = useState('按“旋转”或空格键开始');
  const [error, setError] = useState('');
  const [rules, setRules] = useState(false);
  const [freeSpins, setFreeSpins] = useState<FreeSpins>(null);
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null);
  const [autoCount, setAutoCount] = useState('10');
  const [fast, setFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [tickerIndex, setTickerIndex] = useState(0);
  const busyRef = useRef(false);
  const stopRequested = useRef(false);
  const autoRef = useRef(0);
  const spinRef = useRef<(automatic?: boolean) => void>(() => {});
  const spaceRepeatRef = useRef<number | null>(null);
  const spaceHeldRef = useRef(false);
  const bets = session?.allowedBets ?? [];
  const inMode = Boolean(freeSpins && freeSpins.remaining > 0);
  const spinning = spinningReels.some(Boolean);
  const mood = busy ? 'spin' : inMode ? 'mode' : win > 0 ? 'win' : 'idle';
  const resultLineWins = useRef<SpinResult['lineWins']>([]);
  const activeWinCells = useMemo(() => {
    const line = resultLineWins.current?.find((entry) => entry.lineNumber === activeLine);
    return new Set((line?.coordinates ?? []).map(({ x, y }) => `${x}-${y}`));
  }, [activeLine, board]);
  const canAdjustBet = !busy && !inMode && autoRef.current === 0;

  useEffect(() => {
    if (!token) { setError('请从平台大厅进入玉兔送财。'); return; }
    api<Session>(`/api/session?token=${encodeURIComponent(token)}`).then((next) => {
      setSession(next); setCredits(next.credits); setFreeSpins(next.freeSpins); setBet(next.freeSpins?.bet ?? next.allowedBets?.[0] ?? 0);
      if (next.freeSpins) setMessage(`财富旋转 · 剩余 ${next.freeSpins.remaining} 次`);
    }).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTickerIndex((index) => (index + 1) % 3), 3200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const lineWins = resultLineWins.current ?? [];
    if (busy || lineWins.length === 0) { setActiveLine(null); return; }
    let index = 0;
    setActiveLine(lineWins[0]?.lineNumber ?? null);
    const timer = window.setInterval(() => { index = (index + 1) % lineWins.length; setActiveLine(lineWins[index]?.lineNumber ?? null); }, 1450);
    return () => window.clearInterval(timer);
  }, [busy, win, board]);

  async function animateResult(result: SpinResult, startedAt: number) {
    if (stopRequested.current) return;
    const totalWait = fast ? 420 : 690;
    await wait(Math.max(0, totalWait - (performance.now() - startedAt)));
    if (stopRequested.current) return;
    setBoard(result.grid);
    const earlyBonusCount = result.grid.slice(0, 2).flat().filter((entry) => entry.symbolId === 'BONUS_PLATE').length;
    const expectBonus = (result.bonusWins?.length ?? 0) >= 5 && earlyBonusCount >= 4;
    for (let column = 0; column < BOARD_HEIGHTS.length; column += 1) {
      if (column === 2 && expectBonus) { setAnticipating(true); await wait(fast ? 260 : 620); }
      if (stopRequested.current) return;
      setSpinningReels((current) => current.map((value, index) => index === column ? false : value));
      if (column === 2) setAnticipating(false);
      if (column < 2) await wait(fast ? 130 : 220);
    }
  }

  async function spin(automatic = false) {
    if (busyRef.current) { stopRequested.current = true; setSpinningReels([false, false, false]); setAnticipating(false); setMessage('立即停止，等待服务器结算…'); return; }
    if (!session || rules || error) return;
    if (!automatic && autoRef.current > 0) { autoRef.current = 0; setAutoRemaining(null); setMessage('自动旋转已停止'); return; }
    const isFree = Boolean(freeSpins && freeSpins.remaining > 0);
    if (!isFree && credits < bet) { setMessage('余额不足，请回大厅充值'); return; }
    if (automatic && autoRef.current > 0) { autoRef.current -= 1; setAutoRemaining(autoRef.current); }
    busyRef.current = true; stopRequested.current = false; setBusy(true); setWin(0); setError(''); setActiveLine(null);
    resultLineWins.current = [];
    setMessage(isFree ? `财富旋转 · 剩余 ${freeSpins!.remaining} 次` : '旋转中…');
    if (!isFree) setCredits((value) => value - bet);
    setSpinningReels([true, true, true]);
    const startedAt = performance.now();
    try {
      const result = await api<SpinResult>('/api/spin', { token, bet });
      if (result.gameId !== 'jade-rabbit') throw new Error('服务器返回了不匹配的游戏盘面。');
      await animateResult(result, startedAt);
      setSpinningReels([false, false, false]); setAnticipating(false); setBoard(result.grid);
      if (result.credits !== null) setCredits(result.credits);
      setBet(result.bet); setWin(result.payout); setFreeSpins(result.freeSpins); resultLineWins.current = result.lineWins ?? [];
      if (result.settlementPending) setMessage('平台派彩稍有延迟，赢分会自动到账。');
      else if (result.freeSpinsFinished) setMessage(`财富旋转结束 · 共赢 ${fmt(result.freeSpinsFinished.totalWin)}`);
      else if (result.triggered) setMessage('恭喜触发 8 次财富旋转！');
      else if (result.payout > 0) setMessage(`赢得 ${fmt(result.payout)}`);
      else setMessage(isFree ? '本次财富旋转未凑够 5 个牌匾' : '本局未中奖，再来一次');
      if (result.capped) { setMessage('本轮已达到 5000 倍封顶。'); autoRef.current = 0; setAutoRemaining(null); }
    } catch (e) {
      setSpinningReels([false, false, false]); setAnticipating(false);
      const err = e as Error & { status?: number };
      setMessage(err.status === 402 ? '余额不足，请回大厅充值' : err.message);
      api<Session>(`/api/session?token=${encodeURIComponent(token)}`).then((next) => setCredits(next.credits)).catch(() => undefined);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  spinRef.current = (automatic = false) => { void spin(automatic); };

  useEffect(() => {
    if (busy || rules || error || !session || !freeSpins?.remaining) return;
    const timer = window.setTimeout(() => { void spinRef.current(); }, win > 0 ? 1450 : 720);
    return () => window.clearTimeout(timer);
  }, [busy, rules, error, session, freeSpins, win, board]);

  useEffect(() => {
    if (busy || rules || error || !session || inMode || autoRef.current <= 0 || autoRemaining === 0) return;
    if (credits < bet) { autoRef.current = 0; setAutoRemaining(null); setMessage('余额不足，自动旋转已停止'); return; }
    const timer = window.setTimeout(() => { void spinRef.current(true); }, win > 0 ? 1000 : 420);
    return () => window.clearTimeout(timer);
  }, [busy, rules, error, session, inMode, autoRemaining, credits, bet, win, board]);

  useEffect(() => {
    const clearSpaceRepeat = () => {
      spaceHeldRef.current = false;
      if (spaceRepeatRef.current !== null) {
        window.clearInterval(spaceRepeatRef.current);
        spaceRepeatRef.current = null;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || (event.target as HTMLElement).closest('input, select, textarea, button')) return;
      event.preventDefault();
      if (spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      spinRef.current();
      spaceRepeatRef.current = window.setInterval(() => {
        if (!busyRef.current && spaceHeldRef.current) spinRef.current();
      }, 760);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') clearSpaceRepeat();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpaceRepeat);
    return () => {
      clearSpaceRepeat();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpaceRepeat);
    };
  }, []);

  const linePath = activeLine ? PAYLINES[activeLine - 1].map(({ x, y }) => `${((x + 0.5) / 3) * 300},${((y + 0.5) / 4) * 100}`).join(' ') : '';
  const infoItems = ['5 个奖金牌匾即可赢奖！', '随机触发 8 次财富旋转！', '赢取高达 5000 倍大奖！'];
  const betIndex = bets.indexOf(bet);
  const rollingSeeds = board.map((column) => column.length ? column : [EMPTY_TOKEN]) as unknown as Board;

  return <main className="rabbit-shell">
    <section className={`rabbit-stage ${inMode ? 'is-mode' : ''} ${spinning ? 'is-spinning' : ''}`} aria-label="玉兔送财游戏画面">
      <div className="rabbit-sky"><span /><span /><span /><span /></div>
      <header className="rabbit-header">
        <a className="rabbit-home" href="/" aria-label="返回大厅">⌂</a>
        <div className="rabbit-title"><b>玉兔送财</b><small>JADE RABBIT · 虚拟积分演示</small></div>
        <button className="rabbit-info-button" type="button" onClick={() => setRules(true)} aria-label="打开规则与赔付表">?</button>
      </header>
      <div className="rabbit-roof" aria-hidden="true">
        <div className="roof-tile roof-tile-left" /><div className="roof-tile roof-tile-center" /><div className="roof-tile roof-tile-right" />
        <div className="roof-crest">福</div><RabbitMascot mood={mood} />
      </div>
      <aside className="rabbit-couplet rabbit-couplet-left" aria-label="左侧对联">恭<br />喜</aside>
      <aside className="rabbit-couplet rabbit-couplet-right" aria-label="右侧对联">发<br />财</aside>
      <div className="rabbit-machine">
        <div className="rabbit-line-rail left">{Array.from({ length: 10 }, (_, index) => <span key={index} className={activeLine === index + 1 ? 'is-active' : ''}>{index + 1}</span>)}</div>
        <div className="rabbit-reels" aria-label="3-4-3 服务器盘面">
          {board.map((column, x) => <div className={`rabbit-reel-column rows-${BOARD_HEIGHTS[x]} ${spinningReels[x] ? 'is-spinning' : ''} ${x === 2 && anticipating ? 'is-anticipating' : ''}`} key={x}>
            {spinningReels[x] ? <RollingColumn height={BOARD_HEIGHTS[x]} bet={bet} seed={rollingSeeds[x]} /> : column.map((entry, y) => <div className={`rabbit-cell ${activeWinCells.has(`${x}-${y}`) ? 'is-winning' : activeLine !== null ? 'is-dim' : ''} ${entry.symbolId === 'BONUS_PLATE' ? 'is-bonus' : ''}`} key={`${entry.stackGroupId}-${y}`}><RabbitSymbol entry={entry} bet={bet} /></div>)}
          </div>)}
          <svg className="rabbit-line-layer" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">{linePath && <polyline points={linePath} />}</svg>
        </div>
        <div className="rabbit-line-rail right">{Array.from({ length: 10 }, (_, index) => <span key={index} className={activeLine === index + 1 ? 'is-active' : ''}>{index + 1}</span>)}</div>
      </div>
      <div className="rabbit-info-strip" role="status"><span className="info-seal">玉</span><span>{win > 0 && !busy ? `赢得 ${fmt(win)}` : infoItems[tickerIndex]}</span><span className="info-seal">兔</span></div>
      {inMode && <div className="rabbit-mode-badge">财富旋转 · 剩余 {freeSpins!.remaining} 次</div>}
      {error && <div className="rabbit-error" role="alert">{error} <a href="/">返回大厅</a></div>}
      <section className="rabbit-bottom" aria-label="游戏控制区">
        <div className="rabbit-stats"><div><span>余额</span><strong>{fmt(credits)}</strong></div><div><span>投注</span><strong className="bet-number">{fmt(bet)}</strong></div><div><span>赢分</span><strong>{fmt(win)}</strong></div></div>
        <div className="rabbit-controls">
          <div className="rabbit-bet-controls"><button type="button" onClick={() => betIndex > 0 && setBet(bets[betIndex - 1])} disabled={!canAdjustBet || betIndex <= 0} aria-label="减少投注">−</button><span>{fmt(bet)}</span><button type="button" onClick={() => betIndex >= 0 && betIndex < bets.length - 1 && setBet(bets[betIndex + 1])} disabled={!canAdjustBet || betIndex < 0 || betIndex >= bets.length - 1} aria-label="增加投注">+</button></div>
          <button className="rabbit-max" type="button" disabled={!canAdjustBet || bets.length === 0} onClick={() => setBet(bets[bets.length - 1])}>最大投注</button>
          <label className="rabbit-auto"><span>自动</span><select value={autoCount} onChange={(event) => setAutoCount(event.target.value)} disabled={busy || inMode}><option value="5">5 次</option><option value="10">10 次</option><option value="25">25 次</option><option value="50">50 次</option></select></label>
          <button className={`rabbit-fast ${fast ? 'is-on' : ''}`} type="button" onClick={() => setFast((value) => !value)} aria-pressed={fast}>极速</button>
          <button className={`rabbit-spin ${inMode ? 'is-mode' : ''}`} type="button" onClick={() => { void spin(); }} disabled={!session || (!inMode && credits < bet && !busy) || Boolean(error)}>{busy ? '立即停止' : inMode ? `财富 ${freeSpins!.remaining}` : '旋转'}</button>
          {!busy && !inMode && autoRef.current === 0 && <button className="rabbit-auto-start" type="button" onClick={() => { const count = Number(autoCount); if (credits < bet) { setMessage('余额不足，无法自动旋转'); return; } autoRef.current = count; setAutoRemaining(count); setMessage(`自动旋转 ${count} 次`); }}>自动旋转</button>}
          {autoRef.current > 0 && <button className="rabbit-auto-stop" type="button" onClick={() => { autoRef.current = 0; setAutoRemaining(null); setMessage('自动旋转已停止'); }}>停止自动 · {autoRemaining}</button>}
        </div>
        <p className="rabbit-message">{message}{autoRemaining !== null && autoRef.current > 0 ? ` · 自动剩余 ${autoRemaining}` : ''}</p>
      </section>
      <p className="rabbit-demo-note">演示平台 · 仅虚拟积分 · 不涉及真实货币 · 局号 {busy ? '结算中' : '—'}</p>
      {rules && <RulesModal bet={bet} onClose={() => setRules(false)} />}
    </section>
  </main>;
}
