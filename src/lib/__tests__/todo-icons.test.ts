/**
 * The icon beside each to-do on Today (src/lib/todo-icons.ts), from the screen
 * the to-do opens.
 */
import { ICON_NAMES } from '@/components/icon';
import { todoIcon } from '@/lib/todo-icons';

// The icon component reads the club's colours, which need native storage.
jest.mock('@/hooks/use-theme', () => ({ useTheme: jest.fn() }));

describe('todoIcon', () => {
  it.each([
    ['/check-in', 'smile'],
    ['/check-ins', 'activity'],
    ['/check-ins/flags', 'activity'],
    ['/injuries/inj-1', 'plus-circle'],
    ['/attendance', 'clipboard'],
    ['/concerns', 'shield'],
    ['/concern/new', 'shield'],
    ['/consent/child-1', 'check-square'],
    ['/medical/athlete', 'heart'],
    ['/awards', 'award'],
    ['/training', 'book-open'],
    ['/surveys/s1', 'list'],
    ['/assessments/round', 'eye'],
    ['/selection', 'flag'],
    ['/declare-conflicts', 'folder'],
    ['/wwcc', 'credit-card'],
    ['/wwcc-application', 'credit-card'],
    ['/admin', 'user-check'],
    ['/admin/reports', 'bar-chart-2'],
    ['/admin/reports/wwcc', 'bar-chart-2'],
    ['/admin/club/records', 'settings'],
    ['/admin/assessments/round', 'user-check'],
    ['/my-details', 'user'],
    ['/tasks/new', 'check-circle'],
  ] as const)('%s gets %s', (href, icon) => {
    expect(todoIcon(href)).toBe(icon);
  });

  it('reads the screen from a link with parameters', () => {
    expect(todoIcon({ pathname: '/admin', params: { todo: 'unendorsable' } })).toBe('user-check');
    expect(todoIcon({ pathname: '/assessments/round', params: { id: 'r1' } })).toBe('eye');
    expect(todoIcon('/injuries?new=1' as never)).toBe('plus-circle');
  });

  it('takes the longest screen that matches, not the first', () => {
    expect(todoIcon('/check-ins')).not.toBe(todoIcon('/check-in'));
    expect(todoIcon('/admin/training')).toBe('book-open');
  });

  it('doesn’t mistake a screen for another that starts the same', () => {
    // "/teams" isn't "/team", so it gets the fallback, not the team icon.
    expect(todoIcon('/teams' as never)).toBe('check-circle');
  });

  it('gives a to-do for a screen it doesn’t know a tick, never nothing', () => {
    expect(todoIcon('/somewhere-new' as never)).toBe('check-circle');
    expect(ICON_NAMES).toContain(todoIcon('/somewhere-new' as never));
  });
});
