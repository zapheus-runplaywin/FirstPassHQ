/**
 * Australian phone numbers: checked before saving and shown with spaces, so
 * they're easy to read out and dial.
 *
 *   Mobile          0412 345 678       +61 412 345 678
 *   Landline        (08) 9123 4567     +61 8 9123 4567
 *   Freecall/local  1800 123 456       1300 123 456      13 12 34
 *
 * A number from another country is accepted when it starts with + and its
 * country code (8 to 15 digits in all), and is shown with a space after the
 * country code and its own country's grouping where we know it (New Zealand,
 * the UK, the US and Canada), or in threes otherwise: +64 21 123 4567,
 * +44 20 7946 0958, +1 415 555 2671, +33 612 345 678. The database checks
 * the same rule (`public.is_phone_number`), so an email address or a note can
 * never be saved where a number belongs.
 */

/** What a phone number may contain: digits, spaces, brackets, dashes, dots and a leading +. */
const PHONE_CHARACTERS = /^\+?[0-9 ()\-.]*$/;

function digitsOf(text: string) {
  return text.replace(/[^0-9]/g, '');
}

/** Digits split into groups of the given sizes; anything left over is its own group. */
function grouped(digits: string, sizes: number[]) {
  const parts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  if (at < digits.length) parts.push(digits.slice(at));
  return parts.join(' ');
}

/** An Australian number in its national form (0412345678), from one typed with +61 or 61. */
function nationalDigits(text: string): string | null {
  const trimmed = text.trim();
  const digits = digitsOf(trimmed);
  if (trimmed.startsWith('+')) {
    if (!digits.startsWith('61')) return null;
    // "+61 (0)8 ..." keeps a 0 some people write after the country code.
    const rest = digits.slice(2).replace(/^0/, '');
    return `0${rest}`;
  }
  if (digits.length === 11 && digits.startsWith('61')) return `0${digits.slice(2)}`;
  return digits;
}

/** Whether national digits are a whole Australian number. */
function isAustralian(national: string) {
  return (
    /^0[45]\d{8}$/.test(national) || // mobiles
    /^0[2378]\d{8}$/.test(national) || // landlines with area code
    /^1[38]00\d{6}$/.test(national) || // 1800 and 1300
    /^13\d{4}$/.test(national) // 13 numbers
  );
}

/** Whether the text is a phone number the club can call. */
export function isPhoneNumber(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !PHONE_CHARACTERS.test(trimmed)) return false;
  const digits = digitsOf(trimmed);
  if (trimmed.startsWith('+') && !digits.startsWith('61')) {
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');
  }
  const national = nationalDigits(trimmed);
  return national !== null && isAustralian(national);
}

/**
 * What's wrong with a phone number, in words the person can act on, or null
 * when it's fine. A blank number is fine unless `required`.
 */
export function phoneProblem(text: string, { required = false } = {}): string | null {
  const trimmed = text.trim();
  if (!trimmed) return required ? 'Add a phone number' : null;
  if (trimmed.includes('@')) {
    return 'That looks like an email address. Enter a phone number, such as 0412 345 678.';
  }
  if (!PHONE_CHARACTERS.test(trimmed)) {
    return 'A phone number has only digits and spaces, such as 0412 345 678.';
  }
  if (isPhoneNumber(trimmed)) return null;
  const digits = digitsOf(trimmed);
  if (!trimmed.startsWith('+') && digits.length === 8 && !digits.startsWith('0') && !digits.startsWith('1')) {
    return 'Add the area code, such as (08) 9123 4567.';
  }
  return 'Enter an Australian phone number, such as 0412 345 678 or (08) 9123 4567, or start a number from overseas with +.';
}

/** Spaces an Australian number in its national form (digits only). */
function formatNational(digits: string) {
  if (/^0[45]/.test(digits)) return grouped(digits, [4, 3, 3]);
  if (/^0[2378]/.test(digits)) {
    if (digits.length <= 2) return digits;
    return `(${digits.slice(0, 2)}) ${grouped(digits.slice(2), [4, 4])}`;
  }
  if (digits.startsWith('13') && digits.length <= 6) return grouped(digits, [2, 2, 2]);
  if (digits.startsWith('1')) return grouped(digits, [4, 3, 3]);
  if (digits.length <= 4) return digits;
  return grouped(digits, [4, 4]);
}

