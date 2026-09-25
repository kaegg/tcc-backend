import { checkMonth, MONTH_MESSAGES, monthToPeriod } from './report-month';

describe('checkMonth', () => {
  it.each(['2026-09', '2000-01', '2100-01', '2026-12'])('aceita %s', (m) => {
    expect(checkMonth(m)).toBeNull();
  });

  it.each([
    '2026-13',
    '2026-00',
    '2026-9',
    '26-09',
    '2026-09-01',
    '09/2026',
    '1999-12',
    '2100-02',
  ])('recusa %s', (m) => {
    expect(checkMonth(m)).toBe(MONTH_MESSAGES.invalid);
  });

  it.each([undefined, '', '   ', 202609])('pede o mês quando %j', (m) => {
    expect(checkMonth(m)).toBe(MONTH_MESSAGES.required);
  });
});

describe('monthToPeriod', () => {
  it.each([
    ['2026-09', '2026-09-01', '2026-09-30'],
    ['2026-12', '2026-12-01', '2026-12-31'],
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2028-02', '2028-02-01', '2028-02-29'],
    ['2000-02', '2000-02-01', '2000-02-29'],
    ['2100-01', '2100-01-01', '2100-01-31'],
  ])('%s vai de %s a %s', (month, from, to) => {
    expect(monthToPeriod(month)).toEqual({ from, to });
  });
});
