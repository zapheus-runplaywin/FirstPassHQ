/**
 * Marks the portrait screen as optional on Android.
 *
 * The app is portrait only ("orientation": "portrait" in app.json). Android then
 * treats android.hardware.screen.portrait as a required hardware feature, and
 * Google Play hides the app from tablets, Chromebooks and XR headsets that
 * don't report it. Declaring the feature with required="false" keeps the app
 * portrait wherever it runs and lets those devices install it.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

/** Adds, or corrects, <uses-feature android:name=FEATURE android:required="false"/>. */
function addOptionalPortrait(manifest) {
  const root = manifest.manifest;
  const features = (root['uses-feature'] ??= []);
  const existing = features.find((f) => f.$?.['android:name'] === FEATURE);
  if (existing) {
    existing.$['android:required'] = 'false';
  } else {
    features.push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
  }
  return manifest;
}

const withOptionalPortrait = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = addOptionalPortrait(mod.modResults);
    return mod;
  });

module.exports = withOptionalPortrait;
module.exports.addOptionalPortrait = addOptionalPortrait;
module.exports.FEATURE = FEATURE;
