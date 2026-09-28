import {
  checkMonth,
  MONTH_MESSAGES,
  monthSpan,
  monthsInPeriod,
  monthToPeriod,
} from './report-month';

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

describe('monthsInPeriod', () => {
  it('recorta o primeiro e o último mês pelas pontas do período', () => {
    expect(monthsInPeriod({ from: '2026-08-15', to: '2026-10-10' })).toEqual([
      { month: '2026-08', from: '2026-08-15', to: '2026-08-31' },
      { month: '2026-09', from: '2026-09-01', to: '2026-09-30' },
      { month: '2026-10', from: '2026-10-01', to: '2026-10-10' },
    ]);
  });

  it('atravessa a virada do ano', () => {
    expect(
      monthsInPeriod({ from: '2025-12-01', to: '2026-01-31' }).map(
        (m) => m.month,
      ),
    ).toEqual(['2025-12', '2026-01']);
  });

  it('um dia só é um mês só', () => {
    expect(monthsInPeriod({ from: '2026-09-10', to: '2026-09-10' })).toEqual([
      { month: '2026-09', from: '2026-09-10', to: '2026-09-10' },
    ]);
  });
});

describe('monthSpan', () => {
  it.each([
    ['2026-09-01', '2026-09-30', 1],
    ['2026-09-30', '2026-10-01', 2],
    ['2025-01-01', '2026-12-31', 24],
    ['2025-01-01', '2027-01-01', 25],
  ])('%s a %s toca %i meses', (from, to, meses) => {
    expect(monthSpan(from, to)).toBe(meses);
  });
});
