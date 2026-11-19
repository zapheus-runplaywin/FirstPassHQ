import {
  checkInsOffNote,
  injuriesOffWarning,
  liveStreamsOffNote,
  openInjuryCounts,
} from '@/lib/feature-switches';

describe('openInjuryCounts', () => {
  it('counts open injuries and the ones part-way to clearance', () => {
    expect(
      openInjuryCounts([
        { status: 'injured' },
        { status: 'clearance_requested' },
        { status: 'coach_endorsed' },
        { status: 'cleared' },
      ]),
    ).toEqual({ open: 3, clearances: 2 });
  });

  it('is zero with no injuries', () => {
    expect(openInjuryCounts([])).toEqual({ open: 0, clearances: 0 });
  });
});

describe('injuriesOffWarning', () => {
  it('waits for the counts', () => {
    expect(injuriesOffWarning(null)).toBeNull();
  });

  it('names open injuries and clearances waiting, and that they pause', () => {
    const text = injuriesOffWarning({ open: 3, clearances: 2 })!;
    expect(text).toMatch(/^3 injuries are open, and 2 are waiting for clearance sign-off/);
    expect(text).toMatch(/Nothing is deleted/);
    expect(text).toMatch(/brings every injury and clearance back where it stopped/);
    expect(text).toMatch(/Registers keep showing “Injured”/);
  });

  it('uses the singular', () => {
    expect(injuriesOffWarning({ open: 1, clearances: 1 })).toMatch(
      /^1 injury is open, and 1 is waiting for clearance sign-off/,
    );
    expect(injuriesOffWarning({ open: 1, clearances: 0 })).toMatch(/^1 injury is open\. Nothing/);
  });

  it('says when nothing is open', () => {
    expect(injuriesOffWarning({ open: 0, clearances: 0 })).toMatch(/^No injuries are open\./);
  });
});

describe('consent notes', () => {
  it('tells the admin given consents are kept', () => {
    expect(checkInsOffNote).toMatch(/Consents already given are kept/);
    expect(liveStreamsOffNote).toMatch(/Consents already given are kept/);
  });
});
