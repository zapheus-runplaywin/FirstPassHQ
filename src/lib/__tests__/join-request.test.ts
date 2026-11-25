import {
  askedLine,
  canApproveHere,
  firstNameOf,
  joinChecks,
  opensOnJoinSummary,
  type JoinCheck,
  type JoinChecksInput,
} from '@/lib/join-request';
import { localDay } from '@/lib/reports';
import type { AppRole, MemberStatus, Profile } from '@/lib/types';

// The report helpers reach these, which need a phone; nothing here uses them.
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn() }));

// Today is 18 October 2026, at local midday so the tests mean the same in any time zone.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 18, 12));
});

afterEach(() => {
  jest.useRealTimers();
});

type Member = JoinChecksInput['member'];

/** Someone waiting for approval who has asked to join, with nothing checked yet. */
function asking(role: AppRole, extra: Partial<Member> = {}): Member {
  return {
    status: 'pending',
    join_requested_at: '2026-10-15T08:00:00Z',
    requested_role: role,
    full_name: 'Robin New',
    preferred_name: null,
    email: 'robin@example.test',
    verified_at: null,
    verification_method: null,
    date_of_birth: null,
    declared_date_of_birth: null,
    guardian_email: null,
    wwcc_number: null,
    wwcc_expires_on: null,
    wwcc_exempt_reason: null,
    ...extra,
  };
}

/** The checks for someone approved with the role they asked for. */
function checksFor(member: Member, input: Partial<JoinChecksInput> = {}) {
  return joinChecks({
    member,
    roles: [member.requested_role!],
    dob: member.date_of_birth ?? member.declared_date_of_birth,
    ...input,
  });
}

const check = (checks: JoinCheck[], key: JoinCheck['key']) => checks.find((c) => c.key === key);
const keys = (checks: JoinCheck[]) => checks.map((c) => c.key);
const blocking = (checks: JoinCheck[]) => checks.filter((c) => c.blocks).map((c) => c.key);

const ADULT = '2001-03-09';
const CHILD = '2010-06-01';
const CARD = { wwcc_number: 'WWC0100001', wwcc_expires_on: '2028-03-01' };

describe('firstNameOf', () => {
  it.each<[string | null, string | null, string]>([
    ['Robin New', null, 'Robin'],
    ['Robin New', 'Rob', 'Rob'],
    ['  Robin   New ', '  ', 'Robin'],
    ['Cher', null, 'Cher'],
    [null, null, ''],
    ['', null, ''],
  ])('for %j preferring %j is %j', (full_name, preferred_name, expected) => {
    expect(firstNameOf({ full_name, preferred_name })).toBe(expected);
  });
});

describe('askedLine', () => {
  it.each<[AppRole | null, string | null, string]>([
    ['athlete', 'Mixed Open Squad', 'Asked to join as an athlete · Mixed Open Squad'],
    ['athlete', null, 'Asked to join as an athlete'],
    ['coach', '17 & Under Squad', 'Asked to join as a coach · 17 & Under Squad'],
    ['guardian', null, 'Asked to join as a guardian'],
    ['admin', null, 'Asked to join as an admin'],
    ['volunteer', null, 'Asked to join as a temporary helper'],
    [null, null, 'Asked to join'],
  ])('for %j in %j says %j', (requested_role, group, expected) => {
    expect(askedLine({ requested_role }, group)).toBe(expected);
  });
});

