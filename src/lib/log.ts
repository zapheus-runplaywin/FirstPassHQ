import { AppState, Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * The app's own log, kept on the device in <documents>/logs. app.log is the
 * newest file; when it reaches 20 MB it becomes app.1.log, app.1.log becomes
 * app.2.log and so on, and app.9.log is deleted, so the log never holds more
 * than 10 files or 200 MB. Every line also goes to the console in
 * development. On the web there's no file system, so it's console only.
 *
 * Never log tokens, passwords or anything about a person (names, emails,
 * dates of birth, health): keys that look like them are replaced with
 * "[redacted]", but log counts and ids rather than relying on that.
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;
const FLUSH_MS = 1000;

type Level = 'debug' | 'info' | 'warn' | 'error';
type Data = Record<string, unknown>;

const SECRET_KEY =
  /token|secret|password|passwd|authorization|cookie|apikey|api_key|email|phone|name|birth|dob|address|medical|note/i;
// Keys that look personal but aren't: ids and counts, and PlayHQ's names for
// competitions and grades.
const SAFE_KEY = /_?id$|count$|^(competition|grade|round|season)(_?name)?$/i;

const writesToFile = Platform.OS !== 'web';
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let directory: Directory | null = null;
let currentSize: number | null = null;

function logFile(index: number) {
  return new File(directory!, index === 0 ? 'app.log' : `app.${index}.log`);
}

/** A copy of `value` with personal and secret keys replaced; crash reports use it too. */
export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { error: value.name, message: value.message };
  if (value === null || typeof value !== 'object') return value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Data).map(([key, v]) => [
      key,
      SECRET_KEY.test(key) && !SAFE_KEY.test(key) ? '[redacted]' : redact(v, depth + 1),
    ]),
  );
}

function format(level: Level, scope: string, message: string, data?: Data) {
  let extra = '';
  if (data) {
    try {
      extra = ` ${JSON.stringify(redact(data))}`;
    } catch {
      extra = ' [unserialisable data]';
    }
  }
  return `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra}`;
}

/** app.log → app.1.log → … → app.9.log, dropping the oldest. */
function rotate() {
  const oldest = logFile(MAX_FILES - 1);
  if (oldest.exists) oldest.delete();
  for (let i = MAX_FILES - 2; i >= 0; i--) {
    const file = logFile(i);
    if (file.exists) file.moveSync(logFile(i + 1));
  }
  currentSize = 0;
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!writesToFile || pending.length === 0) return;
  const text = pending.join('\n') + '\n';
  pending = [];
  try {
    if (!directory) {
      directory = new Directory(Paths.document, 'logs');
      directory.create({ idempotent: true, intermediates: true });
    }
    const file = logFile(0);
    if (currentSize === null) currentSize = file.exists ? (file.size ?? 0) : 0;
    // Close enough for ASCII-heavy logs; a multi-byte line can only push a
    // file a little past the limit.
    if (currentSize > 0 && currentSize + text.length > MAX_FILE_BYTES) rotate();
    if (!file.exists) file.create();
    file.writeSync(text, { append: true });
    currentSize += text.length;
  } catch (e) {
    // A full disk shouldn't break the app; the console still has the lines.
    console.warn('Couldn’t write the app log', e);
    currentSize = null;
  }
}

function write(level: Level, scope: string, message: string, data?: Data) {
  const line = format(level, scope, message, data);
  if (__DEV__ || level === 'error') {
    (level === 'debug' ? console.log : console[level])(line);
  }
  if (!writesToFile) return;
  pending.push(line);
  if (level === 'error') flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** A logger whose lines are tagged with `scope`, such as "fixtures". */
export function logger(scope: string) {
  return {
    debug: (message: string, data?: Data) => write('debug', scope, message, data),
    info: (message: string, data?: Data) => write('info', scope, message, data),
    warn: (message: string, data?: Data) => write('warn', scope, message, data),
    error: (message: string, data?: Data) => write('error', scope, message, data),
  };
}

/** Writes anything waiting, such as before the app goes to the background. */
export const flushLog = flush;

/** The log files on this device, newest first, for sharing with support. */
export function logFiles(): File[] {
  if (!writesToFile) return [];
  flush();
  directory ??= new Directory(Paths.document, 'logs');
  return Array.from({ length: MAX_FILES }, (_, i) => logFile(i)).filter((f) => f.exists);
}

/** How much of the log "Send app log" shares: the newest 5 MB. */
export const SHARE_BYTES = 5 * 1024 * 1024;
export const SHARED_LOG_NAME = 'firstpass-hq-app-log.txt';

/**
 * One file holding the newest part of the log (at most SHARE_BYTES, oldest
 * line first), for "Send app log" in Your details. It is written to the app's
 * cache and goes only where the member sends it. Null when there's no log,
 * as on the web.
 */
export function shareableLog(): File | null {
  const files = logFiles();
  if (files.length === 0) return null;
  const parts: string[] = [];
  let size = 0;
  for (const file of files) {
    const text = file.textSync();
    parts.unshift(text);
    size += text.length;
    if (size >= SHARE_BYTES) break;
  }
  let text = parts.join('');
  if (text.length > SHARE_BYTES) {
    // Start at a whole line.
    const cut = text.length - SHARE_BYTES;
    const next = text.indexOf('\n', cut);
    text = text.slice(next === -1 ? cut : next + 1);
  }
  const out = new File(Paths.cache, SHARED_LOG_NAME);
  if (out.exists) out.delete();
  out.create();
  out.writeSync(text);
  return out;
}

const appLog = logger('app');
let started = false;

/** Logs the start of the app and any crash, and flushes when it's put away. */
export function startAppLog(details: Data) {
  if (started) return;
  started = true;
  appLog.info('App started', { platform: Platform.OS, ...details });
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') flush();
  });
  const errors = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (errors) {
    const previous = errors.getGlobalHandler();
    errors.setGlobalHandler((error, isFatal) => {
      appLog.error(isFatal ? 'Crash' : 'Uncaught error', {
        error,
        stack: error instanceof Error ? error.stack?.split('\n').slice(0, 8).join(' | ') : null,
      });
      previous(error, isFatal);
    });
  }
}

type ErrorUtilsLike = {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
};
