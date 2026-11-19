/**
 * plugins/optional-portrait.js: Google Play hid the app from tablets, desktops
 * and XR devices because the portrait screen was a required feature.
 */
const withOptionalPortrait = require('../optional-portrait');
const { addOptionalPortrait, FEATURE } = withOptionalPortrait;
const appJson = require('../../app.json');

const portrait = (m) => m.manifest['uses-feature'].filter((f) => f.$['android:name'] === FEATURE);

describe('the portrait screen is optional on Android', () => {
  it('adds the feature as not required to a manifest without it', () => {
    const m = addOptionalPortrait({ manifest: { $: {} } });
    expect(portrait(m)).toEqual([{ $: { 'android:name': FEATURE, 'android:required': 'false' } }]);
  });

  it('turns a required declaration into an optional one, without a duplicate', () => {
    const m = addOptionalPortrait({
      manifest: { 'uses-feature': [{ $: { 'android:name': FEATURE, 'android:required': 'true' } }] },
    });
    expect(portrait(m)).toHaveLength(1);
    expect(portrait(m)[0].$['android:required']).toBe('false');
  });

  it('leaves other features alone', () => {
    const camera = { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } };
    const m = addOptionalPortrait({ manifest: { 'uses-feature': [camera] } });
    expect(m.manifest['uses-feature']).toContain(camera);
    expect(m.manifest['uses-feature']).toHaveLength(2);
  });

  it('is listed in app.json, and the app stays portrait', () => {
    expect(appJson.expo.plugins).toContain('./plugins/optional-portrait');
    expect(appJson.expo.orientation).toBe('portrait');
  });
});
