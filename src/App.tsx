import { FormEvent, useEffect, useState } from 'react';
import GameApp from './GameApp.tsx';

type Player = { id: string; username: string; status: string };
type Wallet = { playerId: string; balance: number; currency: string };
type View = 'login' | 'register' | 'lobby';

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

function Lobby({ player, onLogout }: { player: Player; onLogout: () => void }) {
  const [wallet, setWallet] = useState<Wallet | null>(null); const [message, setMessage] = useState(''); const [launching, setLaunching] = useState(false);
  useEffect(() => { platformFetch<Wallet>('/games/wild-frontier/balance').then(setWallet).catch((error: Error) => setMessage(error.message)); }, []);
  async function launch() { setLaunching(true); setMessage('正在连接 Wild Frontier…'); try { const { gameUrl } = await platformFetch<{ gameUrl: string }>('/games/wild-frontier/launch', { method: 'POST', body: '{}' }); location.assign(gameUrl); } catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法启动游戏。'); setLaunching(false); } }
  async function logout() { await platformFetch('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); onLogout(); }
  return <main className="platform-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">DEMO GAME LOBBY</p><h1>你好，{player.username}</h1></div><button className="text-button" onClick={logout}>退出登录</button></header><section className="wallet-panel" aria-label="虚拟积分余额"><span>可用虚拟积分</span><strong>{wallet ? wallet.balance.toLocaleString('zh-CN') : '—'}</strong><small>DEMO · 仅供本地演示</small></section><section className="games-section"><div><p className="eyebrow">游戏大厅</p><h2>选择一款游戏</h2></div><button className="game-card" onClick={launch} disabled={launching} aria-label="进入 Wild Frontier"><span className="game-card-art">♜</span><span className="game-card-body"><b>Wild Frontier</b><small>1024 Ways · 虚拟积分体验</small></span><span className="game-card-action">{launching ? '启动中…' : '进入游戏 →'}</span></button>{message && <p className="form-message" role="status">{message}</p>}</section></main>;
}

export default function App() {
  const hasGameToken = new URLSearchParams(location.search).has('token'); const [player, setPlayer] = useState<Player | null>(null); const [view, setView] = useState<View>('login');
  useEffect(() => { if (!hasGameToken) platformFetch<{ player: Player }>('/auth/me').then(({ player: next }) => { setPlayer(next); setView('lobby'); }).catch(() => undefined); }, [hasGameToken]);
  if (hasGameToken) return <GameApp />;
  if (view === 'lobby' && player) return <Lobby player={player} onLogout={() => { setPlayer(null); setView('login'); }} />;
  return <AuthCard view={view === 'register' ? 'register' : 'login'} onSuccess={(next) => { setPlayer(next); setView('lobby'); }} onSwitch={() => setView(view === 'login' ? 'register' : 'login')} />;
}