describe('opensOnJoinSummary', () => {
  const here = { isSelf: false, hasPlaces: false, forAnotherSection: false };
  const member = (
    status: MemberStatus,
    requested_role: AppRole | null = 'athlete',
    join_requested_at: string | null = '2026-10-15T08:00:00Z',
  ): Pick<Profile, 'status' | 'join_requested_at' | 'requested_role'> => ({
    status,
    requested_role,
    join_requested_at,
  });

  it.each<AppRole>([
    'athlete',
    'guardian',
    'coach',
    'manager',
    'physio',
    'committee',
    'statistician',
    'admin',
    'guest',
    'studio',
  ])('opens a waiting request to be a %s on its summary', (role) => {
    expect(opensOnJoinSummary(member('pending', role), here)).toBe(true);
  });

  it('opens a temporary helper’s request on the full record, where they are set up', () => {
    expect(opensOnJoinSummary(member('pending', 'volunteer'), here)).toBe(false);
  });

  it.each<MemberStatus>(['approved', 'rejected'])('never for a member who is %s', (status) => {
    expect(opensOnJoinSummary(member(status), here)).toBe(false);
  });

  it('never for someone who signed in but hasn’t asked to join', () => {
    expect(opensOnJoinSummary(member('pending', null, null), here)).toBe(false);
  });

  it.each<[string, Partial<typeof here>]>([
    ['the admin’s own page', { isSelf: true }],
    ['a request an admin has saved places for', { hasPlaces: true }],
    ['a page opened by a to-do about something else', { forAnotherSection: true }],
  ])('never for %s', (_l, change) => {
    expect(opensOnJoinSummary(member('pending'), { ...here, ...change })).toBe(false);
  });
});

describe('joinChecks for an athlete', () => {
  it('lets an adult be approved on the date of birth they gave, and says approving records it', () => {
    const checks = checksFor(asking('athlete', { declared_date_of_birth: ADULT }));
    expect(keys(checks)).toEqual(['identity', 'date-of-birth']);
    expect(check(checks, 'date-of-birth')).toEqual({
      key: 'date-of-birth',
      tone: 'note',
      text: 'Date of birth they gave: 09/03/2001 (25). Check it against PlayHQ or ID. Approving records it as checked.',
      blocks: false,
    });
    expect(canApproveHere(checks)).toBe(true);
  });

  it('marks a date of birth an admin already checked as done', () => {
    const checks = checksFor(asking('athlete', { date_of_birth: ADULT, declared_date_of_birth: '2001-01-01' }));
    expect(check(checks, 'date-of-birth')).toMatchObject({
      tone: 'done',
      text: 'Date of birth 09/03/2001 (25), already checked.',
    });
  });

  it('notes a date the admin entered that isn’t the one they gave', () => {
    const checks = checksFor(asking('athlete', { declared_date_of_birth: ADULT }), { dob: '2001-03-19' });
    expect(check(checks, 'date-of-birth')).toMatchObject({
      tone: 'note',
      text: 'Date of birth 19/03/2001 (25), as you entered it, not the date they gave (09/03/2001). Approving records it as checked.',
    });
  });

  it('waits for a date of birth: none, or one that isn’t a date', () => {
    const none = checksFor(asking('athlete'), { dob: null });
    expect(check(none, 'date-of-birth')).toMatchObject({
      tone: 'attention',
      text: 'No date of birth. Add it in the full record, checked against PlayHQ or ID, before you approve an athlete.',
    });
    expect(blocking(none)).toEqual(['date-of-birth']);

    const wrong = checksFor(asking('athlete', { declared_date_of_birth: ADULT }), { dob: undefined });
    expect(check(wrong, 'date-of-birth')?.text).toBe('The date of birth isn’t a date. Fix it in the full record.');
    expect(canApproveHere(wrong)).toBe(false);
  });

  it('says before Approve that a child stays locked until a verified parent is linked', () => {
    const checks = checksFor(
      asking('athlete', { declared_date_of_birth: CHILD, guardian_email: 'sam@example.test' }),
    );
    expect(keys(checks)).toEqual(['identity', 'date-of-birth', 'parent']);
    expect(check(checks, 'parent')).toEqual({
      key: 'parent',
      tone: 'note',
      text: 'Under 18: Robin’s app stays locked until a verified parent or guardian is linked. No parent has entered their code yet. Guardian email they gave: sam@example.test.',
      blocks: false,
    });
    // A child can be approved before a parent is linked: they're locked until one is.
    expect(canApproveHere(checks)).toBe(true);
  });

  it('names the parents who entered the child’s code', () => {
    const checks = checksFor(asking('athlete', { declared_date_of_birth: CHILD }), {
      codeEnteredBy: ['Sam New', 'Alex New'],
    });
    expect(check(checks, 'parent')?.text).toBe(
      'Under 18: Robin’s app stays locked until a verified parent or guardian is linked. Sam New and Alex New entered their code: approve or link them next.',
    );
  });

  it('counts only a parent whose link unlocks the child', () => {
    const member = asking('athlete', { declared_date_of_birth: CHILD });
    const linked = checksFor(member, {
      parents: [
        { name: 'Sam New', unlocks: true },
        { name: 'Alex New', unlocks: false },
      ],
    });
    expect(check(linked, 'parent')).toMatchObject({
      tone: 'done',
      text: 'Under 18, with a verified parent or guardian linked: Sam New.',
    });
    const unverified = checksFor(member, { parents: [{ name: 'Alex New', unlocks: false }] });
    expect(check(unverified, 'parent')?.tone).toBe('note');
    expect(check(unverified, 'parent')?.text).toMatch(/stays locked/);
  });

  it('has no parent line for an adult', () => {
    expect(check(checksFor(asking('athlete', { declared_date_of_birth: ADULT })), 'parent')).toBeUndefined();
  });

  it.each<[string, Partial<Member>, string | null]>([
    ['the date they gave', { declared_date_of_birth: '2014-04-01' }, '2014-04-01'],
    ['the date an admin checked', { date_of_birth: '2014-04-01', declared_date_of_birth: ADULT }, '2014-04-01'],
    ['the date they gave, whatever the admin typed', { declared_date_of_birth: '2014-04-01' }, ADULT],
  ])('never offers Approve for someone under 13 by %s', (_l, extra, dob) => {
    const checks = checksFor(asking('athlete', extra), { dob });
    expect(check(checks, 'under-13')).toMatchObject({
      tone: 'attention',
      text: 'Under 13. FirstPass HQ is for members aged 13 and over, so don’t approve this request.',
    });
    expect(canApproveHere(checks)).toBe(false);
    // The under 13 line says it all: no locked-until-a-parent line beside it.
    expect(check(checks, 'parent')).toBeUndefined();
  });
});

