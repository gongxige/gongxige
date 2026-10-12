import { FormEvent, useEffect, useState } from 'react';
import GameApp from './GameApp.tsx';
import AdminApp from './admin/AdminApp.tsx';
import MahjongApp from './mahjong/MahjongApp.tsx';
import JadeRabbitApp from './rabbit/JadeRabbitApp.tsx';

type Player = { id: string; username: string; status: string };
type Wallet = { playerId: string; balance: number; frozen_balance?: number; currency: string };
type WalletRecord = { kind: string; amount: number; status: string; createdAt: string };
type GameRecord = { roundId: string; gameId?: string; at: string; bet: number; payout: number };
const GAME_TITLES: Record<string, string> = { 'wild-frontier': 'Wild Frontier', 'mahjong-cascade': '麻将连连胡' };
const LOBBY_GAMES = [
  { gameId: 'wild-frontier', title: 'Wild Frontier', art: '♜', sub: '1024 Ways · 虚拟积分体验' },
  { gameId: 'mahjong-cascade', title: '麻将连连胡', art: '中', sub: '2000 Ways · 消除连锁 · 金色变百搭' },
];
type View = 'login' | 'register' | 'lobby' | 'wallet' | 'game-records' | 'profile';

class PlatformError extends Error {}

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PlatformError(body.error || '请求未能完成，请稍后重试。');
  return body as T;
}

function Notice() { return <div className="demo-notice">演示平台 · 仅虚拟积分 · 不涉及真实货币</div>; }

function AuthCard({ view, onSuccess, onSwitch }: { view: Exclude<View, 'lobby'>; onSuccess: (player: Player) => void; onSwitch: () => void }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const isRegister = view === 'register';
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage('');
    if (isRegister && password !== confirmPassword) { setMessage('两次输入的密码不一致。'); return; }
    setBusy(true);
    try {
      if (isRegister) { await platformFetch<{ player: Player }>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }); setMessage('注册成功，请使用新账号登录。'); setPassword(''); setConfirmPassword(''); }
      else { const result = await platformFetch<{ player: Player }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); onSuccess(result.player); }
    } catch (error) { setMessage(error instanceof Error ? error.message : '请求失败。'); } finally { setBusy(false); }
  }
  return <main className="platform-page"><Notice /><section className="auth-card" aria-labelledby="auth-title"><p className="eyebrow">WILD FRONTIER</p><h1 id="auth-title">{isRegister ? '创建演示账号' : '欢迎回来'}</h1><p className="auth-copy">{isRegister ? '注册后登录，即可使用虚拟积分体验游戏。' : '登录后进入游戏大厅。'}</p><form onSubmit={submit}><label>用户名<input autoComplete="username" minLength={3} maxLength={32} value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>密码<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{isRegister && <label>确认密码<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}{message && <p className="form-message" role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? '处理中…' : isRegister ? '注册账号' : '登录大厅'}</button></form><button className="text-button" onClick={onSwitch}>{isRegister ? '已有账号？去登录' : '没有账号？注册演示账号'}</button></section></main>;
}

