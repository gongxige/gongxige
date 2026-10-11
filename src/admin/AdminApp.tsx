import { FormEvent, useCallback, useEffect, useState } from 'react';

// Back office at /admin: admin login, overview, players (search, detail,
// freeze/unfreeze, manual adjustment with a reason), deposit and withdrawal
// review, all transactions, all game rounds, reconciliation, fault simulation
// and the audit log.
type Admin = { id: string; username: string };
type Overview = { players: number; frozenPlayers: number; depositsApproved: number; withdrawalsApproved: number; bets: number; wins: number; platformProfit: number; games?: { title: string; rounds: number; bets: number; wins: number }[]; gamesAvailable?: boolean };
type PlayerRow = { id: string; username: string; status: string; createdAt: string; balance: number; frozenBalance: number };
type LedgerRow = { transactionId: string; kind: string; amount: number; balanceDelta: number; balanceAfter: number; status: string; roundId: string | null; reason: string | null; createdAt: string };
type PlayerDetail = { player: { id: string; username: string; status: string; createdAt: string }; wallet: { balance: number; frozen_balance: number }; reconciled: boolean; ledger: LedgerRow[] };
type AuditLog = { id: string; admin: string; action: string; targetType: string | null; targetId: string | null; reason: string | null; details: Record<string, unknown> | null; createdAt: string };
type ReviewRow = { id: string; requestNo: string; playerId: string; username: string; amount: number; status: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; createdAt: string };
type TransactionRow = LedgerRow & { playerId: string; username: string; frozenDelta: number };
type RoundRow = { roundId: string; gameId?: string; at: string; bet: number; payout: number; playerId: string; username: string | null; mode: string; status: string };
type ReconRow = { playerId: string; username: string; status: string; entries: number; balance: number; ledgerBalance: number; balanceDiff: number; frozen: number; ledgerFrozen: number; frozenDiff: number; ok: boolean };
type FaultState = { kind: string; remaining: number; label: string; kinds: Record<string, string> };
type Tab = 'overview' | 'players' | 'deposits' | 'withdrawals' | 'transactions' | 'rounds' | 'reconciliation' | 'faults' | 'logs';

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '请求未能完成，请稍后重试。');
  return body as T;
}

const fmt = (n: number) => n.toLocaleString('zh-CN');
const GAME_TITLES: Record<string, string> = { 'wild-frontier': 'Wild Frontier', 'mahjong-cascade': '麻将连连胡' };
const time = (iso: string) => new Date(iso).toLocaleString('zh-CN');
const kindLabel: Record<string, string> = { registration_credit: '注册赠送', deposit_approved: '充值到账', withdrawal_freeze: '提现冻结', withdrawal_approved: '提现完成', withdrawal_rejected: '提现被拒（解冻）', bet: '下注', win: '派彩', refund: '回滚', manual_adjustment: '后台调整' };
const actionLabel: Record<string, string> = { login: '登录后台', logout: '退出后台', freeze_player: '冻结玩家', unfreeze_player: '解冻玩家', adjust_balance: '调整余额', approve_deposit: '通过充值', reject_deposit: '拒绝充值', approve_withdrawal: '通过提现', reject_withdrawal: '拒绝提现', set_fault: '故障模拟' };
const requestStatusLabel: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };
const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;

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
  return <section className="admin-cards" aria-label="概览">{cards.map(([label, value]) => <article key={label} className="admin-card"><span>{label}</span><strong className={label === '今日平台盈亏' && data.platformProfit < 0 ? 'negative' : undefined}>{value}</strong></article>)}<p className="admin-hint">金额单位为 DEMO 虚拟积分；"今日"按本机日期计算，平台盈亏 = 下注 − 派彩（已回滚的下注不计）。</p>
    {data.games && <div className="admin-table-wrap admin-games"><table className="admin-table"><thead><tr><th>游戏</th><th>今日局数</th><th>今日下注</th><th>今日派彩</th><th>今日盈亏</th></tr></thead>
      <tbody>{data.games.map((g) => <tr key={g.title}><td>{g.title}</td><td>{fmt(g.rounds)}</td><td>{fmt(g.bets)}</td><td>{fmt(g.wins)}</td><td className={g.bets - g.wins < 0 ? 'negative' : undefined}>{fmt(g.bets - g.wins)}</td></tr>)}</tbody></table>
      <p className="admin-hint">按游戏的数字来自游戏服务器的局记录（本平台最近 500 局中属于今天的局）{data.gamesAvailable ? '' : '；游戏服务器暂时连不上，显示为 0'}。</p></div>}
  </section>;
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

