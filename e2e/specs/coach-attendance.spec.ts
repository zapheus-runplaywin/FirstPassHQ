import { openApp } from '../support/app';
import { eq } from '../support/fake-supabase';
import { openSquad, openSquadAthletes, samplePeople, TODAY, uuid } from '../support/people';
import { expect, test } from '../support/test';

test('a coach takes attendance for their squad', async ({ page }) => {
  const { coach } = samplePeople();
  const sessionId = uuid(701);
  let saved: { name: string; held_at: string; marks: { profile_id: string; present: boolean }[] } | null = null;

  const backend = await openApp(page, {
    me: coach,
    teams: [openSquad],
    memberships: [{ team_role: 'coach', coach_title: 'head_coach', selection: null, team: openSquad }],
    handle: (req) => {
      if (req.rpc === 'attendance_roster') return openSquadAthletes;
      if (req.rpc === 'save_attendance') {
        saved = { name: req.body.p_name, held_at: req.body.p_held_at, marks: req.body.p_marks };
        return sessionId;
      }
      if (req.rpc === 'attendance_sessions_list') {
        const session = saved && {
          id: sessionId,
          team_id: openSquad.id,
          team_name: openSquad.name,
          name: saved.name,
          held_at: saved.held_at,
          taken_by_name: coach.full_name,
          present_count: saved.marks.filter((m) => m.present).length,
          marked_count: saved.marks.length,
          can_edit: true,
        };
        return eq(req.params, 'id') ? (session ?? undefined) : session ? [session] : [];
      }
      if (req.rpc === 'attendance_register') {
        return (saved?.marks ?? []).map((m) => ({
          ...m,
          full_name: openSquadAthletes.find((a) => a.profile_id === m.profile_id)?.full_name,
        }));
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${coach.full_name}`)).toBeVisible();
  await page.getByRole('button', { name: /^Attendance Take attendance/ }).click();
  await page.getByRole('button', { name: 'Take attendance', exact: true }).click();

  // Their one squad is chosen for them, and its athletes are listed unmarked.
  await expect(page.getByText('0 of 3 present · 3 not marked')).toBeVisible();
  expect(backend.rpcCalls('attendance_roster')).toEqual([{ p_team_id: openSquad.id }]);
  await page.getByPlaceholder('For example, Tuesday training').fill('Sunday skills session');

  // One Present and one Absent choice per athlete, in register order.
  const present = page.getByRole('radio', { name: 'Present' });
  const absent = page.getByRole('radio', { name: 'Absent' });
  await present.nth(0).click(); // Bo Tran
  await absent.nth(1).click(); // Kai Thompson
  await expect(page.getByText('1 of 3 present · 1 not marked')).toBeVisible();
  await page.getByRole('button', { name: 'Mark the rest present' }).click(); // Lena Ortiz
  await expect(page.getByText('2 of 3 present', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save attendance' }).click();

  await expect.poll(() => backend.rpcCalls('save_attendance').length).toBe(1);
  expect(backend.rpcCalls('save_attendance')[0]).toEqual({
    p_session_id: null,
    p_team_id: openSquad.id,
    p_name: 'Sunday skills session',
    // No calendar event is on, so the session is held when the register was opened.
    p_held_at: TODAY.toISOString(),
    p_marks: [
      { profile_id: openSquadAthletes[0].profile_id, present: true },
      { profile_id: openSquadAthletes[1].profile_id, present: false },
      { profile_id: openSquadAthletes[2].profile_id, present: true },
    ],
  });

  // The saved session opens, showing who was there.
  await expect(page).toHaveURL(new RegExp(`/attendance/${sessionId}$`));
  await expect(page.getByText('2 of 3 present', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change attendance' })).toBeVisible();
});
