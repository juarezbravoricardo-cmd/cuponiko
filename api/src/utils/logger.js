'use strict';

/**
 * Logger minimalista JSON — fácil de parsear en Railway.
 */

const levels = ['debug', 'info', 'warn', 'error'];

function log(level, msg, meta) {
  const rec = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta || {}),
  };
  const fn = level === 'error' ? console.error : console.log;
  fn(JSON.stringify(rec));
}

const logger = Object.fromEntries(
  levels.map((lvl) => [lvl, (msg, meta) => log(lvl, msg, meta)])
);

module.exports = logger;
