// Game server ("RGS", remote game server) in the role of a game provider.
// Results come from the game engine in src/engine (random reel stops → grid
// → evaluation). Money does NOT live here: players and balances belong to the
// operator (the casino platform). For every round this server asks the
// operator's wallet to take the bet and to pay the win, with signed,
// idempotent calls. Virtual credits only — see docs/PROVIDER_API.md.
//
//   operator  ──POST /provider/launch──▶  this server  (opens a session, returns the game URL)
//   browser   ──/api/session, /api/spin─▶  this server
//   this server ──POST /wallet/bet|win|refund|balance──▶ operator

import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_BETS, ENGINE_VERSION, computeRtp, isAllowedBet, replaySpin, spin } from './src/engine/index.ts';
import { json, parseJson, readRaw, signedPost, verify, writeJsonAtomic } from './server/http.mjs';
import { openRoundLog } from './server/rounds.mjs';

/** Bumped when the browser ↔ server or server ↔ operator protocol changes. */
export const SERVER_PROTOCOL = 'provider-v1';

const port = Number(process.env.API_PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const stateFile = process.env.STATE_FILE ?? 'game-server-state.json';
const statePath = join(dataDir, stateFile);
const roundLogPath = join(dataDir, stateFile.replace(/\.json$/, '') + '.rounds.jsonl');
const gameWebUrl = process.env.GAME_WEB_URL ?? `http://127.0.0.1:${process.env.WEB_PORT ?? 4173}`;
const lobbyUrl = process.env.OPERATOR_URL ?? `http://127.0.0.1:${process.env.OPERATOR_PORT ?? 8788}`;

// Operators allowed to use this game, each with its own shared secret and wallet address.
const OPERATORS = {
  [process.env.OPERATOR_ID ?? 'demo-operator']: { secret: process.env.OPERATOR_SECRET ?? 'local-demo-secret', walletUrl: `${lobbyUrl}/wallet` },
};

const theoreticalRtp = Math.round(computeRtp().total * 10000) / 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Immediate attempts for a wallet call (ms to wait before each). Later retries come from the pending queue. */
const RETRY_DELAYS = [0, 300, 1000];
/** The player is waiting on a bet, so it gets two short attempts; if both go unanswered the round is cancelled. */
const BET_DELAYS = [0, 300];
const BET_TIMEOUT_MS = 3000;

// ---------- state ----------
// sessions[token]         = { operatorId, playerId, playerName, createdAt }
// players["op:player"]    = { freeSpins, lastBalance }   freeSpins: null or { bet, remaining, played, totalWin, triggerRoundId }
// pending[]               = wallet calls that must still reach the operator (wins, refunds)
const defaultState = () => ({ settings: { maxWinMultiplier: 1000 }, sessions: {}, players: {}, pending: [] });
const state = existsSync(statePath) ? { ...defaultState(), ...JSON.parse(readFileSync(statePath, 'utf8')) } : defaultState();
const save = () => writeJsonAtomic(statePath, state);
const rounds = openRoundLog(roundLogPath);
const busy = new Set();

const playerKey = (s) => `${s.operatorId}:${s.playerId}`;
const playerState = (s) => (state.players[playerKey(s)] ??= { freeSpins: null, lastBalance: null });
const newRoundId = () => `R${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sessionFrom(token) {
  const session = token && state.sessions[token];
  if (!session || Date.now() - Date.parse(session.createdAt) > SESSION_TTL_MS) return null;
  return session;
}

// ---------- wallet client ----------
class WalletError extends Error {
  constructor(message, { status, code, definitive }) { super(message); Object.assign(this, { status, code, definitive }); }
}

/** One wallet call, retried on network errors, timeouts and 5xx. A 4xx answer is final. */
async function wallet(operatorId, action, payload, delays = RETRY_DELAYS, timeoutMs = 5000) {
  const operator = OPERATORS[operatorId];
  let lastError = null;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      const { status, body } = await signedPost(`${operator.walletUrl}/${action}`, payload, { secret: operator.secret, operatorId, timeoutMs });
      if (status === 200) return body;
      if (status < 500) throw new WalletError(body.error || `平台拒绝了请求（${status}）`, { status, code: body.code, definitive: true });
      lastError = new WalletError(body.error || `平台出错（${status}）`, { status, code: body.code, definitive: false });
    } catch (error) {
      if (error instanceof WalletError && error.definitive) throw error;
      lastError = error instanceof WalletError ? error : new WalletError(`平台没有响应（${error.name === 'TimeoutError' ? '超时' : error.message}）`, { definitive: false });
    }
  }
  throw lastError;
}

function remember(session, balance) {
  if (Number.isFinite(balance)) playerState(session).lastBalance = balance;
}

/** Queue a win or refund that could not be delivered yet; the loop below keeps trying. */
function queue(item) {
  state.pending.push({ ...item, attempts: 0, nextAt: Date.now() + 3000, lastError: item.lastError ?? null });
  save();
}

async function deliverPending() {
  const now = Date.now();
  for (const item of [...state.pending]) {
    if (item.nextAt > now) continue;
    try {
      const body = await wallet(item.operatorId, item.action, item.payload, [0]);
      state.pending = state.pending.filter((p) => p !== item);
      if (item.action === 'win') rounds.settle(item.payload.roundId, body.balance);
      remember(item, body.balance);
      console.log(`补发成功：${item.action} ${item.payload.transactionId}`);
    } catch (error) {
      item.attempts += 1;
      item.lastError = error.message;
      item.nextAt = Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(item.attempts, 4));
    }
    save();
  }
}
setInterval(() => { deliverPending().catch((e) => console.error(e)); }, 2000).unref();

// ---------- browser API ----------
function publicConfig() {
  return { title: 'Wild Frontier', mode: 'provider-demo', protocol: SERVER_PROTOCOL, engineVersion: ENGINE_VERSION, allowedBets: ALLOWED_BETS, theoreticalRtp, maxWinMultiplier: state.settings.maxWinMultiplier, lobbyUrl };
}

async function handleSession(session, res) {
  const player = playerState(session);
  try {
    const body = await wallet(session.operatorId, 'balance', { playerId: session.playerId });
    remember(session, body.balance);
    save();
    return json(res, 200, { playerName: session.playerName, credits: body.balance, freeSpins: player.freeSpins });
  } catch (error) {
    return json(res, 502, { error: `读取平台余额失败：${error.message}` });
  }
}

async function handleSpin(session, input, res) {
  const key = playerKey(session);
  if (busy.has(key)) return json(res, 409, { error: '上一局还在处理中。' });
  busy.add(key);
  try {
    const player = playerState(session);
    const free = player.freeSpins;
    // A free-spin round left over from older rules (a bet size that no longer exists) cannot be played.
    if (free && !isAllowedBet(free.bet)) player.freeSpins = null;
    const bet = player.freeSpins ? player.freeSpins.bet : Number(input.bet);
    if (!player.freeSpins && !isAllowedBet(bet)) return json(res, 400, { error: '无效投注档位。' });

    const roundId = newRoundId();
    const mode = player.freeSpins ? 'free' : 'base';
    const base = { operatorId: session.operatorId, playerId: session.playerId };

    // 1. Take the bet (paid spins only). Retries reuse the same transaction ID, so the operator charges at most once.
    let betTransactionId = null;
    if (mode === 'base') {
      betTransactionId = `${roundId}-bet`;
      try {
        const body = await wallet(session.operatorId, 'bet', { ...base, transactionId: betTransactionId, roundId, amount: bet, currency: 'DEMO' }, BET_DELAYS, BET_TIMEOUT_MS);
        remember(session, body.balance);
      } catch (error) {
        if (error.definitive) return json(res, error.status === 402 ? 402 : 400, { error: error.message, code: error.code });
        // We do not know whether the bet went through. Cancel it: the refund returns the money if it was taken.
        const refund = { action: 'refund', ...base, payload: { ...base, transactionId: `${roundId}-refund`, refTransactionId: betTransactionId, roundId } };
        try { const body = await wallet(session.operatorId, 'refund', refund.payload); remember(session, body.balance); } catch (refundError) { queue({ ...refund, lastError: refundError.message }); }
        save();
        return json(res, 502, { error: '平台没有及时确认扣款，本局已取消（如已扣款会自动退回）。', code: 'BET_UNCONFIRMED' });
      }
    }

    // 2. Decide the result.
    const maxWinMultiplier = state.settings.maxWinMultiplier;
    const outcome = spin(bet, randomInt, maxWinMultiplier, mode);

    let freeSpinsFinished = null;
    const triggerRoundId = player.freeSpins?.triggerRoundId ?? null;
    if (mode === 'free') {
      const fs = player.freeSpins;
      fs.remaining += outcome.freeSpinsAwarded - 1;
      fs.played += 1;
      fs.totalWin += outcome.payout;
      if (fs.remaining === 0) { freeSpinsFinished = { played: fs.played, totalWin: fs.totalWin }; player.freeSpins = null; }
    } else if (outcome.freeSpinsAwarded > 0) {
      player.freeSpins = { bet, remaining: outcome.freeSpinsAwarded, played: 0, totalWin: 0, triggerRoundId: roundId };
    }

    // 3. Record the round permanently before paying, so it exists even if the server stops right now.
    const winTransactionId = `${roundId}-win`;
    rounds.add({
      roundId, parentRoundId: mode === 'free' ? triggerRoundId : null, at: new Date().toISOString(),
      ...base, mode, bet, stops: outcome.stops, multipliers: outcome.multipliers,
      payout: outcome.payout, capped: outcome.capped, freeSpinsAwarded: outcome.freeSpinsAwarded,
      maxWinMultiplier, engineVersion: ENGINE_VERSION, betTransactionId, winTransactionId, status: 'win-pending',
    });

    // 4. Pay the win (a 0 win too: it tells the operator the round is closed).
    const winCall = { action: 'win', ...base, payload: { ...base, transactionId: winTransactionId, roundId, amount: outcome.payout, currency: 'DEMO' } };
    let settlementPending = false;
    try {
      const body = await wallet(session.operatorId, 'win', winCall.payload);
      remember(session, body.balance);
      rounds.settle(roundId, body.balance);
    } catch (error) {
      settlementPending = true;
      queue({ ...winCall, lastError: error.message });
      // Show the player what the balance will be once the win arrives.
      if (player.lastBalance !== null) player.lastBalance += outcome.payout;
    }
    save();

    const winningCells = [...new Set(outcome.wins.flatMap((win) => win.cells.map(({ reel, row }) => `${row}-${reel}`)))];
    return json(res, 200, {
      engineVersion: ENGINE_VERSION,
      roundId,
      mode: mode === 'free' ? 'free' : 'paid',
      bet,
      stops: outcome.stops,
      grid: outcome.grid,
      multipliers: outcome.multipliers,
      wins: outcome.wins,
      winningCells,
      payout: outcome.payout,
      capped: outcome.capped,
      credits: player.lastBalance,
      settlementPending,
      freeSpinsAwarded: outcome.freeSpinsAwarded,
      freeSpins: player.freeSpins,
      freeSpinsFinished,
    });
  } finally {
    busy.delete(key);
  }
}

// ---------- provider API (called by operators, signed) ----------
function handleLaunch(raw, req, res) {
  const operatorId = String(req.headers['x-operator-id'] ?? '');
  const operator = OPERATORS[operatorId];
  if (!operator || !verify(raw, req.headers['x-signature'], operator.secret)) return json(res, 401, { code: 'BAD_SIGNATURE', error: '签名不对，拒绝处理' });
  const input = parseJson(raw);
  if (!input.playerId) return json(res, 400, { code: 'BAD_REQUEST', error: '缺少 playerId' });
  // Drop expired sessions while we are here.
  for (const [token, s] of Object.entries(state.sessions)) if (Date.now() - Date.parse(s.createdAt) > SESSION_TTL_MS) delete state.sessions[token];
  const token = randomBytes(24).toString('base64url');
  state.sessions[token] = { operatorId, playerId: String(input.playerId), playerName: String(input.playerName ?? input.playerId), createdAt: new Date().toISOString() };
  save();
  return json(res, 200, { token, gameUrl: `${gameWebUrl}/?token=${token}`, expiresInSeconds: SESSION_TTL_MS / 1000 });
}

function handleRoundLookup(raw, req, res) {
  const operatorId = String(req.headers['x-operator-id'] ?? '');
  const operator = OPERATORS[operatorId];
  if (!operator || !verify(raw, req.headers['x-signature'], operator.secret)) return json(res, 401, { code: 'BAD_SIGNATURE', error: '签名不对，拒绝处理' });
  const { playerId, roundId } = parseJson(raw);
  if (!playerId) return json(res, 400, { code: 'BAD_REQUEST', error: '缺少 playerId' });
  const ownsRound = (round) => round && round.operatorId === operatorId && round.playerId === String(playerId);
  if (roundId) {
    const round = rounds.get(String(roundId));
    if (!ownsRound(round)) return json(res, 404, { error: '没有这个局号' });
    return json(res, 200, { round });
  }
  const records = rounds.list((round) => ownsRound(round)).map((round) => ({ roundId: round.roundId, at: round.at, bet: round.bet, payout: round.payout }));
  return json(res, 200, { records });
}

// ---------- server ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, protocol: SERVER_PROTOCOL, pending: state.pending.length });
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, publicConfig());
    if (req.method === 'POST' && url.pathname === '/provider/launch') return handleLaunch(await readRaw(req), req, res);
    if (req.method === 'POST' && url.pathname === '/provider/rounds') return handleRoundLookup(await readRaw(req), req, res);

    if (url.pathname === '/api/session' || url.pathname === '/api/spin') {
      const input = req.method === 'POST' ? parseJson(await readRaw(req)) : {};
      const session = sessionFrom(url.searchParams.get('token') ?? input.token);
      if (!session) return json(res, 401, { code: 'SESSION_INVALID', error: '游戏会话无效或已过期，请回到平台大厅重新进入游戏。', lobbyUrl });
      if (req.method === 'GET' && url.pathname === '/api/session') return handleSession(session, res);
      if (req.method === 'POST' && url.pathname === '/api/spin') return handleSpin(session, input, res);
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : 'Bad request' });
  }
});

// Port already taken: usually an API started earlier is still running.
// Say whether it is up to date and how to stop it, instead of a stack trace.
server.on('error', async (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  const running = await fetch(`http://127.0.0.1:${port}/api/config`).then((r) => r.json()).catch(() => null);
  if (running?.engineVersion === ENGINE_VERSION && running?.protocol === SERVER_PROTOCOL) {
    console.log(`端口 ${port} 上已经有一个最新版本的游戏服务器在运行，不需要再启动。`);
  } else {
    console.log(`端口 ${port} 被${running ? '旧版本的游戏服务器' : '其他程序'}占用。`);
    console.log('在 PowerShell 里运行下面这行把它关掉，然后重新运行：');
    console.log(`  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => console.log(`游戏服务器: http://127.0.0.1:${port}  (理论 RTP ${theoreticalRtp}%, engine ${ENGINE_VERSION}, ${SERVER_PROTOCOL})  平台钱包: ${lobbyUrl}/wallet`));
