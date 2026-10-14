import { referenceDate } from './reference-date';

describe('referenceDate', () => {
  it('usa o fuso do estudo, e não o UTC do servidor', () => {
    // 02:30 UTC do dia 14 ainda é 23:30 do dia 13 em São Paulo.
    expect(referenceDate(new Date('2026-10-14T02:30:00Z'))).toEqual({
      date: '2026-10-13',
      weekday: 'terça-feira',
    });
  });
});
