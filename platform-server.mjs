// Local demo platform. It owns virtual-credit wallets and exposes the
// provider-v1 wallet contract used by server.mjs. No real-money features.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { json, html, parseJson, readRaw, signedPost, verify } from './server/http.mjs';
import { openPlatformDatabase } from './server/platform/db.mjs';
import { LedgerError, createDepositRequest, createPlayer, approveDeposit, createWithdrawalRequest, creditWin, getWallet, manualAdjustment, placeBet, reconcilePlayer, refundBet, reviewRequest, setPlayerStatus, writeAuditLog } from './server/platform/ledger.mjs';
import { authenticatePlayer, changePassword, createSessionStore, registerPlayer } from './server/platform/auth.mjs';
import { replayPage } from './server/replay-page.mjs';
import { authenticateAdmin, ensureInitialAdmin, getAdmin, listAuditLogs, listPlayers, listRequests, listTransactions, overview, playerDetail, reconciliation, recordAdminLogout } from './server/platform/admin.mjs';
import { inTransaction } from './server/platform/db.mjs';

export const PLATFORM_PROTOCOL = 'provider-v1';
const port = Number(process.env.OPERATOR_PORT ?? 8788);
const operatorId = process.env.OPERATOR_ID ?? 'demo-operator';
const secret = process.env.OPERATOR_SECRET ?? 'local-demo-secret';
const providerUrl = process.env.PROVIDER_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 8787}`;
const gameWebUrl = process.env.GAME_WEB_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? 4173}`;
const db = openPlatformDatabase(join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), process.env.PLATFORM_DB_FILE ?? 'platform.sqlite'));
const sessions = createSessionStore();
const adminSessions = createSessionStore();
// First start with no admin: create one and print its random password once.
const initialAdminPassword = await ensureInitialAdmin(db, { password: process.env.ADMIN_PASSWORD || undefined });
if (initialAdminPassword) console.log(`首次启动：已创建管理员账号 admin，初始密码 ${initialAdminPassword}（只显示这一次，请记下来）`);

function seedPlayer(id, username, amount) {
  if (db.prepare('SELECT id FROM players WHERE id = ?').get(id)) return;
  createPlayer(db, { id, username });
  const requestNo = `initial-credit-${id}`;
  createDepositRequest(db, { playerId: id, requestNo, amount });
  approveDeposit(db, { requestNo, reviewedBy: 'bootstrap' });
}
seedPlayer('player-001', '玩家一', 10_000);
seedPlayer('player-002', '玩家二', 10_000);

