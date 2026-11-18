import { looksLikeSetupCode, normaliseSetupCode } from '@/lib/first-admin';

describe('normaliseSetupCode', () => {
  test.each([
    ['7KQ4-MD2P-XY9Z', '7KQ4MD2PXY9Z'],
    [' 7kq4 md2p xy9z ', '7KQ4MD2PXY9Z'],
    ['7kq4md2pxy9z', '7KQ4MD2PXY9Z'],
    ['', ''],
  ])('reads %j as %j, the way the database compares it', (typed, code) => {
    expect(normaliseSetupCode(typed)).toBe(code);
  });
});

describe('looksLikeSetupCode', () => {
  test.each(['7KQ4-MD2P-XY9Z', '7kq4 md2p xy9z', '7KQ4MD2PXY9Z'])('accepts %j', (typed) => {
    expect(looksLikeSetupCode(typed)).toBe(true);
  });

  test.each([
    ['nothing', ''],
    ['eleven characters', '7KQ4-MD2P-XY9'],
    ['thirteen characters', '7KQ4-MD2P-XY9ZZ'],
    ['a zero, which no code has', '7KQ4-MD2P-XY90'],
    ['a letter O', '7KQ4-MD2P-XY9O'],
    ['a one', '7KQ4-MD2P-XY91'],
    ['a letter I', '7KQ4-MD2P-XY9I'],
    ['a letter L', '7KQ4-MD2P-XY9L'],
    ['a child’s six-letter link code', '7KQ-4MD'],
  ])('refuses %s', (_label, typed) => {
    expect(looksLikeSetupCode(typed)).toBe(false);
  });
});
