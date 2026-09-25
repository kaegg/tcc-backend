import {
  AMOUNT_MESSAGES,
  checkAmount,
  checkCivilDate,
  civilDateToUtc,
  DATE_MESSAGES,
  utcToCivilDate,
} from './transaction-rules';

describe('checkAmount', () => {
  it.each(['0.01', '1', '35.9', '35.90', '9999999999.99', '0012.50'])(
    'aceita %s',
    (value) => {
      expect(checkAmount(value)).toBeNull();
    },
  );

  it.each([
    ['0', AMOUNT_MESSAGES.positive],
    ['0.00', AMOUNT_MESSAGES.positive],
    ['-5', AMOUNT_MESSAGES.positive],
    ['-0.01', AMOUNT_MESSAGES.positive],
    ['10.999', AMOUNT_MESSAGES.decimals],
    ['10000000000', AMOUNT_MESSAGES.max],
    ['', AMOUNT_MESSAGES.required],
    ['abc', AMOUNT_MESSAGES.required],
    ['1e3', AMOUNT_MESSAGES.required],
    ['1,50', AMOUNT_MESSAGES.required],
    ['NaN', AMOUNT_MESSAGES.required],
    ['Infinity', AMOUNT_MESSAGES.required],
    [' 10', AMOUNT_MESSAGES.required],
  ])('recusa %j', (value, message) => {
    expect(checkAmount(value)).toBe(message);
  });

  it('recusa número JSON, que perderia precisão', () => {
    expect(checkAmount(35.9)).toBe(AMOUNT_MESSAGES.required);
    expect(checkAmount(null)).toBe(AMOUNT_MESSAGES.required);
    expect(checkAmount(undefined)).toBe(AMOUNT_MESSAGES.required);
  });
});

describe('checkCivilDate', () => {
  it.each(['2026-09-21', '2024-02-29', '2000-01-01', '2100-01-01'])(
    'aceita %s',
    (value) => {
      expect(checkCivilDate(value)).toBeNull();
    },
  );

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '26-01-01',
    '2026-9-21',
    '2026-09-21T00:00:00Z',
    '21/09/2026',
    '1999-12-31',
    '2100-01-02',
    '1900-01-01',
  ])('recusa %s', (value) => {
    expect(checkCivilDate(value)).toBe(DATE_MESSAGES.invalid);
  });

  it('pede a data quando ausente ou não é texto', () => {
    expect(checkCivilDate('')).toBe(DATE_MESSAGES.required);
    expect(checkCivilDate(undefined)).toBe(DATE_MESSAGES.required);
    expect(checkCivilDate(20260921)).toBe(DATE_MESSAGES.required);
  });
});

describe('conversão de data civil', () => {
  it('ida e volta não muda o dia, qualquer que seja o fuso do processo', () => {
    expect(utcToCivilDate(civilDateToUtc('2026-12-31'))).toBe('2026-12-31');
    expect(utcToCivilDate(civilDateToUtc('2026-01-01'))).toBe('2026-01-01');
  });
});
