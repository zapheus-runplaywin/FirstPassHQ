/**
 * The club this build of the app is for. These are the defaults: an admin can
 * change the name, colours and logo in Administration > Club settings, and
 * the app uses those instead once a member has signed in.
 *
 * Setting the app up for another club? Change these, the app name, ids and
 * images in app.json and assets/images. See docs/new-club-setup.md.
 */
export const ClubDefaults = {
  name: 'West Coast Thunder',
  /** Used to find the club's teams in PlayHQ fixtures and to name exported files. */
  shortName: 'Thunder',
  background: '#000000',
  text: '#FFFFFF',
  /** Buttons, links, selected chips and other highlights. */
  hero: '#FFCD00',
} as const;

/** The logo built into the app, shown until an admin uploads one. */
export const DefaultLogo = require('@/assets/images/logo.png');