let fault = { kind: 'none', remaining: 0 };
const slowTransactions = new Set();
// Checks can shorten this while still exceeding the RGS 3-second bet timeout.
const SLOW_MS = Number(process.env.SLOW_BET_MS ?? 8000);
const isAmount = (value, zero = false) => Number.isSafeInteger(value) && (zero ? value >= 0 : value > 0);
const fail = (res, status, code, error) => json(res, status, { code, error });
const cookieValue = (req, name) => (req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const setSessionCookie = (res, token) => res.setHeader('set-cookie', `platform_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`);
const clearSessionCookie = (res) => res.setHeader('set-cookie', 'platform_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
function currentPlayer(req) {
  const id = sessions.get(cookieValue(req, 'platform_session'));
  const player = id ? db.prepare('SELECT id, username, status FROM players WHERE id = ?').get(id) : null;
  // A frozen player is logged out everywhere: no wallet, no game launch, no records.
  return player?.status === 'active' ? player : null;
}
// Admin sessions use their own cookie and store; a player cookie never counts as an admin.
const setAdminCookie = (res, token) => res.setHeader('set-cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
const clearAdminCookie = (res) => res.setHeader('set-cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
const currentAdmin = (req) => { const id = adminSessions.get(cookieValue(req, 'admin_session')); return id ? getAdmin(db, id) : null; };

function walletRecords(playerId) {
  const requests = db.prepare(`SELECT 'deposit' AS kind, amount, status, created_at AS createdAt
    FROM deposit_requests WHERE player_id = ?
    UNION ALL
    SELECT 'withdrawal' AS kind, amount, status, created_at AS createdAt
    FROM withdrawal_requests WHERE player_id = ?`).all(playerId, playerId);
  const entries = db.prepare(`SELECT kind, CASE WHEN kind = 'manual_adjustment' THEN balance_delta ELSE amount END AS amount, status, created_at AS createdAt
    FROM ledger_entries WHERE player_id = ?
      AND kind IN ('bet', 'win', 'refund', 'manual_adjustment')`).all(playerId);
  return [...requests, ...entries].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function walletResponse(res, action, input) {
  const { playerId, transactionId, roundId, amount } = input;
  try {
    if (action === 'balance') return json(res, 200, { playerId, balance: getWallet(db, playerId).balance, currency: 'DEMO' });
    if (!transactionId || !roundId || !isAmount(amount, action === 'win')) return fail(res, 400, 'BAD_REQUEST', `${action === 'win' ? '派彩' : '扣款'}参数不完整`);
    if (action === 'bet') {
      const row = db.prepare('SELECT status FROM provider_transactions WHERE transaction_id = ?').get(transactionId);
      if (row?.status === 'cancelled') return fail(res, 409, 'TRANSACTION_CANCELLED', '这笔扣款已被回滚，不能再扣');
      const result = placeBet(db, { playerId, transactionId, roundId, amount });
      const answer = () => json(res, 200, { transactionId, balance: result.balance, duplicate: result.idempotent || undefined });
      if (slowTransactions.has(transactionId)) return setTimeout(answer, SLOW_MS);
      if (fault.kind === 'slow-bet') {
        fault = { kind: 'none', remaining: 0 };
        slowTransactions.add(transactionId);
        setTimeout(() => slowTransactions.delete(transactionId), 60_000).unref();
        return setTimeout(answer, SLOW_MS);
      }
      return answer();
    }
    if (action === 'win') {
      if (fault.kind === 'win-down' && fault.remaining > 0) {
        fault.remaining -= 1;
        if (!fault.remaining) fault = { kind: 'none', remaining: 0 };
        return fail(res, 500, 'TEMPORARY_ERROR', '（模拟故障）平台暂时无法派彩');
      }
      const result = creditWin(db, { playerId, transactionId, roundId, amount });
      return json(res, 200, { transactionId, balance: result.balance, duplicate: result.idempotent || undefined });
    }
  } catch (error) {
    if (error instanceof LedgerError) return fail(res, error.code === 'INSUFFICIENT_FUNDS' ? 402 : error.code === 'PLAYER_FROZEN' ? 403 : 404, error.code, error.message);
    throw error;
  }
}

function walletRefund(res, input) {
  const { playerId, transactionId, refTransactionId, roundId } = input;
  if (!transactionId || !refTransactionId) return fail(res, 400, 'BAD_REQUEST', '回滚参数不完整');
  try {
    const result = refundBet(db, { playerId, transactionId, refTransactionId, roundId });
    return json(res, 200, { transactionId, balance: result.balance, duplicate: result.idempotent || undefined });
  } catch (error) {
    if (error instanceof LedgerError) return fail(res, 404, error.code, error.message);
    throw error;
  }
}

function state() {
  const players = {};
  for (const player of db.prepare('SELECT id, username FROM players ORDER BY id').all()) {
    const wallet = getWallet(db, player.id);
    const reconciliation = reconcilePlayer(db, player.id);
    players[player.id] = { name: player.username, balance: wallet.balance, deposits: db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE player_id = ? AND kind = 'deposit_approved'").get(player.id).total, ok: reconciliation.balanceMatches && reconciliation.frozenMatches };
  }
  const transactions = db.prepare(`SELECT transaction_id AS txId, kind AS type, player_id AS playerId, round_id AS roundId, amount, status, balance_after AS balanceAfter, created_at AS at, ref_transaction_id AS refTransactionId FROM ledger_entries ORDER BY created_at`).all();
  return { players, transactions };
}

/** Games in the lobby (the game server knows the same ids). */
export const PLATFORM_GAMES = { 'wild-frontier': 'Wild Frontier', 'mahjong-cascade': '麻将连连胡', 'jade-rabbit': '玉兔送财' };

async function createLaunch(playerId, gameId = 'wild-frontier') {
  const player = db.prepare('SELECT id, username FROM players WHERE id = ?').get(playerId);
  if (!player) throw new LedgerError('PLAYER_NOT_FOUND', 'Player not found');
  const { status, body } = await signedPost(`${providerUrl}/provider/launch`, { operatorId, playerId: player.id, playerName: player.username, currency: 'DEMO', gameId }, { secret, operatorId, timeoutMs: 90_000 });
  if (status !== 200 || !body.gameUrl) throw new Error(body.error || `HTTP ${status}`);
  return body;
}

async function providerRounds(playerId, roundId) {
  return signedPost(`${providerUrl}/provider/rounds`, { playerId, ...(roundId ? { roundId } : {}) }, { secret, operatorId });
}
/** Back office: any round of this operator's players. */
async function operatorRounds(roundId) {
  return signedPost(`${providerUrl}/provider/rounds`, { scope: 'operator', ...(roundId ? { roundId } : { limit: 500 }) }, { secret, operatorId });
}

const FAULT_KINDS = { none: '无故障', 'win-down': '派彩连续失败', 'slow-bet': '下一次扣款超时' };
function setFault(kind, adminId) {
  if (!FAULT_KINDS[kind]) throw new LedgerError('INVALID_FAULT', '没有这种故障');
  fault = kind === 'win-down' ? { kind, remaining: 4 } : kind === 'slow-bet' ? { kind, remaining: 1 } : { kind: 'none', remaining: 0 };
  inTransaction(db, () => writeAuditLog(db, { adminId, action: 'set_fault', targetType: 'fault', targetId: kind, details: { label: FAULT_KINDS[kind] } }));
  return faultState();
}
const faultState = () => ({ kind: fault.kind, remaining: fault.remaining, label: FAULT_KINDS[fault.kind], kinds: FAULT_KINDS });

/** /api/admin/*: every route except login needs an admin session. */
async function adminApi(req, res, url) {
  const path = url.pathname.slice('/api/admin'.length);
  if (req.method === 'POST' && path === '/auth/login') {
    const admin = await authenticateAdmin(db, parseJson(await readRaw(req)));
    setAdminCookie(res, adminSessions.create(admin.id));
    return json(res, 200, { admin });
  }
  const admin = currentAdmin(req);
  if (!admin) return fail(res, 401, 'ADMIN_UNAUTHENTICATED', '请先以管理员身份登录');
  if (req.method === 'POST' && path === '/auth/logout') {
    recordAdminLogout(db, admin.id);
    adminSessions.delete(cookieValue(req, 'admin_session'));
    clearAdminCookie(res);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && path === '/auth/me') return json(res, 200, { admin });
  if (req.method === 'GET' && path === '/overview') {
    // Per-game numbers come from the game server's round records (this operator's latest 500 rounds, today only).
    const totals = overview(db);
    const { status, body } = await operatorRounds();
    const byGame = Object.fromEntries(Object.entries(PLATFORM_GAMES).map(([gameId, title]) => [gameId, { title, rounds: 0, bets: 0, wins: 0 }]));
    if (status === 200) for (const round of body.records) {
      if (round.at < totals.since) continue;
      const game = byGame[round.gameId ?? 'wild-frontier']; if (!game) continue;
      game.rounds += 1; game.bets += round.mode === 'free' ? 0 : round.bet; game.wins += round.payout;
    }
    return json(res, 200, { ...totals, games: Object.values(byGame), gamesAvailable: status === 200 });
  }
  if (req.method === 'GET' && path === '/players') return json(res, 200, { players: listPlayers(db, { query: url.searchParams.get('q') ?? '' }) });
  if (req.method === 'GET' && path === '/audit-logs') return json(res, 200, { logs: listAuditLogs(db, { limit: url.searchParams.get('limit') }) });
  const requestList = path.match(/^\/(deposit|withdrawal)-requests$/);
  if (req.method === 'GET' && requestList) return json(res, 200, { requests: listRequests(db, requestList[1], { status: url.searchParams.get('status') ?? '' }) });
  const requestReview = path.match(/^\/(deposit|withdrawal)-requests\/([^/]+)\/(approve|reject)$/);
  if (req.method === 'POST' && requestReview) {
    const { note } = parseJson(await readRaw(req));
    return json(res, 200, reviewRequest(db, { type: requestReview[1], requestId: decodeURIComponent(requestReview[2]), approve: requestReview[3] === 'approve', adminId: admin.id, adminName: admin.username, note }));
  }
  if (req.method === 'GET' && path === '/transactions') {
    const q = url.searchParams;
    return json(res, 200, { transactions: listTransactions(db, { player: q.get('player') ?? '', kind: q.get('kind') ?? '', from: q.get('from') ?? '', to: q.get('to') ?? '' }) });
  }
  if (req.method === 'GET' && path === '/rounds') {
    const { status, body } = await operatorRounds();
    if (status !== 200) return fail(res, 502, 'PROVIDER_UNAVAILABLE', body.error || '暂时无法读取游戏记录');
    const names = new Map(db.prepare('SELECT id, username FROM players').all().map((p) => [p.id, p.username]));
    return json(res, 200, { rounds: body.records.map((round) => ({ ...round, username: names.get(round.playerId) ?? null })) });
  }
  const roundReplay = path.match(/^\/rounds\/([\w-]+)\/replay$/);
  if (req.method === 'GET' && roundReplay) {
    const { status, body } = await operatorRounds(roundReplay[1]);
    if (status !== 200 && status !== 404) return fail(res, 502, 'PROVIDER_UNAVAILABLE', body.error || '暂时无法读取回放');
    return html(res, status, replayPage(status === 200 ? body.round : null, gameWebUrl, status === 200 ? body.replay : undefined));
  }
  if (req.method === 'GET' && path === '/reconciliation') return json(res, 200, { players: reconciliation(db) });
  if (req.method === 'GET' && path === '/faults') return json(res, 200, faultState());
  if (req.method === 'POST' && path === '/faults') return json(res, 200, setFault(String(parseJson(await readRaw(req)).kind ?? ''), admin.id));
  const playerMatch = path.match(/^\/players\/([^/]+)(?:\/(freeze|unfreeze|adjustment))?$/);
  if (playerMatch) {
    const playerId = decodeURIComponent(playerMatch[1]);
    const action = playerMatch[2];
    if (req.method === 'GET' && !action) return json(res, 200, playerDetail(db, playerId));
    if (req.method === 'POST' && action) {
      const input = parseJson(await readRaw(req));
      if (action === 'adjustment') return json(res, 200, manualAdjustment(db, { adminId: admin.id, playerId, amount: input.amount, reason: input.reason }));
      return json(res, 200, setPlayerStatus(db, { adminId: admin.id, playerId, status: action === 'freeze' ? 'frozen' : 'active', reason: input.reason }));
    }
  }
  return fail(res, 404, 'NOT_FOUND', '没有这个后台接口');
}

async function launch(playerId, res) {
  const player = db.prepare('SELECT id, username FROM players WHERE id = ?').get(playerId);
  if (!player) return html(res, 404, '没有这个玩家');
  try {
    const { status, body } = await signedPost(`${providerUrl}/provider/launch`, { operatorId, playerId: player.id, playerName: player.username, currency: 'DEMO' }, { secret, operatorId });
    if (status !== 200 || !body.gameUrl) throw new Error(body.error || `HTTP ${status}`);
    res.writeHead(302, { location: body.gameUrl }); res.end();
  } catch (error) { html(res, 502, `<meta charset="utf-8"><p>游戏服务器没有响应：${error.message}</p>`); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, role: 'platform', protocol: PLATFORM_PROTOCOL, operatorId });
    if (req.method === 'POST' && url.pathname === '/auth/register') {
      const player = await registerPlayer(db, parseJson(await readRaw(req)));
      return json(res, 201, { player: { id: player.id, username: player.username } });
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const player = await authenticatePlayer(db, parseJson(await readRaw(req)));
      setSessionCookie(res, sessions.create(player.id));
      return json(res, 200, { player });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      sessions.delete(cookieValue(req, 'platform_session'));
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/auth/me') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      return json(res, 200, { player });
    }
    if (req.method === 'GET' && url.pathname === '/games/wild-frontier/balance') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', 'Please log in');
      return json(res, 200, { playerId: player.id, balance: getWallet(db, player.id).balance, currency: 'DEMO' });
    }
    if (req.method === 'GET' && url.pathname === '/api/wallet') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      return json(res, 200, { playerId: player.id, ...getWallet(db, player.id), currency: 'DEMO' });
    }
    if (req.method === 'GET' && url.pathname === '/api/wallet/records') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      return json(res, 200, { records: walletRecords(player.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/deposit-requests') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      const { amount } = parseJson(await readRaw(req));
      const request = createDepositRequest(db, { playerId: player.id, requestNo: `deposit-${randomUUID()}`, amount });
      return json(res, 201, { request });
    }
    if (req.method === 'POST' && url.pathname === '/api/withdrawal-requests') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      const { amount } = parseJson(await readRaw(req));
      const request = createWithdrawalRequest(db, { playerId: player.id, requestNo: `withdrawal-${randomUUID()}`, amount });
      return json(res, 201, { request });
    }
    const launchMatch = req.method === 'POST' && url.pathname.match(/^\/games\/([\w-]+)\/launch$/);
    if (launchMatch) {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', 'Please log in');
      if (!PLATFORM_GAMES[launchMatch[1]]) return fail(res, 404, 'UNKNOWN_GAME', '没有这款游戏');
      return json(res, 200, await createLaunch(player.id, launchMatch[1]));
    }
    if (req.method === 'POST' && url.pathname === '/auth/password') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      await changePassword(db, { playerId: player.id, ...parseJson(await readRaw(req)) });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/game-records') {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      const { status, body } = await providerRounds(player.id);
      if (status !== 200) return fail(res, 502, 'PROVIDER_UNAVAILABLE', body.error || '暂时无法读取游戏记录');
      return json(res, 200, { records: body.records });
    }
    const replayMatch = url.pathname.match(/^\/api\/game-records\/([\w-]+)\/replay$/);
    if (req.method === 'GET' && replayMatch) {
      const player = currentPlayer(req);
      if (!player) return fail(res, 401, 'UNAUTHENTICATED', '请先登录');
      const { status, body } = await providerRounds(player.id, replayMatch[1]);
      if (status === 404) return fail(res, 404, 'ROUND_NOT_FOUND', '没有这个局号');
      if (status !== 200) return fail(res, 502, 'PROVIDER_UNAVAILABLE', body.error || '暂时无法读取回放');
      return html(res, 200, replayPage(body.round, gameWebUrl, body.replay));
    }
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, { location: 'http://127.0.0.1:4173/' }); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/launch') return launch(url.searchParams.get('player'), res);
    // await: errors thrown inside must reach the catch below instead of crashing the process.
    if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url);
    // Older back-office hooks (used by npm run check:provider) also need an admin session.
    if (url.pathname.startsWith('/admin/') && !currentAdmin(req)) return fail(res, 401, 'ADMIN_UNAUTHENTICATED', '请先以管理员身份登录');
    if (req.method === 'GET' && url.pathname === '/admin/state') return json(res, 200, state());
    if (req.method === 'POST' && url.pathname === '/admin/fault') {
      const form = new URLSearchParams(await readRaw(req)); const kind = form.get('kind');
      setFault(FAULT_KINDS[kind] ? kind : 'none', currentAdmin(req).id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/wallet/')) {
      const raw = await readRaw(req);
      if (req.headers['x-operator-id'] !== operatorId || !verify(raw, req.headers['x-signature'], secret)) return fail(res, 401, 'BAD_SIGNATURE', '签名不对，拒绝处理');
      const input = parseJson(raw); const action = url.pathname.slice('/wallet/'.length);
      if (action === 'refund') return walletRefund(res, input);
      if (['balance', 'bet', 'win'].includes(action)) return walletResponse(res, action, input);
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof LedgerError) {
      const status = error.code === 'USERNAME_TAKEN' ? 409 : error.code === 'PLAYER_FROZEN' ? 403 : error.code === 'LOGIN_RATE_LIMITED' ? 429 : error.code === 'INVALID_CREDENTIALS' ? 401 : error.code === 'PLAYER_NOT_FOUND' || error.code === 'REQUEST_NOT_FOUND' ? 404 : error.code === 'REQUEST_NOT_PENDING' ? 409 : 400;
      return fail(res, status, error.code, error.message);
    }
    json(res, 400, { code: 'BAD_REQUEST', error: error instanceof Error ? error.message : 'Bad request' });
  }
});
server.on('error', (error) => { if (error.code === 'EADDRINUSE') { console.log(`端口 ${port} 已被占用。`); process.exit(1); } throw error; });
server.listen(port, '127.0.0.1', () => console.log(`演示平台: http://127.0.0.1:${port}  平台编号 ${operatorId}`));
