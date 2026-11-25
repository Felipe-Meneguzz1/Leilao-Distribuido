'use strict';

const { DatabaseSync } = require('node:sqlite');
const { randomBytes, createHash, scryptSync, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const path = require('node:path');
const derive = promisify(scrypt);
const SESSION_SECONDS = 8 * 60 * 60;
const COOKIE = 'atrio_session';
const fail = (status, message) => Object.assign(new Error(message), { status });
const hashToken = token => createHash('sha256').update(token).digest('hex');
const emailOf = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validPassword = password => typeof password === 'string' && password.length >= 8 && password.length <= 128;
const publicUser = row => ({ id: row.id, name: row.name, email: row.email, role: row.role });

function createAuth(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'auth.sqlite'));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'client')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  const insert = db.prepare('INSERT INTO users (name, email, salt, password_hash, role) VALUES (?, ?, ?, ?, ?)');
  const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  if (!db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) {
    const email = emailOf(process.env.ADMIN_EMAIL || 'admin@atrio.local');
    const password = process.env.ADMIN_PASSWORD;
    if (!validEmail(email) || !validPassword(password)) {
      throw new Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD (8 a 128 caracteres) para criar o administrador inicial.');
    }
    const salt = randomBytes(16).toString('hex');
    insert.run('Administrador', email, salt, scryptSync(password, salt, 64).toString('hex'), 'admin');
  }
  const attempts = new Map();
  function limit(req) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.socket.remoteAddress || 'local';
    if (!attempts.has(key)) attempts.set(key, { count: 0, until: now + 5 * 60 * 1000 });
    if (++attempts.get(key).count > 40) throw fail(429, 'Muitas tentativas. Aguarde alguns minutos.');
  }
  function cookieToken(req) {
    const match = (req.headers.cookie || '').match(/(?:^|;\s*)atrio_session=([a-f0-9]{64})(?:;|$)/);
    return match?.[1];
  }
  function cookie(res, token, age) {
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`);
  }
  function revoke(req) {
    const token = cookieToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  function session(req, res, user) {
    revoke(req);
    const now = Math.floor(Date.now() / 1000);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), user.id, now + SESSION_SECONDS);
    cookie(res, token, SESSION_SECONDS);
    return { user: publicUser(user) };
  }
  function current(req) {
    const token = cookieToken(req);
    if (!token) throw fail(401, 'Faça login para continuar.');
    const user = db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?').get(hashToken(token), Math.floor(Date.now() / 1000));
    if (!user) throw fail(401, 'Sessão expirada. Faça login novamente.');
    return publicUser(user);
  }
  async function register(req, res, body) {
    limit(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = emailOf(body?.email);
    if (name.length < 2 || name.length > 60 || /[\x00-\x1f\x7f]/.test(name) || !validEmail(email) || !validPassword(body?.password)) {
      throw fail(400, 'Informe nome (2 a 60 caracteres), e-mail válido e senha (8 a 128 caracteres).');
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await derive(body.password, salt, 64)).toString('hex');
    try {
      const result = insert.run(name, email, salt, passwordHash, 'client');
      return session(req, res, byId.get(result.lastInsertRowid));
    } catch (err) {
      if (err.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message)) throw fail(409, 'Nome ou e-mail já cadastrado.');
      throw err;
    }
  }
  async function login(req, res, body) {
    limit(req);
    const email = emailOf(body?.email);
    if (!validEmail(email) || !validPassword(body?.password)) throw fail(401, 'E-mail ou senha inválidos.');
    const user = byEmail.get(email);
    const candidate = await derive(body.password, user?.salt || 'atrio-dummy-salt', 64);
    const expected = Buffer.from(user?.password_hash || '0'.repeat(128), 'hex');
    if (!user || !timingSafeEqual(candidate, expected)) throw fail(401, 'E-mail ou senha inválidos.');
    return session(req, res, user);
  }
  function logout(req, res) {
    revoke(req);
    cookie(res, '', 0);
    return { ok: true };
  }
  return { register, login, logout, current };
}

function validateOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Origem não autorizada.');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw fail(403, 'Origem não autorizada.'); }
    if (origin.host !== req.headers.host) throw fail(403, 'Origem não autorizada.');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Envie JSON.');
}

module.exports = { createAuth, validateOrigin };