describe('joinChecks: who they are', () => {
  it('says how and when someone was verified', () => {
    const verified = { verified_at: '2026-10-16T03:00:00Z' };
    const day = localDay(verified.verified_at);
    expect(
      check(checksFor(asking('guardian', { ...verified, verification_method: 'code' })), 'identity'),
    ).toMatchObject({ tone: 'done', text: `Verified on ${day}, with their code.` });
    expect(
      check(checksFor(asking('guardian', { ...verified, verification_method: 'playhq' })), 'identity')?.text,
    ).toBe(`Verified on ${day}, matched to PlayHQ.`);
    expect(
      check(checksFor(asking('guardian', { ...verified, verification_method: 'id_sighted' })), 'identity')?.text,
    ).toBe(`Verified on ${day}, with ID sighted.`);
    expect(check(checksFor(asking('guardian', verified)), 'identity')?.text).toBe(`Verified on ${day}.`);
  });

  it('waits for a parent or guardian to be verified', () => {
    const checks = checksFor(asking('guardian'), { children: [{ name: 'Robin New', approved: true }] });
    expect(check(checks, 'identity')).toMatchObject({ tone: 'attention', blocks: true });
    expect(blocking(checks)).toEqual(['identity']);
  });

  it.each<AppRole>(['athlete', 'coach', 'manager', 'physio', 'committee', 'statistician', 'admin', 'guest'])(
    'doesn’t hold up a %s who isn’t verified',
    (role) => {
      const identity = check(checksFor(asking(role, { declared_date_of_birth: ADULT, ...CARD })), 'identity');
      expect(identity).toMatchObject({ tone: 'note', blocks: false });
    },
  );

  it('waits for a name', () => {
    const checks = checksFor(asking('athlete', { full_name: '  ', declared_date_of_birth: ADULT }));
    expect(checks[0]).toMatchObject({ key: 'name', tone: 'attention' });
    expect(canApproveHere(checks)).toBe(false);
  });

  it('waits when the roles can’t be held together', () => {
    const checks = checksFor(asking('athlete', { declared_date_of_birth: CHILD }), {
      roles: ['athlete', 'coach'],
      comboProblem: 'An athlete under 18 can’t also be a coach.',
    });
    expect(check(checks, 'roles')).toMatchObject({
      tone: 'attention',
      text: 'An athlete under 18 can’t also be a coach.',
    });
  });
});