function Lobby({ player, onLogout, onWallet, onGameRecords, onProfile }: { player: Player; onLogout: () => void; onWallet: () => void; onGameRecords: () => void; onProfile: () => void }) {
  const [wallet, setWallet] = useState<Wallet | null>(null); const [message, setMessage] = useState(''); const [launching, setLaunching] = useState<string | null>(null);
  useEffect(() => { platformFetch<Wallet>('/games/wild-frontier/balance').then(setWallet).catch((error: Error) => setMessage(error.message)); }, []);
  async function launch(gameId: string) { setLaunching(gameId); setMessage(`正在连接 ${GAME_TITLES[gameId]}…`); try { const { gameUrl } = await platformFetch<{ gameUrl: string }>(`/games/${gameId}/launch`, { method: 'POST', body: '{}' }); const target = new URL(gameUrl, location.href); location.assign(target.pathname + target.search); } catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法启动游戏。'); setLaunching(null); } }
  async function logout() { await platformFetch('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); onLogout(); }
  return <main className="platform-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">DEMO GAME LOBBY</p><h1>你好，{player.username}</h1></div><div className="header-actions"><button className="text-button" onClick={onWallet}>我的钱包</button><button className="text-button" onClick={onGameRecords}>游戏记录</button><button className="text-button" onClick={onProfile}>个人中心</button><button className="text-button" onClick={logout}>退出登录</button></div></header><section className="wallet-panel" aria-label="虚拟积分余额"><span>可用虚拟积分</span><strong>{wallet ? wallet.balance.toLocaleString('zh-CN') : '—'}</strong><small>DEMO · 仅供本地演示</small></section><section className="games-section"><div><p className="eyebrow">游戏大厅</p><h2>选择一款游戏</h2></div>{LOBBY_GAMES.map((game) => <button key={game.gameId} className={`game-card game-${game.gameId}`} onClick={() => launch(game.gameId)} disabled={launching !== null} aria-label={`进入 ${game.title}`}><span className="game-card-art">{game.art}</span><span className="game-card-body"><b>{game.title}</b><small>{game.sub}</small></span><span className="game-card-action">{launching === game.gameId ? '启动中…' : '进入游戏 →'}</span></button>)}{message && <p className="form-message" role="status">{message}</p>}</section></main>;
}

const kindLabel: Record<string, string> = { deposit: '充值申请', withdrawal: '提现申请', bet: '下注', win: '派彩', refund: '回滚', manual_adjustment: '后台调整' };
const statusLabel: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已拒绝', completed: '成功', refunded: '已回滚' };

function WalletPage({ onBack }: { onBack: () => void }) {
  const [wallet, setWallet] = useState<Wallet | null>(null); const [records, setRecords] = useState<WalletRecord[]>([]); const [amount, setAmount] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function load() { const [nextWallet, nextRecords] = await Promise.all([platformFetch<Wallet>('/api/wallet'), platformFetch<{ records: WalletRecord[] }>('/api/wallet/records')]); setWallet(nextWallet); setRecords(nextRecords.records); }
  useEffect(() => { load().catch((error: Error) => setMessage(error.message)); }, []);
  async function submit(kind: 'deposit' | 'withdrawal') { const nextAmount = Number(amount); setMessage(''); if (!Number.isSafeInteger(nextAmount) || nextAmount <= 0) { setMessage('请输入正整数虚拟积分。'); return; } setBusy(true); try { await platformFetch(`/api/${kind === 'deposit' ? 'deposit' : 'withdrawal'}-requests`, { method: 'POST', body: JSON.stringify({ amount: nextAmount }) }); setAmount(''); setMessage(kind === 'deposit' ? '充值申请已提交，等待演示审核。' : '提现申请已提交，对应虚拟积分已冻结。'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : '请求失败。'); } finally { setBusy(false); } }
  return <main className="platform-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">DEMO WALLET</p><h1>我的钱包</h1></div><button className="text-button" onClick={onBack}>返回大厅</button></header><section className="wallet-panel wallet-summary"><span>可用虚拟积分</span><strong>{wallet ? wallet.balance.toLocaleString('zh-CN') : '—'}</strong><small>冻结中：{wallet ? (wallet.frozen_balance ?? 0).toLocaleString('zh-CN') : '—'} DEMO</small></section><p className="wallet-notice">仅提交虚拟积分金额；本演示不收集银行卡、账户或任何真实收款信息。</p><section className="wallet-actions"><label>申请金额<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} /></label><div><button className="primary-button" disabled={busy} onClick={() => submit('deposit')}>提交充值申请</button><button className="secondary-button" disabled={busy} onClick={() => submit('withdrawal')}>提交提现申请</button></div></section>{message && <p className="form-message" role="status">{message}</p>}<section className="records-section"><h2>资金记录</h2><p>包含充值、提现、下注、派彩与回滚；每条均显示当前状态。</p><div className="records-list">{records.length ? records.map((record, index) => <article className="record" key={`${record.kind}-${record.createdAt}-${index}`}><b>{kindLabel[record.kind] ?? record.kind}</b><span>{record.amount.toLocaleString('zh-CN')} DEMO</span><em>{statusLabel[record.status] ?? record.status}</em><small>{new Date(record.createdAt).toLocaleString('zh-CN')}</small></article>) : <p>暂无资金记录。</p>}</div></section></main>;
}

function GameRecordsPage({ onBack }: { onBack: () => void }) {
  const [records, setRecords] = useState<GameRecord[]>([]); const [message, setMessage] = useState('');
  useEffect(() => { platformFetch<{ records: GameRecord[] }>('/api/game-records').then(({ records: next }) => setRecords(next)).catch((error: Error) => setMessage(error.message)); }, []);
  return <main className="platform-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">MY GAME HISTORY</p><h1>游戏记录</h1></div><button className="text-button" onClick={onBack}>返回大厅</button></header><section className="records-section"><p>仅显示当前登录账号的每一局；点击局号可在新页面查看回放。</p>{message && <p className="form-message" role="status">{message}</p>}<div className="records-list">{records.length ? records.map((record) => <article className="record game-record" key={record.roundId}><b>{GAME_TITLES[record.gameId ?? 'wild-frontier'] ?? record.gameId} · {new Date(record.at).toLocaleString('zh-CN')}</b><span>投注 {record.bet.toLocaleString('zh-CN')} DEMO</span><em>赢分 {record.payout.toLocaleString('zh-CN')} DEMO</em><a href={`/api/game-records/${encodeURIComponent(record.roundId)}/replay`} target="_blank" rel="noreferrer">局号：{record.roundId}</a></article>) : <p>暂无游戏记录。</p>}</div></section></main>;
}

function ProfilePage({ onBack }: { onBack: () => void }) {
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setMessage(''); if (newPassword !== confirmPassword) { setMessage('两次输入的新密码不一致。'); return; } setBusy(true); try { await platformFetch('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setMessage('密码已修改。'); } catch (error) { setMessage(error instanceof Error ? error.message : '请求失败。'); } finally { setBusy(false); } }
  return <main className="platform-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">MY PROFILE</p><h1>个人中心</h1></div><button className="text-button" onClick={onBack}>返回大厅</button></header><section className="auth-card profile-card"><h2>修改密码</h2><form onSubmit={submit}><label>当前密码<input type="password" autoComplete="current-password" minLength={8} maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>新密码<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label>确认新密码<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>{message && <p className="form-message" role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? '处理中…' : '保存新密码'}</button></form></section></main>;
}

export default function App() {
  if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) return <AdminApp />;
  if (location.pathname === '/mahjong') return <MahjongApp />;
  if (location.pathname === '/jade-rabbit') return <JadeRabbitApp />;
  return <PlayerApp />;
}

function PlayerApp() {
  const hasGameToken = new URLSearchParams(location.search).has('token'); const [player, setPlayer] = useState<Player | null>(null); const [view, setView] = useState<View>('login');
  useEffect(() => { if (!hasGameToken) platformFetch<{ player: Player }>('/auth/me').then(({ player: next }) => { setPlayer(next); setView('lobby'); }).catch(() => undefined); }, [hasGameToken]);
  if (hasGameToken) return <GameApp />;
  if (view === 'wallet' && player) return <WalletPage onBack={() => setView('lobby')} />;
  if (view === 'game-records' && player) return <GameRecordsPage onBack={() => setView('lobby')} />;
  if (view === 'profile' && player) return <ProfilePage onBack={() => setView('lobby')} />;
  if (view === 'lobby' && player) return <Lobby player={player} onWallet={() => setView('wallet')} onGameRecords={() => setView('game-records')} onProfile={() => setView('profile')} onLogout={() => { setPlayer(null); setView('login'); }} />;
  return <AuthCard view={view === 'register' ? 'register' : 'login'} onSuccess={(next) => { setPlayer(next); setView('lobby'); }} onSwitch={() => setView(view === 'login' ? 'register' : 'login')} />;
}
