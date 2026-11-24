import { formatPhone, isPhoneNumber, phoneProblem, telLink, typePhone } from '@/lib/phone';

/** Types the text one character at a time, as a keyboard would. */
function typed(text: string) {
  let value = '';
  for (const ch of text) value = typePhone(value, value + ch);
  return value;
}

/** Presses backspace at the end of the field. */
const backspace = (value: string) => typePhone(value, value.slice(0, -1));

describe('isPhoneNumber', () => {
  it.each([
    '0412 345 678',
    '0412345678',
    '0512 345 678',
    '(08) 9123 4567',
    '02 9123 4567',
    '03-9123-4567',
    '07.3123.4567',
    '1800 955 900',
    '1800 55 1800',
    '1300 123 456',
    '13 12 34',
    '+61 412 345 678',
    '+61 8 9123 4567',
    '+61 (0)8 9123 4567',
    '+61-412-345-678',
    '61412345678',
    '+44 20 7946 0958',
    '+64 21 123 4567',
    '  0412 345 678  ',
  ])('accepts %s', (text) => {
    expect(isPhoneNumber(text)).toBe(true);
  });

  it.each([
    '',
    '   ',
    'safe@netballwa.com.au',
    'call the office',
    '1800 955 900 ext 2',
    '9123 4567',
    '0412 345 67',
    '0412 345 6789',
    '06 9123 4567',
    '0412+345678',
    '+',
    '+61',
    '+44 123',
    '+44 1234 5678 9012 3456',
    '+0412 345 678',
    '000',
    '1900 123 456',
  ])('refuses %s', (text) => {
    expect(isPhoneNumber(text)).toBe(false);
  });
});

describe('phoneProblem', () => {
  it('is fine when blank, unless a number is needed', () => {
    expect(phoneProblem('')).toBeNull();
    expect(phoneProblem('  ')).toBeNull();
    expect(phoneProblem('', { required: true })).toBe('Add a phone number');
  });

  it('is fine for a phone number', () => {
    expect(phoneProblem('1800 955 900')).toBeNull();
    expect(phoneProblem('(08) 9123 4567', { required: true })).toBeNull();
  });

  it('says when an email address was entered', () => {
    expect(phoneProblem('safe@netballwa.com.au')).toBe(
      'That looks like an email address. Enter a phone number, such as 0412 345 678.',
    );
  });

  it('says a number has only digits and spaces when there are words', () => {
    expect(phoneProblem('ring the office')).toBe(
      'A phone number has only digits and spaces, such as 0412 345 678.',
    );
  });

  it('asks for the area code on an 8-digit local number', () => {
    expect(phoneProblem('9123 4567')).toBe('Add the area code, such as (08) 9123 4567.');
  });

  it('gives examples for a number of the wrong shape', () => {
    const problem =
      'Enter an Australian phone number, such as 0412 345 678 or (08) 9123 4567, or start a number from overseas with +.';
    expect(phoneProblem('0412 345 67')).toBe(problem);
    expect(phoneProblem('1234 5678 9')).toBe(problem);
    expect(phoneProblem('+44 123')).toBe(problem);
  });
});

