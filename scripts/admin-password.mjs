// npm run admin:password — forgot the back-office password? This gives the
// "admin" account a new random password (creating the account if there is none)
// and prints it once. Uses the same data folder as the platform (DATA_DIR, default ./data).

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { openPlatformDatabase } from '../server/platform/db.mjs';
import { hashPassword } from '../server/platform/auth.mjs';
import { ensureInitialAdmin } from '../server/platform/admin.mjs';

const file = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), process.env.PLATFORM_DB_FILE ?? 'platform.sqlite');
const db = openPlatformDatabase(file);
const password = randomBytes(12).toString('base64url');
if (!await ensureInitialAdmin(db, { password })) {
  const credentials = await hashPassword(password);
  db.prepare('UPDATE admins SET password_hash = ?, password_salt = ?, failed_login_count = 0, login_locked_until = NULL, updated_at = ? WHERE username = ?')
    .run(credentials.hash, credentials.salt, new Date().toISOString(), 'admin');
}
db.close();
console.log(`管理员 admin 的新密码：${password}（只显示这一次，请记下来）`);
console.log('新密码立即生效（平台服务不用重启）；已经登录的后台页面不受影响。');
