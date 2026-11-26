import type { AppRole } from '@/lib/types';

/**
 * Where the user guide PDFs are published: the "Publish guides" workflow puts
 * the role guides from docs/pdfs/ here under names that don't change from one
 * build to the next (scripts/build-guides-site.py; docs/pdfs/README.md,
 * "Published guides").
 */
export const GUIDES_URL = 'https://zapheus-runplaywin.github.io/FirstPassHQ/guides';

/**
 * Clubs whose guides are printed in their own name and colours, by club code.
 * Every other club reads the FirstPass HQ edition. Each edition here must be
 * one the workflow publishes (EDITIONS in scripts/build-guides-site.py).
 */
const BRANDED_EDITIONS: Record<string, string> = { THUNDER: 'thunder' };

/**
 * The guide for each role: its file name, and who it is for as the card says
 * it. Studio has no guide of its own: on its own it shows the guest's screens.
 */
const ROLE_GUIDES: Partial<Record<AppRole, { file: string; readers: string }>> = {
  athlete: { file: 'athletes', readers: 'athletes' },
  guardian: { file: 'guardians', readers: 'parents and guardians' },
  coach: { file: 'coaches', readers: 'coaches' },
  manager: { file: 'managers', readers: 'managers' },
  physio: { file: 'physios', readers: 'physios' },
  statistician: { file: 'statisticians', readers: 'statisticians' },
  committee: { file: 'committee', readers: 'committee members' },
  admin: { file: 'admins', readers: 'admins' },
  volunteer: { file: 'temporary-helpers', readers: 'temporary helpers' },
  guest: { file: 'guests', readers: 'guests' },
};

export type GuideLink = {
  role: AppRole;
  /** The card's name, such as "Guide for coaches". */
  title: string;
  /** The PDF's address. */
  url: string;
};

/** Which edition of the guides a club reads: its own, or the FirstPass HQ one. */
export function guideEdition(clubCode: string | null | undefined): string {
  return BRANDED_EDITIONS[(clubCode ?? '').trim().toUpperCase()] ?? 'generic';
}

/** The address of one role's guide in a club's edition. */
export function guideUrl(clubCode: string | null | undefined, file: string): string {
  return `${GUIDES_URL}/${guideEdition(clubCode)}/user-guide-${file}.pdf`;
}

/**
 * The guides a member is offered: one for each role they hold, in the order
 * given, each once. The guest guide is only for someone with no other guide,
 * so a coach whose roles are paused still gets the coaches' guide, and anyone
 * with nothing else gets the guests' one.
 */
export function guideLinks(clubCode: string | null | undefined, roles: AppRole[]): GuideLink[] {
  const withGuide = [...new Set(roles)].filter((role) => role !== 'guest' && ROLE_GUIDES[role]);
  return (withGuide.length ? withGuide : (['guest'] as AppRole[])).map((role) => {
    const guide = ROLE_GUIDES[role]!;
    return {
      role,
      title: `Guide for ${guide.readers}`,
      url: guideUrl(clubCode, guide.file),
    };
  });
}

/** Every guide file name, for the test that keeps them in step with docs/pdfs. */
export const GUIDE_FILES = Object.values(ROLE_GUIDES).map((guide) => guide.file);
