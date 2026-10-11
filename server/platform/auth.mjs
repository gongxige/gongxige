import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { inTransaction } from './db.mjs';
import { LedgerError, createPlayer } from './ledger.mjs';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

const now = () => new Date().toISOString();
const validUsername = (value) => typeof value === 'string' && /^[\p{L}\p{N}_-]{3,32}$/u.test(value);
const validPassword = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 128;

export async function hashPassword(password) {
  if (!validPassword(password)) throw new LedgerError('INVALID_PASSWORD', '密码必须为 8 到 128 个字符');
  const salt = randomBytes(16).toString('base64url');
  const hash = (await scrypt(password, salt, KEY_LENGTH)).toString('base64url');
  return { salt, hash };
}

async function passwordMatches(password, salt, storedHash) {
  if (!validPassword(password) || !salt || !storedHash) return false;
  const actual = await scrypt(password, salt, KEY_LENGTH);
  const expected = Buffer.from(storedHash, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function registerPlayer(db, { username, password }) {
  if (!validUsername(username)) throw new LedgerError('INVALID_USERNAME', '用户名只能含 3-32 个字母、数字、下划线或连字符');
  const credentials = await hashPassword(password);
  try {
    // STEP-06 must be usable before the wallet top-up page arrives in STEP-07.
    // This is a ledger-backed virtual demo grant, never a real-money balance.
    const player = createPlayer(db, { username, initialCredit: 10_000 });
    db.prepare('UPDATE players SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
      .run(credentials.hash, credentials.salt, now(), player.id);
    return player;
  } catch (error) {
    if (error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed: players\.username/.test(String(error?.message))) throw new LedgerError('USERNAME_TAKEN', '用户名已存在');
    throw error;
  }
}

export async function authenticatePlayer(db, { username, password, clock = Date.now }) {
  const player = db.prepare('SELECT * FROM players WHERE username = ?').get(String(username ?? ''));
  if (!player) throw new LedgerError('INVALID_CREDENTIALS', '用户名或密码错误');
  if (player.status !== 'active') throw new LedgerError('PLAYER_FROZEN', '账号已冻结');
  if (player.login_locked_until && Date.parse(player.login_locked_until) > clock()) throw new LedgerError('LOGIN_RATE_LIMITED', '请稍后再试');
  if (!await passwordMatches(password, player.password_salt, player.password_hash)) {
    const failed = player.failed_login_count + 1;
    const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(clock() + LOGIN_LOCK_MS).toISOString() : null;
    db.prepare('UPDATE players SET failed_login_count = ?, login_locked_until = ?, updated_at = ? WHERE id = ?')
      .run(failed >= MAX_FAILED_LOGINS ? 0 : failed, lockedUntil, now(), player.id);
    throw new LedgerError(lockedUntil ? 'LOGIN_RATE_LIMITED' : 'INVALID_CREDENTIALS', lockedUntil ? '请稍后再试' : '用户名或密码错误');
  }
  db.prepare('UPDATE players SET failed_login_count = 0, login_locked_until = NULL, updated_at = ? WHERE id = ?').run(now(), player.id);
  return { id: player.id, username: player.username, status: player.status };
}

export async function changePassword(db, { playerId, currentPassword, newPassword }) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player || !await passwordMatches(currentPassword, player.password_salt, player.password_hash)) throw new LedgerError('INVALID_CREDENTIALS', '当前密码错误');
  const credentials = await hashPassword(newPassword);
  db.prepare('UPDATE players SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
    .run(credentials.hash, credentials.salt, now(), playerId);
}

export function createSessionStore() {
  const sessions = new Map();
  return {
    create(playerId) { const token = randomUUID(); sessions.set(token, playerId); return token; },
    get(token) { return sessions.get(token) ?? null; },
    delete(token) { sessions.delete(token); },
  };
}