describe('joinChecks for a parent or guardian', () => {
  const verified = { verified_at: '2026-10-16T03:00:00Z', verification_method: 'code' as const };

  it('approves a verified parent of an approved child, and says the link is made', () => {
    const checks = checksFor(asking('guardian', verified), {
      children: [
        { name: 'Robin New', approved: true },
        { name: 'Riley New', approved: false },
      ],
    });
    expect(keys(checks)).toEqual(['identity', 'child']);
    expect(check(checks, 'child')).toMatchObject({
      tone: 'done',
      text: 'Parent or guardian of Robin New. Approving links them.',
    });
    expect(canApproveHere(checks)).toBe(true);
  });

  it('waits for one of their children to be approved first', () => {
    const one = checksFor(asking('guardian', verified), { children: [{ name: 'Robin New', approved: false }] });
    expect(check(one, 'child')).toMatchObject({
      tone: 'attention',
      text: 'Approve their child first: Robin New is still waiting.',
    });
    const two = checksFor(asking('guardian', verified), {
      children: [
        { name: 'Robin New', approved: false },
        { name: 'Riley New', approved: false },
      ],
    });
    expect(check(two, 'child')?.text).toBe('Approve their child first: Robin New and Riley New are still waiting.');
    expect(canApproveHere(two)).toBe(false);
  });

  it('waits for a child’s link code, and points to the full record for a child who won’t use the app', () => {
    const checks = checksFor(asking('guardian', verified));
    expect(check(checks, 'child')).toMatchObject({ tone: 'attention', blocks: true });
    expect(check(checks, 'child')?.text).toMatch(/haven’t entered a child’s link code yet.*open the full record/);
  });

  it('asks for no date of birth and no check', () => {
    const checks = checksFor(asking('guardian', verified), { children: [{ name: 'Robin New', approved: true }] });
    expect(check(checks, 'date-of-birth')).toBeUndefined();
    expect(check(checks, 'wwcc')).toBeUndefined();
  });
});

