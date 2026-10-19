// Playwright's test, failing any test whose page throws an uncaught error, so a
// broken build fails even when the screen still shows the expected text.
import { expect, test as base } from '@playwright/test';

export const test = base.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.stack ?? error.message);
      });
      await use();
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
