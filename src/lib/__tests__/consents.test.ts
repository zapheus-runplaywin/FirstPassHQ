import { consentsNeeded, type ChildConsent } from '@/lib/consents';

function child(overrides: Partial<ChildConsent>): ChildConsent {
  return {
    athlete_id: 'child-1',
    full_name: 'Sam Sample',
    data: false,
    health: false,
    can_consent: true,
    ...overrides,
  };
}

describe('consentsNeeded', () => {
  it('lists children missing either consent', () => {
    const none = child({ athlete_id: 'a' });
    const dataOnly = child({ athlete_id: 'b', data: true });
    const healthOnly = child({ athlete_id: 'c', health: true });
    expect(consentsNeeded([none, dataOnly, healthOnly])).toEqual([none, dataOnly, healthOnly]);
  });

  it('leaves out children with both consents', () => {
    expect(consentsNeeded([child({ data: true, health: true })])).toEqual([]);
  });

  it('leaves out children while the guardian is not verified', () => {
    expect(consentsNeeded([child({ can_consent: false })])).toEqual([]);
  });

  it('is empty with no children', () => {
    expect(consentsNeeded([])).toEqual([]);
  });
});
