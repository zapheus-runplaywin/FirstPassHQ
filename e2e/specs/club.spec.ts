import { openApp, openTab } from '../support/app';
import { eq } from '../support/fake-supabase';
import { samplePeople } from '../support/people';
import { expect, test } from '../support/test';

// The Club tab for admins: five areas that open where they are, and a search
// over settings and members ("The Club tab" in section 10 of docs/user-guide.md).

test('an admin opens an area, then finds a setting and a member from the search', async ({ page }) => {
  const { admin, coach, athlete } = samplePeople();
  const people = [admin, coach, athlete];

  await openApp(page, {
    me: admin,
    handle: (req) => {
      if (req.table === 'profiles') {
        const id = eq(req.params, 'id');
        if (id) return people.find((p) => p.id === id);
        // Nobody is waiting to join.
        if (req.head) return [];
        return people;
      }
      return undefined;
    },
  });

  await expect(page.getByText(`Hi ${admin.full_name}`)).toBeVisible();
  await openTab(page, 'Club');

  // Five areas, closed, each saying what is inside.
  const setup = page.getByRole('button', { name: /^Club setup/ });
  await expect(setup).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /^People Members, check-ins, attendance and 5 more/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Club password/ })).toHaveCount(0);
  await setup.click();
  await expect(setup).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^Club password/ })).toBeVisible();

  // A setting, by what it does.
  const search = page.getByPlaceholder('Find a member or a setting');
  await search.fill('time zone');
  await expect(page.getByRole('button', { name: /^Club options/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^People/ })).toHaveCount(0);

  // A member, by name: their page opens.
  await search.fill(coach.full_name.split(' ')[0].toLowerCase());
  await page.getByRole('button', { name: new RegExp(`^${coach.full_name}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${coach.id}`));
});