function ReviewPanel({ type }: { type: 'deposit' | 'withdrawal' }) {
  const name = type === 'deposit' ? '充值' : '提现';
  const [rows, setRows] = useState<ReviewRow[]>([]); const [status, setStatus] = useState('pending'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => adminFetch<{ requests: ReviewRow[] }>(`/${type}-requests?status=${status}`).then(({ requests }) => setRows(requests)).catch((error: Error) => setMessage(error.message)), [type, status]);
  useEffect(() => { load(); }, [load]);
  async function review(row: ReviewRow, decision: 'approve' | 'reject') {
    setBusy(row.id); setMessage('');
    try { await adminFetch(`/${type}-requests/${encodeURIComponent(row.id)}/${decision}`, { method: 'POST', body: JSON.stringify({ note: notes[row.id] ?? '' }) }); setMessage(`已${decision === 'approve' ? '通过' : '拒绝'} ${row.username} 的${name}申请 ${fmt(row.amount)}。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败。'); }
    finally { setBusy(''); await load(); }
  }
  return <section><div className="admin-filters"><label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="">全部</option></select></label></div>
    <p className="admin-hint">{type === 'deposit' ? '通过后积分立即到账；拒绝不改变余额。' : '提交时金额已冻结；通过后从冻结中扣除，拒绝则退回可用余额。'}同一申请只能处理一次。</p>
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="records-list">{rows.length ? rows.map((row) => <article className="record admin-review" key={row.id}><b>{row.username}</b><span>{fmt(row.amount)} DEMO</span><em className={row.status === 'rejected' ? 'negative' : undefined}>{requestStatusLabel[row.status] ?? row.status}</em>
      <small>申请于 {time(row.createdAt)} · {row.requestNo}{row.reviewedAt ? ` · ${row.reviewedBy} 于 ${time(row.reviewedAt)} 处理` : ''}{row.reviewNote ? ` · 备注：${row.reviewNote}` : ''}</small>
      {row.status === 'pending' && <div className="admin-review-actions"><input placeholder="备注（可选）" maxLength={200} value={notes[row.id] ?? ''} onChange={(event) => setNotes({ ...notes, [row.id]: event.target.value })} disabled={busy === row.id} /><button className="primary-button" disabled={busy === row.id} onClick={() => review(row, 'approve')}>通过</button><button className="secondary-button" disabled={busy === row.id} onClick={() => review(row, 'reject')}>拒绝</button></div>}
    </article>) : <p>没有{status ? requestStatusLabel[status] : ''}的{name}申请。</p>}</div></section>;
}

type TransactionFilters = { player: string; kind: string; from: string; to: string };
function TransactionsPanel() {
  const [filters, setFilters] = useState<TransactionFilters>({ player: '', kind: '', from: '', to: '' }); const [rows, setRows] = useState<TransactionRow[]>([]); const [message, setMessage] = useState('');
  const load = useCallback((next: TransactionFilters) => adminFetch<{ transactions: TransactionRow[] }>(`/transactions?${new URLSearchParams(next)}`).then(({ transactions }) => { setRows(transactions); setMessage(''); }).catch((error: Error) => setMessage(error.message)), []);
  // First load with empty filters; later loads come from the form.
  useEffect(() => { load({ player: '', kind: '', from: '', to: '' }); }, [load]);
  const set = (key: keyof TransactionFilters) => (event: { target: { value: string } }) => setFilters({ ...filters, [key]: event.target.value });
  return <section><form className="admin-filters" onSubmit={(event) => { event.preventDefault(); load(filters); }}>
    <label>玩家（用户名或编号）<input value={filters.player} onChange={set('player')} /></label>
    <label>类型<select value={filters.kind} onChange={set('kind')}><option value="">全部</option>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>从<input type="date" value={filters.from} onChange={set('from')} /></label><label>到<input type="date" value={filters.to} onChange={set('to')} /></label>
    <button className="primary-button">筛选</button></form>
    {message && <p className="form-message" role="status">{message}</p>}
    <p className="admin-hint">共 {rows.length} 条（最多显示 500 条）。</p>
    <div className="records-list">{rows.length ? rows.map((row) => <article className="record" key={row.transactionId}><b>{kindLabel[row.kind] ?? row.kind} · {row.username}</b><span>可用 {signed(row.balanceDelta)}{row.frozenDelta ? ` · 冻结 ${signed(row.frozenDelta)}` : ''} → 余额 {fmt(row.balanceAfter)}</span><em>{row.status === 'refunded' ? '已回滚' : '完成'}</em><small>{time(row.createdAt)}{row.reason ? ` · 原因：${row.reason}` : ''}{row.roundId ? ` · 局号 ${row.roundId}` : ''}</small></article>) : <p>没有符合条件的流水。</p>}</div></section>;
}

function RoundsPanel() {
  const [rows, setRows] = useState<RoundRow[]>([]); const [message, setMessage] = useState('');
  useEffect(() => { adminFetch<{ rounds: RoundRow[] }>('/rounds').then(({ rounds }) => setRows(rounds)).catch((error: Error) => setMessage(error.message)); }, []);
  return <section>{message && <p className="form-message" role="status">{message}</p>}<p className="admin-hint">所有玩家最近 500 局；点局号在新页面打开回放（含"重新计算是否一致"）。</p>
    <div className="records-list">{rows.length ? rows.map((row) => <article className="record game-record" key={row.roundId}><b>{GAME_TITLES[row.gameId ?? 'wild-frontier'] ?? row.gameId} · {row.username ?? row.playerId} · {time(row.at)}</b><span>{row.mode === 'free' ? '免费局' : `投注 ${fmt(row.bet)}`} · 赢分 {fmt(row.payout)}</span><em className={row.status === 'settled' ? undefined : 'negative'}>{row.status === 'settled' ? '已结算' : '派彩待发'}</em><a href={`/api/admin/rounds/${encodeURIComponent(row.roundId)}/replay`} target="_blank" rel="noreferrer">局号：{row.roundId}</a></article>) : <p>暂无游戏记录。</p>}</div></section>;
}

function ReconciliationPanel() {
  const [rows, setRows] = useState<ReconRow[]>([]); const [message, setMessage] = useState('');
  useEffect(() => { adminFetch<{ players: ReconRow[] }>('/reconciliation').then(({ players }) => setRows(players)).catch((error: Error) => setMessage(error.message)); }, []);
  const bad = rows.filter((row) => !row.ok).length;
  return <section>{message && <p className="form-message" role="status">{message}</p>}
    <p className={`admin-hint${bad ? ' negative' : ''}`}>{rows.length} 位玩家，{bad ? `${bad} 位不一致（标红）` : '全部一致'}。"流水计算" = 该玩家全部资金流水的变动之和，应与钱包里的数字相同。</p>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>玩家</th><th>可用余额</th><th>流水计算</th><th>差额</th><th>冻结</th><th>流水计算</th><th>差额</th><th>流水条数</th><th>结果</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.playerId} className={row.ok ? undefined : 'mismatch'}><td>{row.username}</td><td>{fmt(row.balance)}</td><td>{fmt(row.ledgerBalance)}</td><td>{signed(row.balanceDiff)}</td><td>{fmt(row.frozen)}</td><td>{fmt(row.ledgerFrozen)}</td><td>{signed(row.frozenDiff)}</td><td>{fmt(row.entries)}</td><td>{row.ok ? '✓ 一致' : '✗ 不一致'}</td></tr>)}</tbody></table></div></section>;
}

function FaultsPanel() {
  const [state, setState] = useState<FaultState | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { adminFetch<FaultState>('/faults').then(setState).catch((error: Error) => setMessage(error.message)); }, []);
  async function choose(kind: string) {
    setBusy(true); setMessage('');
    try { const next = await adminFetch<FaultState>('/faults', { method: 'POST', body: JSON.stringify({ kind }) }); setState(next); setMessage(`已设置：${next.label}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败。'); }
    finally { setBusy(false); }
  }
  if (!state) return <p className="form-message">{message || '加载中…'}</p>;
  return <section><div className="admin-cards"><article className="admin-card"><span>当前故障</span><strong className={state.kind === 'none' ? undefined : 'negative'}>{state.label}{state.kind === 'win-down' ? `（还剩 ${state.remaining} 次）` : ''}</strong></article></div>
    <p className="admin-hint">派彩连续失败：接下来 4 次派彩都会失败，游戏服务器会把派彩放进待发队列，稍后自动补发；扣款超时：这一局会被取消并自动回滚。之后可在"对账"页确认数字仍然一致。</p>
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="admin-review-actions">{Object.entries(state.kinds).map(([kind, label]) => <button key={kind} className={kind === 'none' ? 'secondary-button' : 'primary-button'} disabled={busy} onClick={() => choose(kind)}>{label}</button>)}</div></section>;
}

function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]); const [message, setMessage] = useState('');
  useEffect(() => { adminFetch<{ logs: AuditLog[] }>('/audit-logs').then(({ logs: rows }) => setLogs(rows)).catch((error: Error) => setMessage(error.message)); }, []);
  return <section>{message && <p className="form-message" role="status">{message}</p>}<div className="records-list">{logs.length ? logs.map((log) => <article className="record" key={log.id}><b>{actionLabel[log.action] ?? log.action}</b><span>{log.admin}{log.targetType === 'player' ? ` → 玩家 ${log.targetId}` : typeof log.details?.playerId === 'string' ? ` → 玩家 ${log.details.playerId}` : ''}</span><em>{typeof log.details?.amount === 'number' ? (log.action === 'adjust_balance' ? signed(log.details.amount) : fmt(log.details.amount)) : typeof log.details?.label === 'string' ? log.details.label : ''}</em><small>{time(log.createdAt)}{log.reason ? ` · 原因：${log.reason}` : ''}</small></article>) : <p>暂无操作日志。</p>}</div></section>;
}

