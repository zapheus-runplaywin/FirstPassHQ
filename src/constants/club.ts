/**
 * FirstPass, the company behind the app, and FirstPass HQ, the app's name.
 * A fresh install looks like FirstPass until
 * an admin sets the club's own name, colours and logo in Administration >
 * Club settings, and the app uses those once a member has signed in. The
 * FirstPass logo stays on the opening screen, the sign-in screen and the
 * foot of the home screen whatever the club sets.
 */
export const FirstPass = {
  /** The company, as in "Powered by FirstPass". */
  name: 'FirstPass',
  /** The app's name, under its icon. Matches `name` in app.json. */
  appName: 'FirstPass HQ',
  /** The FirstPass brand guide's palette. */
  navy: '#0F172A',
  orange: '#F75C03',
  blue: '#2274A5',
  gold: '#F1C40F',
  /** The FirstPass HQ logo, for deep navy and other dark backgrounds. */
  hqOnDark: require('@/assets/images/firstpass-hq-dark.png'),
  /** The FirstPass HQ logo, for white and other light backgrounds. */
  hqOnLight: require('@/assets/images/firstpass-hq-light.png'),
  /** The FirstPass company wordmark, for "Powered by FirstPass". */
  companyOnDark: require('@/assets/images/firstpass-dark.png'),
  companyOnLight: require('@/assets/images/firstpass-light.png'),
  /** The splash screen image: the FirstPass HQ logo across the middle of a square. */
  splash: require('@/assets/images/splash-logo.png'),
} as const;

/**
 * The app's built-in look, used on a fresh install and wherever Club settings
 * are empty: FirstPass blaze orange on deep navy.
 *
 * Setting the app up for another club? The club's admin sets its look in
 * Club settings; you only change these to show the club before anyone has
 * signed in. See docs/new-club-setup.md.
 */
export const ClubDefaults = {
  name: FirstPass.appName,
  /** Used to find the club's teams in PlayHQ fixtures and to name exported files. */
  shortName: FirstPass.name,
  background: FirstPass.navy,
  /** Light text is #FFFFFF, dark text #000000. */
  text: '#FFFFFF',
  /** Buttons, links, selected chips and other highlights. */
  hero: FirstPass.orange,
} as const;

/** The FirstPass 1P mark, shown as the club's logo until an admin uploads one. */
export const DefaultLogo = {
  onDark: require('@/assets/images/firstpass-mark-dark.png'),
  onLight: require('@/assets/images/firstpass-mark-light.png'),
} as const;
