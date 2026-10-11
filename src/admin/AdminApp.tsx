import { FormEvent, useCallback, useEffect, useState } from 'react';

// Back office at /admin: admin login, overview, players (search, detail,
// freeze/unfreeze, manual adjustment with a reason) and the audit log.
type Admin = { id: string; username: string };
type Overview = { players: number; frozenPlayers: number; depositsApproved: number; withdrawalsApproved: number; bets: number; wins: number; platformProfit: number };
type PlayerRow = { id: string; username: string; status: string; createdAt: string; balance: number; frozenBalance: number };
type LedgerRow = { transactionId: string; kind: string; amount: number; balanceDelta: number; balanceAfter: number; status: string; roundId: string | null; reason: string | null; createdAt: string };
type PlayerDetail = { player: { id: string; username: string; status: string; createdAt: string }; wallet: { balance: number; frozen_balance: number }; reconciled: boolean; ledger: LedgerRow[] };
type AuditLog = { id: string; admin: string; action: string; targetType: string | null; targetId: string | null; reason: string | null; details: Record<string, unknown> | null; createdAt: string };
type Tab = 'overview' | 'players' | 'logs';

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '请求未能完成，请稍后重试。');
  return body as T;
}

const fmt = (n: number) => n.toLocaleString('zh-CN');
const time = (iso: string) => new Date(iso).toLocaleString('zh-CN');
const kindLabel: Record<string, string> = { registration_credit: '注册赠送', deposit_approved: '充值到账', withdrawal_freeze: '提现冻结', withdrawal_approved: '提现完成', bet: '下注', win: '派彩', refund: '回滚', manual_adjustment: '后台调整' };
const actionLabel: Record<string, string> = { login: '登录后台', logout: '退出后台', freeze_player: '冻结玩家', unfreeze_player: '解冻玩家', adjust_balance: '调整余额' };

function Notice() { return <div className="demo-notice">演示平台 · 仅虚拟积分 · 不涉及真实货币</div>; }

function AdminLogin({ onSuccess }: { onSuccess: (admin: Admin) => void }) {
  const [username, setUsername] = useState('admin'); const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(''); setBusy(true);
    try { onSuccess((await adminFetch<{ admin: Admin }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })).admin); }
    catch (error) { setMessage(error instanceof Error ? error.message : '登录失败。'); }
    finally { setBusy(false); }
  }
  return <main className="platform-page"><Notice /><section className="auth-card" aria-labelledby="admin-login-title"><p className="eyebrow">BACK OFFICE</p><h1 id="admin-login-title">管理员登录</h1><p className="auth-copy">管理员账号与玩家账号分开。首次启动平台时，初始密码打印在运行 <code>npm start</code> 的终端里。</p><form onSubmit={submit}><label>管理员用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <p className="form-message" role="status">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? '登录中…' : '登录后台'}</button></form></section></main>;
}

function OverviewPanel() {
  const [data, setData] = useState<Overview | null>(null); const [message, setMessage] = useState('');
  useEffect(() => { adminFetch<Overview>('/overview').then(setData).catch((error: Error) => setMessage(error.message)); }, []);
  if (!data) return <p className="form-message">{message || '加载中…'}</p>;
  const cards: [string, string][] = [['玩家数', `${fmt(data.players)}（冻结 ${fmt(data.frozenPlayers)}）`], ['今日充值到账', fmt(data.depositsApproved)], ['今日提现完成', fmt(data.withdrawalsApproved)], ['今日下注', fmt(data.bets)], ['今日派彩', fmt(data.wins)], ['今日平台盈亏', fmt(data.platformProfit)]];
  return <section className="admin-cards" aria-label="概览">{cards.map(([label, value]) => <article key={label} className="admin-card"><span>{label}</span><strong className={label === '今日平台盈亏' && data.platformProfit < 0 ? 'negative' : undefined}>{value}</strong></article>)}<p className="admin-hint">金额单位为 DEMO 虚拟积分；"今日"按本机日期计算，平台盈亏 = 下注 − 派彩（已回滚的下注不计）。</p></section>;
}

