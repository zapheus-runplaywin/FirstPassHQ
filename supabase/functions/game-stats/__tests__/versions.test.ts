// The function runs on Deno with the engine deno.json names; Jest tests it
// with the one in package.json. They must be the same release, or the tests
// would pass on an engine the function doesn't run.
const deno = require('../deno.json') as { imports: Record<string, string> };
const pkg = require('../../../../package.json') as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

it.each(['@firstpass/engine', '@firstpass/schema'])('%s is the same release for Deno and Jest', (name) => {
  const installed = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  expect(installed).toMatch(/^\d+\.\d+\.\d+$/);
  expect(deno.imports[name]).toBe(`npm:${name}@${installed}`);
});
