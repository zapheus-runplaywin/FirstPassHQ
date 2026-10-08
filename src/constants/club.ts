/**
 * The app's generic look, used on a fresh install and wherever Club settings
 * are empty. An admin sets the club's own name, colours and logo in
 * Administration > Club settings, and the app uses those once a member has
 * signed in.
 *
 * Setting the app up for another club? Change these, the app name, ids and
 * images in app.json and assets/images. See docs/new-club-setup.md.
 */
export const ClubDefaults = {
  name: 'Club',
  /** Used to find the club's teams in PlayHQ fixtures and to name exported files. */
  shortName: 'Club',
  background: '#000000',
  /** Light text is #FFFFFF, dark text #000000. */
  text: '#FFFFFF',
  /** Buttons, links, selected chips and other highlights. */
  hero: '#02CCFE',
} as const;

/** The generic CLUB logo built into the app, shown until an admin uploads one. */
export const DefaultLogo = require('@/assets/images/logo.png');