function PlayerDetailPanel({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [statusReason, setStatusReason] = useState(''); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const load = useCallback(() => adminFetch<PlayerDetail>(`/players/${encodeURIComponent(playerId)}`).then(setDetail).catch((error: Error) => setMessage(error.message)), [playerId]);
  useEffect(() => { load(); }, [load]);
  async function act(path: string, body: unknown, done: string) {
    setBusy(true); setMessage('');
    try { await adminFetch(`/players/${encodeURIComponent(playerId)}/${path}`, { method: 'POST', body: JSON.stringify(body) }); setMessage(done); await load(); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败。'); return false; }
    finally { setBusy(false); }
  }
  async function toggleStatus() {
    if (!detail) return;
    const freezing = detail.player.status === 'active';
    if (await act(freezing ? 'freeze' : 'unfreeze', { reason: statusReason }, freezing ? '已冻结，玩家已被登出且无法登录。' : '已解冻。')) setStatusReason('');
  }
  async function adjust(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value === 0) { setMessage('调整金额必须是非零整数（负数表示扣减）。'); return; }
    if (!reason.trim()) { setMessage('必须填写调整原因。'); return; }
    if (await act('adjustment', { amount: value, reason }, `已调整 ${value > 0 ? '+' : ''}${fmt(value)}。`)) { setAmount(''); setReason(''); }
  }
  if (!detail) return <p className="form-message">{message || '加载中…'}</p>;
  const { player, wallet } = detail; const frozen = player.status !== 'active';
  return <section className="admin-detail"><button className="text-button" onClick={onBack}>← 返回玩家列表</button>
    <header className="admin-detail-head"><div><h2>{player.username}</h2><small>{player.id} · 注册于 {time(player.createdAt)}</small></div><span className={`status-pill ${frozen ? 'frozen' : 'active'}`}>{frozen ? '已冻结' : '正常'}</span></header>
    <div className="admin-cards"><article className="admin-card"><span>可用余额</span><strong>{fmt(wallet.balance)}</strong></article><article className="admin-card"><span>冻结中</span><strong>{fmt(wallet.frozen_balance)}</strong></article><article className="admin-card"><span>对账</span><strong className={detail.reconciled ? undefined : 'negative'}>{detail.reconciled ? '一致' : '不一致'}</strong></article></div>
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="admin-forms">
      <section className="wallet-actions"><h3>{frozen ? '解冻账号' : '冻结账号'}</h3><label>原因（可选）<input value={statusReason} maxLength={200} onChange={(event) => setStatusReason(event.target.value)} disabled={busy} /></label><div><button className={frozen ? 'primary-button' : 'secondary-button'} disabled={busy} onClick={toggleStatus}>{frozen ? '解冻' : '冻结'}</button></div></section>
      <form className="wallet-actions" onSubmit={adjust}><h3>手动调整余额</h3><label>金额（正数增加，负数扣减）<input type="number" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} required /></label><label>原因（必填，会写入资金流水和操作日志）<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} disabled={busy} required /></label><div><button className="primary-button" disabled={busy}>确认调整</button></div></form>
    </div>
    <section className="records-section"><h2>资金流水（最近 100 条）</h2><div className="records-list">{detail.ledger.length ? detail.ledger.map((row) => <article className="record" key={row.transactionId}><b>{kindLabel[row.kind] ?? row.kind}</b><span>{row.balanceDelta > 0 ? '+' : ''}{fmt(row.balanceDelta)} → 余额 {fmt(row.balanceAfter)}</span><em>{row.status === 'refunded' ? '已回滚' : '完成'}</em><small>{time(row.createdAt)}{row.reason ? ` · 原因：${row.reason}` : ''}{row.roundId ? ` · 局号 ${row.roundId}` : ''}</small></article>) : <p>暂无流水。</p>}</div></section>
  </section>;
}

function PlayersPanel() {
  const [query, setQuery] = useState(''); const [players, setPlayers] = useState<PlayerRow[]>([]); const [message, setMessage] = useState(''); const [selected, setSelected] = useState<string | null>(null);
  const search = useCallback((q: string) => adminFetch<{ players: PlayerRow[] }>(`/players?q=${encodeURIComponent(q)}`).then(({ players: rows }) => { setPlayers(rows); setMessage(''); }).catch((error: Error) => setMessage(error.message)), []);
  // Reload the list on open and after coming back from a player's detail page.
  useEffect(() => { if (!selected) search(query); }, [selected]);
  if (selected) return <PlayerDetailPanel playerId={selected} onBack={() => setSelected(null)} />;
  return <section><form className="admin-search" onSubmit={(event) => { event.preventDefault(); search(query); }}><input placeholder="按用户名或玩家编号搜索" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="primary-button">搜索</button></form>{message && <p className="form-message" role="status">{message}</p>}
    <div className="records-list">{players.length ? players.map((p) => <button key={p.id} className="record admin-player-row" onClick={() => setSelected(p.id)}><b>{p.username}</b><span>余额 {fmt(p.balance)}{p.frozenBalance ? ` · 冻结 ${fmt(p.frozenBalance)}` : ''}</span><em className={p.status === 'active' ? undefined : 'negative'}>{p.status === 'active' ? '正常' : '已冻结'}</em><small>{p.id} · 注册于 {time(p.createdAt)}</small></button>) : <p>没有找到玩家。</p>}</div></section>;
}

function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]); const [message, setMessage] = useState('');
  useEffect(() => { adminFetch<{ logs: AuditLog[] }>('/audit-logs').then(({ logs: rows }) => setLogs(rows)).catch((error: Error) => setMessage(error.message)); }, []);
  return <section>{message && <p className="form-message" role="status">{message}</p>}<div className="records-list">{logs.length ? logs.map((log) => <article className="record" key={log.id}><b>{actionLabel[log.action] ?? log.action}</b><span>{log.admin}{log.targetType === 'player' ? ` → 玩家 ${log.targetId}` : ''}</span><em>{typeof log.details?.amount === 'number' ? `${log.details.amount > 0 ? '+' : ''}${fmt(log.details.amount)}` : ''}</em><small>{time(log.createdAt)}{log.reason ? ` · 原因：${log.reason}` : ''}</small></article>) : <p>暂无操作日志。</p>}</div></section>;
}

export default function AdminApp() {
  const [admin, setAdmin] = useState<Admin | null>(null); const [checked, setChecked] = useState(false); const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { adminFetch<{ admin: Admin }>('/auth/me').then(({ admin: next }) => setAdmin(next)).catch(() => undefined).finally(() => setChecked(true)); }, []);
  if (!checked) return <main className="platform-page"><Notice /></main>;
  if (!admin) return <AdminLogin onSuccess={setAdmin} />;
  async function logout() { await adminFetch('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); setAdmin(null); }
  const tabs: [Tab, string][] = [['overview', '概览'], ['players', '玩家管理'], ['logs', '操作日志']];
  return <main className="platform-page admin-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">BACK OFFICE</p><h1>管理后台</h1></div><div className="header-actions"><span>管理员 {admin.username}</span><button className="text-button" onClick={logout}>退出登录</button></div></header>
    <nav className="admin-tabs" aria-label="后台导航">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : undefined} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'overview' && <OverviewPanel />}{tab === 'players' && <PlayersPanel />}{tab === 'logs' && <AuditLogPanel />}
  </main>;
}