describe('formatPhone', () => {
  it.each([
    ['0412345678', '0412 345 678'],
    ['04 1234 5678', '0412 345 678'],
    ['0891234567', '(08) 9123 4567'],
    ['08 9123 4567', '(08) 9123 4567'],
    ['(02)91234567', '(02) 9123 4567'],
    ['1800955900', '1800 955 900'],
    ['1800 55 1800', '1800 551 800'],
    ['1300123456', '1300 123 456'],
    ['131234', '13 12 34'],
    ['+61412345678', '+61 412 345 678'],
    ['+61 (0)8 9123 4567', '+61 8 9123 4567'],
    ['61412345678', '+61 412 345 678'],
    ['+442079460958', '+44 20 7946 0958'],
    ['+447911123456', '+44 7911 123456'],
    ['+441614960000', '+44 161 496 0000'],
    ['+6421123456', '+64 21 123 456'],
    ['+64211234567', '+64 21 123 4567'],
    ['+6491234567', '+64 9 123 4567'],
    ['+14155552671', '+1 415 555 2671'],
    ['+33612345678', '+33 612 345 678'],
    ['+6591234567', '+65 9123 4567'],
    ['+852 2123 4567', '+852 2123 4567'],
    ['+4930123456789', '+49 301 234 567 89'],
    ['  0412345678 ', '0412 345 678'],
  ])('shows %s as %s', (text, shown) => {
    expect(formatPhone(text)).toBe(shown);
  });

  it('leaves text that is not a number as it is', () => {
    expect(formatPhone('safe@netballwa.com.au')).toBe('safe@netballwa.com.au');
    expect(formatPhone('call me')).toBe('call me');
    expect(formatPhone('')).toBe('');
  });

  it('spaces short and over-long numbers without losing digits', () => {
    expect(formatPhone('0')).toBe('0');
    expect(formatPhone('08')).toBe('08');
    expect(formatPhone('1234')).toBe('1234');
    expect(formatPhone('23456789')).toBe('2345 6789');
    expect(formatPhone('0412 345 6789')).toBe('0412 345 678 9');
    expect(formatPhone('+')).toBe('+');
    expect(formatPhone('+6')).toBe('+6');
    expect(formatPhone('+61')).toBe('+61');
  });

  it('keeps every number it accepts accepted', () => {
    for (const text of ['0412345678', '(08) 9123 4567', '1800 55 1800', '131234', '+61 412 345 678', '61412345678', '+44 20 7946 0958']) {
      expect(isPhoneNumber(formatPhone(text))).toBe(true);
    }
  });
});

describe('typePhone', () => {
  it('spaces a mobile as it is typed', () => {
    expect(typed('04')).toBe('04');
    expect(typed('0412')).toBe('0412');
    expect(typed('04123')).toBe('0412 3');
    expect(typed('0412345')).toBe('0412 345');
    expect(typed('0412345678')).toBe('0412 345 678');
  });

  it('puts a landline area code in brackets once the number starts', () => {
    expect(typed('08')).toBe('08');
    expect(typed('089')).toBe('(08) 9');
    expect(typed('0891234567')).toBe('(08) 9123 4567');
  });

  it('spaces 13, 1300 and 1800 numbers', () => {
    expect(typed('131234')).toBe('13 12 34');
    expect(typed('1300123456')).toBe('1300 123 456');
    expect(typed('1800955900')).toBe('1800 955 900');
  });

  it('spaces +61 numbers', () => {
    expect(typed('+61412345678')).toBe('+61 412 345 678');
    expect(typed('+61891234567')).toBe('+61 8 9123 4567');
  });

  it('spaces overseas numbers after the country code', () => {
    expect(typed('+4')).toBe('+4');
    expect(typed('+44')).toBe('+44');
    expect(typed('+442')).toBe('+44 2');
    expect(typed('+442079460958')).toBe('+44 20 7946 0958');
    expect(typed('+64211234567')).toBe('+64 21 123 4567');
    expect(typed('+14155552671')).toBe('+1 415 555 2671');
    expect(backspace('+44 2')).toBe('+44');
  });

  it('keeps letters and @ as typed, so the message can say what is wrong', () => {
    expect(typed('safe@club.au')).toBe('safe@club.au');
  });

  it('never gets stuck when backspace lands on a space or bracket', () => {
    expect(backspace('0412 3')).toBe('0412');
    expect(backspace('0412 345 6')).toBe('0412 345');
    expect(backspace('(08) 9')).toBe('08');
    let value = '0412 345 678';
    for (let i = 0; i < 10; i += 1) value = backspace(value);
    expect(value).toBe('');
  });

  it('deletes the digit before a space removed in the middle', () => {
    // Backspace just after "0412", which removes the space the field shows.
    expect(typePhone('0412 345 678', '0412345 678')).toBe('0413 456 78');
  });

  it('takes a pasted number and spaces it', () => {
    expect(typePhone('', '+61 412 345 678')).toBe('+61 412 345 678');
    expect(typePhone('', '0891234567')).toBe('(08) 9123 4567');
  });
});

describe('telLink', () => {
  it('keeps only digits and +', () => {
    expect(telLink('(08) 9123 4567')).toBe('tel:0891234567');
    expect(telLink('+61 412 345 678')).toBe('tel:+61412345678');
  });
});
