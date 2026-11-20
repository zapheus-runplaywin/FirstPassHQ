/**
 * The safeguarding posts a member holds (src/lib/safeguarding-posts.ts),
 * shown as titles under their roles on the home screen ("Your home screen" in
 * docs/user-guide.md).
 */
import {
  safeguardingPostLabels,
  safeguardingPostsFrom,
  safeguardingPostsLabel,
} from '@/lib/safeguarding-posts';

describe('safeguardingPostsFrom', () => {
  it('reads each post the database says yes to', () => {
    expect(
      safeguardingPostsFrom({
        child_safety_officer: true,
        complaints_manager: false,
        wwc_registration_officer: true,
      }),
    ).toEqual(['child_safety_officer', 'wwc_registration_officer']);
    expect(
      safeguardingPostsFrom({
        child_safety_officer: false,
        complaints_manager: true,
        wwc_registration_officer: false,
      }),
    ).toEqual(['complaints_manager']);
  });

  it('holds none when nothing comes back, or anything but true', () => {
    expect(safeguardingPostsFrom(null)).toEqual([]);
    expect(safeguardingPostsFrom(undefined)).toEqual([]);
    expect(safeguardingPostsFrom('child_safety_officer')).toEqual([]);
    expect(safeguardingPostsFrom({})).toEqual([]);
    expect(
      safeguardingPostsFrom({
        child_safety_officer: 'true',
        complaints_manager: 1,
        wwc_registration_officer: null,
      }),
    ).toEqual([]);
  });
});

describe('safeguardingPostsLabel', () => {
  it('names each post the way Administration > Safeguarding does', () => {
    expect(safeguardingPostLabels).toEqual({
      child_safety_officer: 'Child Safety Officer',
      complaints_manager: 'Complaints Manager',
      wwc_registration_officer: 'WWC Registration Officer',
    });
  });

  it('joins posts in a fixed order, whatever order they come in', () => {
    expect(safeguardingPostsLabel(['wwc_registration_officer', 'child_safety_officer'])).toBe(
      'Child Safety Officer · WWC Registration Officer',
    );
    expect(safeguardingPostsLabel(['complaints_manager'])).toBe('Complaints Manager');
  });

  it('is empty for someone who holds none', () => {
    expect(safeguardingPostsLabel([])).toBe('');
  });
});