describe('joinChecks: the Working With Children Check', () => {
  it.each<AppRole>(['coach', 'manager', 'physio'])('waits for a %s’s check, application or exemption', (role) => {
    const checks = checksFor(asking(role));
    expect(check(checks, 'wwcc')).toMatchObject({
      tone: 'attention',
      text: 'No current Working With Children Check. Record their card, an application they’ve lodged or a volunteer exemption in the full record first.',
    });
    expect(blocking(checks)).toEqual(['wwcc']);
  });

  it.each<AppRole>(['committee', 'admin', 'statistician'])(
    'waits for a %s’s check or application, or an exemption with a reason',
    (role) => {
      const checks = checksFor(asking(role));
      expect(check(checks, 'wwcc')).toMatchObject({
        tone: 'attention',
        text: 'No current Working With Children Check. Record their card or an application they’ve lodged, or exempt them with a reason, in the full record first.',
      });
      expect(canApproveHere(checks)).toBe(false);
    },
  );

  it.each<AppRole>(['coach', 'manager', 'physio', 'committee', 'admin', 'statistician'])(
    'approves a %s with a current card on record',
    (role) => {
      const checks = checksFor(asking(role, CARD));
      expect(check(checks, 'wwcc')).toMatchObject({
        tone: 'done',
        text: 'Working With Children Check on record, expires 01/03/2028.',
      });
      expect(canApproveHere(checks)).toBe(true);
    },
  );

  it.each<[string, Partial<Member>]>([
    ['an expired card', { wwcc_number: 'WWC0100001', wwcc_expires_on: '2026-10-17' }],
    ['a card with no expiry date', { wwcc_number: 'WWC0100001' }],
  ])('doesn’t count %s', (_l, card) => {
    expect(check(checksFor(asking('coach', card)), 'wwcc')?.tone).toBe('attention');
  });

  it('counts a card that expires soon: it is still current', () => {
    expect(check(checksFor(asking('coach', { wwcc_number: 'WWC1', wwcc_expires_on: '2026-11-01' })), 'wwcc')?.tone).toBe('done');
  });

  it.each<AppRole>(['committee', 'admin', 'statistician'])('takes an exemption with a reason for a %s', (role) => {
    const checks = checksFor(asking(role, { wwcc_exempt_reason: 'Treasurer only, never at training' }));
    expect(check(checks, 'wwcc')).toMatchObject({
      tone: 'done',
      text: 'Exempt from a Working With Children Check: Treasurer only, never at training',
    });
  });

  it.each<AppRole>(['coach', 'manager', 'physio'])('never takes a reason in place of a %s’s check', (role) => {
    const checks = checksFor(asking(role, { wwcc_exempt_reason: 'Trusted' }));
    expect(check(checks, 'wwcc')?.tone).toBe('attention');
  });

  it.each<[AppRole, boolean]>([
    ['coach', true],
    ['manager', true],
    ['physio', true],
    ['statistician', true],
    ['committee', false],
    ['admin', false],
  ])('a volunteer exemption for a %s counts: %s', (role, counts) => {
    const checks = checksFor(asking(role), { hasOpenExemption: true });
    expect(check(checks, 'wwcc')?.tone).toBe(counts ? 'done' : 'attention');
  });

  it('holds someone with two roles to the stricter one', () => {
    const checks = checksFor(asking('committee', { wwcc_exempt_reason: 'Treasurer only' }), {
      roles: ['committee', 'coach'],
    });
    expect(check(checks, 'wwcc')?.tone).toBe('attention');
  });

  it.each<AppRole>(['athlete', 'guardian', 'guest', 'studio'])('asks a %s for no check', (role) => {
    expect(check(checksFor(asking(role, { declared_date_of_birth: ADULT })), 'wwcc')).toBeUndefined();
  });
});

describe('joinChecks for a guest', () => {
  it('approves an adult on the date of birth they gave', () => {
    const checks = checksFor(asking('guest', { declared_date_of_birth: ADULT }));
    expect(keys(checks)).toEqual(['identity', 'date-of-birth']);
    expect(canApproveHere(checks)).toBe(true);
  });

  it('never approves a guest under 18, and says what to do instead', () => {
    const checks = checksFor(asking('guest', { declared_date_of_birth: CHILD }));
    expect(check(checks, 'guest-age')).toMatchObject({
      tone: 'attention',
      text: 'Under 18. Guests must be 18 or over: in the full record, approve them as an athlete with a parent or guardian linked instead.',
    });
    // Guests have no parents and guardians.
    expect(check(checks, 'parent')).toBeUndefined();
    expect(canApproveHere(checks)).toBe(false);
  });

  it('waits for a guest’s date of birth', () => {
    const checks = checksFor(asking('guest'), { dob: null });
    expect(check(checks, 'date-of-birth')?.text).toBe(
      'No date of birth. Add it in the full record, checked against PlayHQ or ID, before you approve a guest.',
    );
    expect(canApproveHere(checks)).toBe(false);
  });
});
