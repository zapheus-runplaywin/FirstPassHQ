/**
 * HQ runs as a full iPad app, not a blown-up iPhone one (app.json
 * "supportsTablet"), while iPhones stay upright. Expo's own config steps are
 * run on app.json here, so a change that broke either shows before a build.
 */
const { IOSConfig } = require('@expo/config-plugins');
const appJson = require('../../app.json');

const config = appJson.expo;
const ALL_FOUR = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

describe('iPad support', () => {
  it('builds for iPhone and iPad', () => {
    expect(config.ios.supportsTablet).toBe(true);
    expect(config.ios.isTabletOnly).not.toBe(true);
    // 1 is iPhone, 2 is iPad.
    expect(IOSConfig.DeviceFamily.getDeviceFamilies(config)).toEqual([1, 2]);
  });

  it('lets an iPad turn either way and share the screen, as App Store review requires', () => {
    // Without all four orientations an iPad app that supports multitasking is
    // turned away at upload (ITMS-90474).
    expect(config.ios.requireFullScreen).not.toBe(true);
    const plist = IOSConfig.RequiresFullScreen.setRequiresFullScreen(config, {});
    expect(plist.UIRequiresFullScreen).toBe(false);
    expect([...plist['UISupportedInterfaceOrientations~ipad']].sort()).toEqual([...ALL_FOUR].sort());
  });

  it('keeps iPhones upright', () => {
    expect(config.orientation).toBe('portrait');
    const plist = IOSConfig.Orientation.setOrientation(config, {});
    expect(plist.UISupportedInterfaceOrientations).toEqual([
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
    ]);
  });

  it('still lets Android tablets install the app', () => {
    expect(config.plugins).toContain('./plugins/optional-portrait');
  });
});
