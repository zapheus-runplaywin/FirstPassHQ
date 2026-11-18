#!/usr/bin/env node
/**
 * Stops a build on Expo's servers whose app could not start, or would connect
 * to the wrong club (docs/beta-builds.md, "What a build checks first").
 *
 * The live club's address and key, and the demo club's, are built into the app
 * from the EAS environment named in eas.json. An app built without the live
 * club's pair stops the moment it opens (src/constants/clubs.ts), and nothing
 * else says so: the build is green and the store accepts it. So EAS runs this
 * first, as the `eas-build-pre-install` script in package.json, and a build
 * with a setting missing or wrong fails in its first minute and says which.
 *
 * It checks that:
 * - the live club's address and key are both set;
 * - each address is https:// and the project's address alone;
 * - each key is a public key (never the secret or service_role key, which
 *   gives full access to a club's data), has not expired, and belongs to the
 *   project at its address;
 * - the demo club has both of its settings or neither, and is never the live
 *   club's own project.
 *
 * It must run with Node alone: EAS runs it before it installs any packages.
 */
'use strict';

const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');

const LIVE = {
  club: 'the live club',
  url: 'EXPO_PUBLIC_SUPABASE_URL',
  key: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
};
const DEMO = {
  club: 'the demo club',
  url: 'EXPO_PUBLIC_DEMO_CLUB_URL',
  key: 'EXPO_PUBLIC_DEMO_CLUB_ANON_KEY',
};

/** A URL when the text is one, or null. */
function parse(address) {
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

/** What is wrong with a club's address, or null. */
function addressProblem(name, value) {
  if (/[\s"']/.test(value)) return `${name} has a space or a quote in it`;
  const url = parse(value);
  if (!url) return `${name} is not a web address. It looks like https://abcd1234.supabase.co`;
  if (url.protocol !== 'https:') return `${name} must start with https://`;
  if (value !== `https://${url.host}`) {
    return (
      `${name} must be the project's address alone, such as https://abcd1234.supabase.co: ` +
      'lower case, with nothing after it (no slash at the end)'
    );
  }
  return null;
}

/** The claims inside an older Supabase key, or null when it isn't one. */
function claims(key) {
  const parts = key.split('.');
  if (parts.length !== 3 || !key.startsWith('eyJ')) return null;
  try {
    const found = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return found && typeof found === 'object' ? found : null;
  } catch {
    return null;
  }
}

/** What is wrong with a club's key, or null. `url` is its address, when that is sound. */
function keyProblem(name, value, url, now) {
  if (/[\s"']/.test(value)) return `${name} has a space or a quote in it`;
  if (value.startsWith('sb_secret_')) {
    return (
      `${name} is a SECRET key. It gives full access to the club's data and must never be ` +
      'in an app. Use the publishable key'
    );
  }
  if (value.startsWith('sb_publishable_')) return null;
  const found = claims(value);
  if (!found) {
    return `${name} is not a Supabase public key. It starts with sb_publishable_ or eyJ`;
  }
  if (found.role === 'service_role') {
    return (
      `${name} is the service_role key. It gives full access to the club's data and must never ` +
      'be in an app. Use the anon or publishable key'
    );
  }
  if (found.role !== 'anon') return `${name} is not the project's anon key`;
  if (typeof found.exp === 'number' && found.exp * 1000 < now) return `${name} has expired`;
  const project = url && url.host.endsWith('.supabase.co') ? url.host.split('.')[0] : null;
  if (project && typeof found.ref === 'string' && found.ref !== project) {
    return (
      `${name} belongs to another project (${found.ref}) than its address (${project}), ` +
      'so every request would be refused'
    );
  }
  return null;
}

/** A club's address and key, as the build would put them in the app. */
function settings(env, club) {
  return { url: env[club.url] ?? '', key: env[club.key] ?? '' };
}

/** What is wrong with the settings a club has. A missing one is the caller's to report. */
function clubProblems(club, { url, key }, now) {
  const found = [];
  const address = url.trim() ? addressProblem(club.url, url) : null;
  if (address) found.push(address);
  if (key.trim()) {
    const wrongKey = keyProblem(club.key, key, url.trim() && !address ? parse(url) : null, now);
    if (wrongKey) found.push(wrongKey);
  }
  return found;
}

/**
 * Everything wrong with the build's club settings, in words for the person who
 * set them. None means the app can start and reaches the right projects.
 */
function problems(env, now = Date.now()) {
  const found = [];
  const live = settings(env, LIVE);
  const demo = settings(env, DEMO);

  for (const name of [LIVE.url, LIVE.key]) {
    if (!(env[name] ?? '').trim()) {
      found.push(`${name} is missing. Without it the app stops as soon as it opens`);
    }
  }
  found.push(...clubProblems(LIVE, live, now));

  const hasDemoUrl = !!demo.url.trim();
  const hasDemoKey = !!demo.key.trim();
  if (hasDemoUrl !== hasDemoKey) {
    const [missing, set] = hasDemoUrl ? [DEMO.key, DEMO.url] : [DEMO.url, DEMO.key];
    found.push(
      `${missing} is missing, so the build would have no demo club. Add it, or remove ${set}`,
    );
  }
  found.push(...clubProblems(DEMO, demo, now));
  if (hasDemoUrl) {
    const liveHost = parse(live.url)?.host;
    if (liveHost && parse(demo.url)?.host === liveHost) {
      found.push(
        `${DEMO.url} is the live club's own project. The demo club must be the test project, ` +
          'or it is left out of the app',
      );
    }
  }
  if (hasDemoKey && demo.key.trim() === live.key.trim()) {
    found.push(`${DEMO.key} is the live club's key. Use the test project's public key`);
  }
  return found;
}

/** The EAS environment this build reads, from its profile in eas.json. */
function environmentName(env) {
  try {
    const file = path.join(path.dirname(module.filename), '..', 'eas.json');
    const eas = JSON.parse(fs.readFileSync(file, 'utf8'));
    return eas.build?.[env.EAS_BUILD_PROFILE]?.environment ?? null;
  } catch {
    return null;
  }
}

function main(env) {
  const found = problems(env);
  if (found.length === 0) {
    const demo = settings(env, DEMO);
    console.log(
      `Club settings are in place: the live club is ${settings(env, LIVE).url}, ` +
        (demo.url ? `and the demo club is ${demo.url}.` : 'and this build has no demo club.'),
    );
    return 0;
  }
  const environment = environmentName(env);
  console.error('This build was stopped before it started, because its app would not work:');
  for (const problem of found) console.error(`- ${problem}.`);
  console.error(
    `Fix ${found.length === 1 ? 'it' : 'them'} on expo.dev, under Environment variables, ` +
      `for the ${environment ? `"${environment}"` : "build's"} environment, ` +
      'then start the build again. See docs/beta-builds.md, "What a build checks first".',
  );
  return 1;
}

module.exports = { problems };

if (require.main === module) process.exit(main(process.env));
