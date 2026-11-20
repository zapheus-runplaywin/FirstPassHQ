#!/usr/bin/env node
/**
 * Writes the build number into the app (src/constants/build-info.json), so the
 * opening screen, Find your club, sign-in and home can show which build a
 * tester has (docs/beta-builds.md, "Which build is this?").
 *
 * The build number is the one on the build-N tags (.github/workflows/tag-build.yml):
 * the number of commits on main up to and including this one
 * (`git rev-list --count HEAD`). A commit that isn't on main has no build
 * number, so the app shows its short commit id instead.
 *
 * The Beta build workflow runs this before `eas build`, and
 * scripts/publish-update.sh before it exports an update. A build on Expo's
 * servers can't work it out itself: it gets no git history (.easignore).
 * The committed file has nulls, so a development copy shows neither.
 *
 *   node scripts/write-build-info.js            # write the file
 *   node scripts/write-build-info.js --print    # print what it would write
 *
 * Run it from the app's folder: it reads that folder's git history and writes
 * that folder's file. Main is `origin/main`, or MAIN_REF when set. It must run
 * with Node alone. Tests: scripts/test-write-build-info.sh.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'src', 'constants', 'build-info.json');

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function onMain(mainRef) {
  try {
    git(['merge-base', '--is-ancestor', 'HEAD', mainRef]);
    return true;
  } catch {
    return false;
  }
}

function buildInfo(mainRef = process.env.MAIN_REF || 'origin/main') {
  let commit;
  try {
    commit = git(['rev-parse', '--short=7', 'HEAD']);
  } catch {
    throw new Error('No git history here, so the build number is unknown.');
  }
  // A shallow clone counts only the commits it has, which would give a wrong number.
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error('This is a shallow clone. Fetch the whole history first (fetch-depth: 0).');
  }
  const build = onMain(mainRef) ? Number(git(['rev-list', '--count', 'HEAD'])) : null;
  return { build, commit };
}

if (require.main === module) {
  try {
    const info = buildInfo();
    const text = `${JSON.stringify(info, null, 2)}\n`;
    if (process.argv.includes('--print')) {
      process.stdout.write(text);
    } else {
      fs.writeFileSync(FILE, text);
      console.log(
        info.build === null
          ? `Commit ${info.commit} isn't on main, so the app shows "Commit ${info.commit}".`
          : `The app shows "Build ${info.build}" (commit ${info.commit}).`,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildInfo };
