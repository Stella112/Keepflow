/**
 * Minimal structured logger. CRITICAL: this logger must never be given request
 * bodies, incident descriptions, or anything that could contain a secret. Call
 * sites pass only non-sensitive fields (method, path, status, latency,
 * classification method, evaluation warnings, incident type).
 */

type Fields = Record<string, string | number | boolean | undefined | string[]>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  // Single-line JSON to stdout — friendly to log collectors.
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(line));
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit('info', event, fields),
  warn: (event: string, fields: Fields = {}) => emit('warn', event, fields),
  error: (event: string, fields: Fields = {}) => emit('error', event, fields),
};
