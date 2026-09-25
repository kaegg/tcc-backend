import { escapeLike, transactionFilters } from './transaction-filters';

describe('escapeLike', () => {
  it.each([
    ['almoço', 'almoço'],
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['c:\\temp', 'c:\\\\temp'],
    ['%_\\', '\\%\\_\\\\'],
  ])('%j vira %j', (entrada, esperado) => {
    expect(escapeLike(entrada)).toBe(esperado);
  });
});

describe('transactionFilters', () => {
  it('sem filtros não restringe nada', () => {
    expect(transactionFilters({})).toEqual({});
  });

  it('combina todos os filtros', () => {
    expect(
      transactionFilters({
        from: '2026-09-01',
        to: '2026-09-30',
        type: 'despesa',
        categoryId: '0199a1b2-c3d4-7000-8000-00000000c001',
        search: 'mercado',
      }),
    ).toEqual({
      type: 'despesa',
      categoryId: '0199a1b2-c3d4-7000-8000-00000000c001',
      date: {
        gte: new Date('2026-09-01T00:00:00.000Z'),
        lte: new Date('2026-09-30T00:00:00.000Z'),
      },
      description: { contains: 'mercado', mode: 'insensitive' },
    });
  });

  it('período aberto em uma das pontas', () => {
    expect(transactionFilters({ from: '2026-09-01' })).toEqual({
      date: { gte: new Date('2026-09-01T00:00:00.000Z') },
    });
    expect(transactionFilters({ to: '2026-09-30' })).toEqual({
      date: { lte: new Date('2026-09-30T00:00:00.000Z') },
    });
  });

  it('busca vazia não filtra', () => {
    expect(transactionFilters({ search: '' })).toEqual({});
  });

  it('escapa os curingas da busca', () => {
    expect(transactionFilters({ search: '100%' }).description).toEqual({
      contains: '100\\%',
      mode: 'insensitive',
    });
  });
});