export default function AdminApp() {
  const [admin, setAdmin] = useState<Admin | null>(null); const [checked, setChecked] = useState(false); const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => { adminFetch<{ admin: Admin }>('/auth/me').then(({ admin: next }) => setAdmin(next)).catch(() => undefined).finally(() => setChecked(true)); }, []);
  if (!checked) return <main className="platform-page"><Notice /></main>;
  if (!admin) return <AdminLogin onSuccess={setAdmin} />;
  async function logout() { await adminFetch('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); setAdmin(null); }
  const tabs: [Tab, string][] = [['overview', '概览'], ['players', '玩家管理'], ['deposits', '充值审核'], ['withdrawals', '提现审核'], ['transactions', '交易流水'], ['rounds', '游戏记录'], ['reconciliation', '对账'], ['faults', '故障模拟'], ['logs', '操作日志']];
  return <main className="platform-page admin-page"><Notice /><header className="lobby-header"><div><p className="eyebrow">BACK OFFICE</p><h1>管理后台</h1></div><div className="header-actions"><span>管理员 {admin.username}</span><button className="text-button" onClick={logout}>退出登录</button></div></header>
    <nav className="admin-tabs" aria-label="后台导航">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : undefined} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'overview' && <OverviewPanel />}{tab === 'players' && <PlayersPanel />}{tab === 'deposits' && <ReviewPanel key="deposit" type="deposit" />}{tab === 'withdrawals' && <ReviewPanel key="withdrawal" type="withdrawal" />}
    {tab === 'transactions' && <TransactionsPanel />}{tab === 'rounds' && <RoundsPanel />}{tab === 'reconciliation' && <ReconciliationPanel />}{tab === 'faults' && <FaultsPanel />}{tab === 'logs' && <AuditLogPanel />}
  </main>;
}