/** Spaces an Australian number after +61 (digits without the 0). */
function formatAfter61(rest: string) {
  if (/^[45]/.test(rest)) return grouped(rest, [3, 3, 3]);
  if (/^[2378]/.test(rest)) return grouped(rest, [1, 4, 4]);
  return rest;
}

/** Country codes two digits long (ITU); 1 and 7 are one digit, the rest three. */
const TWO_DIGIT_COUNTRY_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47',
  '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65',
  '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

/** The country code at the start of an international number's digits. */
function countryCode(digits: string) {
  if (/^[17]/.test(digits)) return digits.slice(0, 1);
  if (digits.length < 2 || TWO_DIGIT_COUNTRY_CODES.has(digits.slice(0, 2))) return digits.slice(0, 2);
  return digits.slice(0, 3);
}

/** Spaces the rest of a number from another country, after its country code. */
function formatOverseas(code: string, rest: string) {
  const national = rest;
  switch (code) {
    case '1': // US and Canada: +1 415 555 2671
      return grouped(national, [3, 3, 4]);
    case '64': // New Zealand: +64 21 123 4567 (mobile), +64 9 123 4567
      return grouped(national, national.startsWith('2') ? [2, 3, 4] : [1, 3, 4]);
    case '44': // UK: +44 7911 123456 (mobile), +44 20 7946 0958 (London), +44 161 496 0000
      if (national.startsWith('7')) return grouped(national, [4, 6]);
      if (national.startsWith('2')) return grouped(national, [2, 4, 4]);
      return grouped(national, [3, 3, 4]);
    default: {
      // Two fours for 8 digits (+65 9123 4567), otherwise threes with the
      // last group taking up to four (+33 612 345 678, +49 301 234 5678).
      const n = national.length;
      if (n <= 4) return national;
      if (n <= 8) return grouped(national, [n - 4, 4]);
      const sizes: number[] = [];
      let left = n;
      while (left > 4) {
        sizes.push(3);
        left -= 3;
      }
      return grouped(national, [...sizes, 4]);
    }
  }
}

/**
 * A phone number with spaces, for showing and as it's typed: 0412 345 678,
 * (08) 9123 4567, 1800 123 456, 13 12 34, +61 412 345 678. Text that isn't a
 * number (letters, an email address) comes back as it is, so the person sees
 * what they typed next to the message saying what's wrong. A number from
 * another country is spaced after its country code (see the top of this file).
 */
export function formatPhone(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !PHONE_CHARACTERS.test(trimmed)) return text;
  const digits = digitsOf(trimmed);
  if (trimmed.startsWith('+')) {
    if (!digits.startsWith('61')) {
      const code = countryCode(digits);
      const rest = digits.slice(code.length);
      return rest ? `+${code} ${formatOverseas(code, rest)}` : `+${code}`;
    }
    const rest = digits.slice(2).replace(/^0/, '');
    return rest ? `+61 ${formatAfter61(rest)}` : '+61';
  }
  if (digits.length === 11 && digits.startsWith('61')) return `+61 ${formatAfter61(digits.slice(2))}`;
  return formatNational(digits);
}

/**
 * The next value of a phone field as it's typed: spaced as it goes, and when
 * a backspace only removed a space or bracket the formatter put there, the
 * digit before it goes instead, so backspace never gets stuck.
 */
export function typePhone(previous: string, next: string): string {
  if (
    next.length < previous.length &&
    digitsOf(next) === digitsOf(previous) &&
    next.trim().startsWith('+') === previous.trim().startsWith('+') &&
    PHONE_CHARACTERS.test(next.trim())
  ) {
    let at = 0;
    while (at < next.length && next[at] === previous[at]) at += 1;
    const before = next.slice(0, at).replace(/[0-9](?=[^0-9]*$)/, '');
    return formatPhone(before + next.slice(at));
  }
  return formatPhone(next);
}

/** A phone number as a link the phone can call. */
export function telLink(phone: string) {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}
