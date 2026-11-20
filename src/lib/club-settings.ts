import { FEATURES, offByDefault, type ClubProfile, type Features } from '@/lib/club';
import { supabase } from '@/lib/supabase';

/**
 * Saving the club's settings from the admin pages Club brand, Club features
 * and Club options. The database saves the name, colours, logo, feature
 * switches and the squads switch together and replaces all of them on each
 * save, so a page that changes only some of them sends the rest as saved.
 */

/** The club's name, colours and logo as the database takes them: empty means the build's default. */
export type ClubLook = {
  clubName: string;
  shortName: string;
  background: string;
  text: string;
  hero: string;
  logoPath: string;
};

/** The look as saved, for a page that doesn't change it. */
export function savedLook(saved: ClubProfile | null | undefined): ClubLook {
  return {
    clubName: saved?.club_name ?? '',
    shortName: saved?.short_name ?? '',
    background: saved?.background_colour ?? '',
    text: saved?.text_colour ?? '',
    hero: saved?.hero_colour ?? '',
    logoPath: saved?.logo_path ?? '',
  };
}

/**
 * The feature switches to store. Only switches away from a feature's default
 * are stored, so most new features start on and the few marked off by default
 * start off. Squads are stored with them, and only when they're off.
 */
export function featuresToSave(features: Features, squads: boolean): Record<string, boolean> {
  return Object.fromEntries([
    ...FEATURES.filter((f) => !offByDefault(f) && !features[f.key]).map((f) => [f.key, false]),
    ...FEATURES.filter((f) => offByDefault(f) && features[f.key]).map((f) => [f.key, true]),
    ...(squads ? [] : [['squads', false]]),
  ]);
}

/** Saves the look, feature switches and squads switch. Returns the refusal, if any. */
export async function saveClubProfile(
  look: ClubLook,
  features: Features,
  squads: boolean,
): Promise<string | null> {
  const { error } = await supabase.rpc('admin_update_club_profile', {
    p_club_name: look.clubName,
    p_short_name: look.shortName,
    p_background_colour: look.background,
    p_text_colour: look.text,
    p_hero_colour: look.hero,
    p_logo_path: look.logoPath,
    p_features: featuresToSave(features, squads),
  });
  return error ? error.message : null;
}

export const SAVED_NOTICE = 'Saved. Members see the changes next time they open the app.';
