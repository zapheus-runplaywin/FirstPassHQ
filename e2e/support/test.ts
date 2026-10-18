// Playwright's test, failing any test whose page throws an uncaught error, so a
// broken build fails even when the screen still shows the expected text.
import { expect, test as base } from '@playwright/test';

/**
 * Known and harmless for now: React error #418, a hydration mismatch on every
 * first load. The static export renders each page with no club picked ("Find
 * your club"), because storage isn't available while rendering, but in the
 * browser ClubChoiceProvider renders nothing until the saved club has loaded
 * (src/lib/club-choice.tsx `ready`, src/app/_layout.tsx `if (!ready) return null`).
 * React drops the server HTML and renders again, so the app works. Remove this
 * once the static render matches the browser's first render.
 */
const KNOWN = [/Minified React error #418\b/];

export const test = base.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        if (!KNOWN.some((known) => known.test(error.message))) errors.push(error.stack ?? error.message);
      });
      await use();
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
