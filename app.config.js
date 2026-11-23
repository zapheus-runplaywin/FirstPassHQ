// The app's settings are in app.json. This adds Sentry's build step, which
// uploads the source maps that turn a crash report's stack back into our code
// (src/lib/crash-reports.ts; docs/beta-builds.md, "Crash reports").
//
// The upload runs only when the EAS environment has both crash report settings
// and scripts/check-build-settings.js finds them sound. Without them the
// build skips it and goes ahead with crash reports off, instead of failing for
// want of a Sentry token. scripts/test-check-build-settings.py tests this.
const { withSentry } = require('@sentry/react-native/expo');

const { crashReportSettings } = require('./scripts/check-build-settings');

/** The Sentry build step's settings for a build with these environment variables. */
function sentryOptions(env) {
  const crash = crashReportSettings(env);
  return {
    // Sentry's EU data centre.
    url: 'https://de.sentry.io/',
    project: 'firstpass-hq',
    // The organisation is read from the token, so the build has nothing else to set.
    ...(crash.organization ? { organization: crash.organization } : {}),
    disableAutoUpload: !crash.on,
  };
}

module.exports = ({ config }) => withSentry(config, sentryOptions(process.env));
module.exports.sentryOptions = sentryOptions;
