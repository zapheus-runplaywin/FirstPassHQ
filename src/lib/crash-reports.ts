import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { redact } from '@/lib/log';

/**
 * Crash reports, sent to Sentry's EU data centre (docs/data-handling.md,
 * "Crash reports"). Off unless the build has EXPO_PUBLIC_SENTRY_DSN, and never
 * in Expo Go, on the web, in development or in tests. A build can only have
 * the address together with SENTRY_AUTH_TOKEN: scripts/check-build-settings.js
 * stops a build, and scripts/publish-update.sh an update, with one but not the
 * other.
 *
 * Reports from the app's own code (JavaScript errors, "Something went
 * wrong") pass through scrubReport before they leave the phone: only the
 * fields listed in KEPT are kept; every text passes through scrubText (emails,
 * ids, dates, long numbers, quoted text, tokens, web addresses' queries, and
 * the signed-in member's own name and email are removed) and error messages
 * also through scrubNames. There are no breadcrumbs, screenshots, request
 * details, extra details or member id. The only id is a random one made for
 * this install, so repeat crashes from one phone group together without saying
 * whose phone it is.
 *
 * A crash in the phone's native code is different: Sentry's native part sends
 * it the next time the app opens, and Sentry's React Native SDK does not pass
 * native events through beforeSend ("Filtering" in Sentry's React Native
 * docs). So those reports are limited only by the options below: no
 * breadcrumbs (maxBreadcrumbs reaches the native part too), sendDefaultPii off
 * (no IP address or phone name), no screenshots or view hierarchy. They carry
 * the native crash's reason and stack, the phone and app details, the tags set
 * here and the install id. Sentry's server-side scrubbers and "Prevent storing
 * of IP addresses" (docs/beta-builds.md, "Crash reports") cover them too.
 */

/** Sentry's EU addresses look like https://<key>@o<number>.ingest.de.sentry.io/<number>. */
const EU_DSN = /^https:\/\/[0-9a-f]{32}@o\d+\.ingest\.de\.sentry\.io\/\d+$/;

/** Whether `dsn` is a Sentry address in the EU data centre. */
export function isEuDsn(dsn: string | undefined | null): dsn is string {
  return !!dsn && EU_DSN.test(dsn.trim());
}

type Where = {
  dsn: string | undefined;
  platform: string;
  /** expo-constants' executionEnvironment: "storeClient" is Expo Go. */
  executionEnvironment: string | undefined;
  isDev: boolean;
};

/** The address to send reports to, or null when this copy of the app sends none. */
export function crashReportAddress({ dsn, platform, executionEnvironment, isDev }: Where) {
  if (isDev) return null;
  if (platform !== 'ios' && platform !== 'android') return null;
  if (executionEnvironment === 'storeClient') return null;
  return isEuDsn(dsn) ? dsn.trim() : null;
}

// ---------------------------------------------------------------------------
// Scrubbing

let personalValues: RegExp | null = null;

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remembers the signed-in member's own name, preferred name and emails, in
 * memory only, so scrubText removes them wherever they turn up. Call it with
 * nothing to forget them.
 */
export function rememberPersonalValues(values: (string | null | undefined)[] = []) {
  const words = new Set<string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    words.add(text);
    // Each part of a name on its own too, such as a first name in a message.
    for (const part of text.split(/[\s@.,]+/)) if (part.length >= 3) words.add(part);
  }
  const sorted = [...words].sort((a, b) => b.length - a.length).map(escape);
  personalValues = sorted.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
}

/**
 * A copy of `text` with anything that could be about a person removed: the
 * signed-in member's name and email, emails, tokens, ids, dates, long numbers,
 * web addresses' queries, quoted text and the values in database error
 * details, such as `Key (email)=(…)`.
 */
export function scrubText(text: string): string {
  let out = text;
  if (personalValues) out = out.replace(personalValues, '[personal]');
  return out
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/\b(?:sb_secret|sb_publishable|sntrys|sntryu)_[\w-]+/g, '[token]')
    .replace(/(?:Bearer|apikey)\s+\S+/gi, '[token]')
    .replace(/[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[^\s@"'<>()[\]{},;:]+/g, '[email]')
    .replace(/\?[^\s"'<>]*/g, '?[query]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g, '[date]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
    .replace(/\d{4,}/g, '[number]')
    .replace(/=\([^)]*\)/g, '=(…)')
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu, '"…"')
    .slice(0, 1000);
}

/**
 * Words an error message may start or use that are not names. Any other word
 * with a capital letter followed by small letters, such as "Priya" in "Check
 * the phone number for Priya", is taken out of error messages: the database
 * can name another member in an error, and the scrubber only knows the
 * signed-in member's own name. Identifiers such as TypeError or useAuth are
 * left alone.
 */
const COMMON_WORDS = new Set(
  (
    'a an the this that these those it its is are was were be been you your you\'ve you\'re we our they their ' +
    'he she his her there here what which who when where why how not no none nothing all any some each every ' +
    'and or but if then else for from to of on in at by with without into onto about after before again ' +
    'cannot can can\'t could couldn\'t would wouldn\'t should shouldn\'t must may might will won\'t do does ' +
    'did don\'t doesn\'t didn\'t has have had hasn\'t haven\'t isn\'t aren\'t wasn\'t weren\'t only also too ' +
    'error errors exception failed failure fatal invalid invariant violation unexpected unhandled unknown ' +
    'unable missing maximum minimum rendered render rendering component components element elements hook ' +
    'hooks objects object array string number boolean function undefined null value values property ' +
    'properties key keys type types promise rejection network request requests response fetch timeout ' +
    'timed load loading loaded save saving saved upload uploading download downloading attempt attempted ' +
    'tried try retry check checking please text view image images screen screens route routes navigation ' +
    'navigator module modules native bridge react hermes expo supabase sentry json http https api app ' +
    'apps file files folder storage database row rows column columns table tables query permission ' +
    'permissions denied refused allowed access token session sign signed signing out log logged member ' +
    'members club clubs team teams squad squads coach athlete guardian admin admins committee message ' +
    'messages survey surveys injury injuries already named name names add added remove removed open closed ' +
    'new old first last next previous one two three up down left right yes ok'
  ).split(' '),
);

/** Error message words that look like names taken out (see COMMON_WORDS). */
export function scrubNames(text: string): string {
  // A capital, small letters, and parts joined by an apostrophe or hyphen (O’Brien, Mary-Jane).
  const word = /(?<![\p{L}\p{N}_$.])\p{Lu}\p{Ll}*(?:['’-]\p{Lu}?\p{Ll}+)*(?![\p{L}\p{N}_$])/gu;
  return text.replace(word, (found) =>
    found.length < 2 || COMMON_WORDS.has(found.toLowerCase().replace(/’/g, "'")) ? found : '[name]',
  );
}

/** An error's message: scrubText, then anything that looks like a name taken out. */
function scrubMessage(text: string) {
  return scrubNames(scrubText(text));
}

/** Every string in `value` scrubbed, and every personal key redacted (the app log's rule). */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubDeep(v, depth + 1));
  const redacted = redact(value) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(redacted).map(([key, v]) => [key, scrubDeep(v, depth + 1)]),
  );
}

type Report = Record<string, unknown>;

function pick(source: unknown, keys: readonly string[]): Report {
  if (!source || typeof source !== 'object') return {};
  const out: Report = {};
  for (const key of keys) {
    const v = (source as Report)[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** The parts of a report that are kept. Everything else is dropped. */
export const KEPT = {
  /** Top-level fields sent as they are: ids of the report and of the code, never of a person. */
  asIs: ['event_id', 'timestamp', 'level', 'platform', 'release', 'dist', 'environment', 'sdk', 'type', 'debug_meta', 'fingerprint'],
  /** Phone and app details, with any name or identifier in them dropped. */
  contexts: { device: ['family', 'model', 'model_id', 'arch', 'simulator', 'memory_size', 'free_memory', 'orientation', 'manufacturer', 'brand', 'screen_density', 'screen_height_pixels', 'screen_width_pixels', 'low_memory'], os: ['name', 'version', 'build', 'kernel_version', 'rooted'], app: ['app_identifier', 'app_name', 'app_version', 'app_build', 'app_start_time', 'in_foreground', 'build_type'], runtime: ['name', 'version'], react_native_context: ['js_engine', 'turbo_module', 'fabric', 'expo', 'react_native_version', 'hermes_version', 'hermes_debug_info', 'expo_go_version'], react: ['componentStack'] },
  /** Tags set by this file or by the Sentry SDK about the code that ran. */
  tags: ['build', 'commit', 'update', 'channel', 'screen', 'event.origin', 'event.environment'],
} as const;

/** A stack frame with its local variables dropped. */
function frame(f: unknown) {
  return pick(f, ['filename', 'abs_path', 'function', 'module', 'lineno', 'colno', 'in_app', 'platform', 'instruction_addr', 'package', 'symbol_addr', 'image_addr', 'debug_id']);
}

function stacktrace(s: unknown) {
  if (!s || typeof s !== 'object') return undefined;
  const frames = (s as Report).frames;
  return { frames: Array.isArray(frames) ? frames.map(frame) : [] };
}

/**
 * The report that is sent in place of `event`: only the KEPT fields, with
 * every text scrubbed. `installId` is the random id of this install.
 */
export function scrubReport<T extends object>(event: T, installId: string | null): T {
  const e = event as Report;
  const out: Report = pick(e, KEPT.asIs);

  const exception = e.exception as { values?: unknown[] } | undefined;
  if (exception && Array.isArray(exception.values)) {
    out.exception = {
      values: exception.values.map((v) => {
        const value = v as Report;
        const mechanism = value.mechanism as Report | undefined;
        return {
          ...(typeof value.type === 'string' ? { type: scrubText(value.type) } : {}),
          ...(typeof value.value === 'string' ? { value: scrubMessage(value.value) } : {}),
          ...(value.stacktrace ? { stacktrace: stacktrace(value.stacktrace) } : {}),
          ...(mechanism ? { mechanism: pick(mechanism, ['type', 'handled', 'synthetic', 'exception_id', 'parent_id', 'source', 'is_exception_group']) } : {}),
        };
      }),
    };
  }
  const threads = e.threads as { values?: unknown[] } | undefined;
  if (threads && Array.isArray(threads.values)) {
    out.threads = {
      values: threads.values.map((t) => ({
        ...pick(t, ['id', 'crashed', 'current', 'main']),
        ...((t as Report).stacktrace ? { stacktrace: stacktrace((t as Report).stacktrace) } : {}),
      })),
    };
  }

  if (typeof e.message === 'string') out.message = scrubMessage(e.message);
  const logentry = e.logentry as Report | undefined;
  if (logentry && typeof logentry.message === 'string') {
    out.logentry = { message: scrubMessage(logentry.message) };
  }

  const contexts: Report = {};
  for (const [name, keys] of Object.entries(KEPT.contexts)) {
    const kept = pick((e.contexts as Report | undefined)?.[name], keys);
    if (Object.keys(kept).length) contexts[name] = name === 'react' ? scrubDeep(kept) : kept;
  }
  out.contexts = contexts;

  const tags: Report = {};
  for (const key of KEPT.tags) {
    const v = (e.tags as Report | undefined)?.[key];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      tags[key] = key === 'screen' ? scrubText(String(v)) : v;
    }
  }
  out.tags = tags;

  // No extra details: the app sets none, and Sentry puts a captured object's
  // own fields there (such as a database error's message, which can name someone).
  out.breadcrumbs = [];
  out.user = installId ? { id: installId } : {};
  return out as T;
}

// ---------------------------------------------------------------------------
// Starting

const INSTALL_ID_KEY = 'crash-reports.install-id';
let installId: string | null = null;
let started = false;

/** This install's random id, made the first time. Never a member id. */
async function loadInstallId() {
  try {
    const saved = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (saved) return saved;
    const made = Crypto.randomUUID();
    await AsyncStorage.setItem(INSTALL_ID_KEY, made);
    return made;
  } catch {
    return null;
  }
}

type StartDetails = Omit<Where, 'platform'> & {
  platform?: string;
  version: { build: number | null; commit: string | null; updateId: string | null };
  channel: string | null;
};

/** Starts crash reports if this copy of the app sends them. Returns whether it did. */
export function startCrashReports(details: StartDetails): boolean {
  if (started) return true;
  const dsn = crashReportAddress({ ...details, platform: details.platform ?? Platform.OS });
  if (!dsn) return false;
  started = true;
  Sentry.init({
    dsn,
    environment: details.channel ?? 'unknown',
    sendDefaultPii: false,
    // No breadcrumbs anywhere, in the app or in the phone's own part of Sentry:
    // they can hold web addresses with ids in them.
    maxBreadcrumbs: 0,
    enableNetworkBreadcrumbs: false,
    enableNetworkEventBreadcrumbs: false,
    enableAutoSessionTracking: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    reportAccessibilityIdentifier: false,
    enableCaptureFailedRequests: false,
    enableLogs: false,
    integrations: (defaults) =>
      defaults.filter((i) => !['Breadcrumbs', 'HttpContext', 'ModulesLoader', 'ExpoConstants'].includes(i.name)),
    beforeSend: (event) => scrubReport(event, installId),
    beforeBreadcrumb: () => null,
  });
  if (details.version.build !== null) Sentry.setTag('build', details.version.build);
  if (details.version.commit) Sentry.setTag('commit', details.version.commit);
  if (details.version.updateId) Sentry.setTag('update', details.version.updateId);
  if (details.channel) Sentry.setTag('channel', details.channel);
  loadInstallId().then((id) => {
    installId = id;
    if (id) Sentry.setUser({ id });
  });
  return true;
}

/** Whether crash reports were started. */
export function crashReportsOn() {
  return started;
}

/** The screen that is open, as its pattern such as /injuries/[id], never with an id in it. */
export function setCrashReportScreen(segments: readonly string[]) {
  if (!started) return;
  Sentry.setTag('screen', scrubText(`/${segments.join('/')}`));
}

/** Sends a report of an error the app caught, such as on the "Something went wrong" screen. */
export function reportCrash(error: unknown) {
  if (!started) return;
  Sentry.captureException(error);
}

/** For tests: forgets that reports were started. */
export function resetCrashReportsForTests() {
  started = false;
  installId = null;
  personalValues = null;
}
