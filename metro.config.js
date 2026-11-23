// Expo's Metro settings plus Sentry's, which gives each bundle and its source
// map the same debug id so crash reports find the right map
// (src/lib/crash-reports.ts).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
