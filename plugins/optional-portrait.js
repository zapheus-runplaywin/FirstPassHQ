/**
 * Marks the portrait screen as optional on Android.
 *
 * Phones keep the app upright ("orientation": "portrait" in app.json). Android
 * 16 and later ignore that on tablets and foldables (600dp and wider), which
 * turn and resize it like any app, and HQ lays itself out for them
 * (src/hooks/use-layout.ts). iPads turn it too ("supportsTablet").
 *
 * Asking for portrait makes Android treat android.hardware.screen.portrait as
 * a required hardware feature, and Google Play hides the app from tablets,
 * Chromebooks and XR headsets that don't report it. Declaring the feature with
 * required="false" keeps phones upright and lets those devices install it.
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
