'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const MIN = DEBUG ? LEVELS.debug : LEVELS.info;

function emit(level, msg, meta) {
  if (LEVELS[level] < MIN) return;
  const ts = new Date().toISOString().slice(11, 23);
  const tag = `[${ts}][${level.toUpperCase()[0]}]`;
  const extra = meta ? ' ' + safeStr(meta) : '';
  (level === 'error' ? console.error : console.log)(`${tag} ${msg}${extra}`);
}

function safeStr(meta) {
  try { return JSON.stringify(meta); } catch { return '[unserializable]'; }
}

module.exports = {
  debug: (m, x) => emit('debug', m, x),
  info:  (m, x) => emit('info',  m, x),
  warn:  (m, x) => emit('warn',  m, x),
  error: (m, x) => emit('error', m, x),
  isDebug: DEBUG,
};