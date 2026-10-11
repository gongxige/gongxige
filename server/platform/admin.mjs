// Back office: admin accounts (separate from players), overview numbers,
// player lookup and the admin audit log. Money changes live in ledger.mjs.
import { randomBytes, randomUUID } from 'node:crypto';
import { inTransaction } from './db.mjs';
import { LOGIN_LOCK_MS, MAX_FAILED_LOGINS, hashPassword, passwordMatches } from './auth.mjs';
import { LedgerError, getWallet, reconcilePlayer, writeAuditLog } from './ledger.mjs';

const now = () => new Date().toISOString();

/**
 * Creates the first admin when there is none. Returns the generated password
 * (to print once in the terminal), or null when an admin exists or the password
 * came from the caller (ADMIN_PASSWORD, used by tests and checks).
 */
export async function ensureInitialAdmin(db, { username = 'admin', password } = {}) {
  if (db.prepare('SELECT COUNT(*) AS count FROM admins').get().count > 0) return null;
  const generated = password ? null : randomBytes(12).toString('base64url');
  const credentials = await hashPassword(password ?? generated);
  const timestamp = now();
  db.prepare('INSERT INTO admins (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), username, credentials.hash, credentials.salt, timestamp, timestamp);
  return generated;
}

export async function authenticateAdmin(db, { username, password, clock = Date.now }) {
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username ?? ''));
  if (!admin) throw new LedgerError('INVALID_CREDENTIALS', '用户名或密码错误');
  if (admin.login_locked_until && Date.parse(admin.login_locked_until) > clock()) throw new LedgerError('LOGIN_RATE_LIMITED', '请稍后再试');
  if (!await passwordMatches(password, admin.password_salt, admin.password_hash)) {
    const failed = admin.failed_login_count + 1;
    const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(clock() + LOGIN_LOCK_MS).toISOString() : null;
    db.prepare('UPDATE admins SET failed_login_count = ?, login_locked_until = ?, updated_at = ? WHERE id = ?')
      .run(failed >= MAX_FAILED_LOGINS ? 0 : failed, lockedUntil, now(), admin.id);
    throw new LedgerError(lockedUntil ? 'LOGIN_RATE_LIMITED' : 'INVALID_CREDENTIALS', lockedUntil ? '请稍后再试' : '用户名或密码错误');
  }
  return inTransaction(db, () => {
    db.prepare('UPDATE admins SET failed_login_count = 0, login_locked_until = NULL, updated_at = ? WHERE id = ?').run(now(), admin.id);
    writeAuditLog(db, { adminId: admin.id, action: 'login', targetType: 'admin', targetId: admin.id });
    return { id: admin.id, username: admin.username };
  });
}

export function recordAdminLogout(db, adminId) {
  inTransaction(db, () => writeAuditLog(db, { adminId, action: 'logout', targetType: 'admin', targetId: adminId }));
}

export const getAdmin = (db, adminId) => db.prepare('SELECT id, username FROM admins WHERE id = ?').get(adminId) ?? null;

/** Start of the local calendar day, as an ISO timestamp comparable with created_at. */
export function startOfToday(clock = Date.now) {
  const day = new Date(clock());
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}

export function overview(db, { since = startOfToday() } = {}) {
  const sum = (kind, extra = '') => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE kind = ? AND created_at >= ? ${extra}`).get(kind, since).total;
  // A refunded bet never happened for the platform's books.
  const bets = sum('bet', "AND status <> 'refunded'");
  const wins = sum('win');
  return {
    since,
    players: db.prepare('SELECT COUNT(*) AS count FROM players').get().count,
    frozenPlayers: db.prepare("SELECT COUNT(*) AS count FROM players WHERE status = 'frozen'").get().count,
    depositsApproved: sum('deposit_approved'),
    withdrawalsApproved: sum('withdrawal_approved'),
    bets,
    wins,
    platformProfit: bets - wins,
  };
}

export function listPlayers(db, { query = '' } = {}) {
  const pattern = `%${String(query).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(`SELECT p.id, p.username, p.status, p.created_at AS createdAt, w.balance, w.frozen_balance AS frozenBalance
    FROM players p JOIN wallets w ON w.player_id = p.id
    WHERE p.username LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\'
    ORDER BY p.created_at DESC LIMIT 200`).all(pattern, pattern);
}

export function playerDetail(db, playerId) {
  const player = db.prepare('SELECT id, username, status, created_at AS createdAt FROM players WHERE id = ?').get(playerId);
  if (!player) throw new LedgerError('PLAYER_NOT_FOUND', '玩家不存在');
  const reconciliation = reconcilePlayer(db, playerId);
  const ledger = db.prepare(`SELECT transaction_id AS transactionId, kind, amount, balance_delta AS balanceDelta, frozen_delta AS frozenDelta,
      balance_after AS balanceAfter, status, round_id AS roundId, reason, created_at AS createdAt
    FROM ledger_entries WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(playerId);
  return { player, wallet: getWallet(db, playerId), reconciled: reconciliation.balanceMatches && reconciliation.frozenMatches, ledger };
}

export function listAuditLogs(db, { limit = 200 } = {}) {
  return db.prepare(`SELECT l.id, l.action, l.target_type AS targetType, l.target_id AS targetId, l.reason, l.details_json AS details,
      l.created_at AS createdAt, a.username AS admin
    FROM admin_audit_logs l JOIN admins a ON a.id = l.admin_id
    ORDER BY l.created_at DESC, l.rowid DESC LIMIT ?`).all(Math.min(Math.max(Number(limit) || 200, 1), 500))
    .map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}
