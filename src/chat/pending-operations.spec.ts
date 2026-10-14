import { emptyEntities } from './interpretation/entities';
import { PendingOperations } from './pending-operations';

const operacao = () => ({
  intent: 'registrar_lancamento' as const,
  state: { entities: emptyEntities(), clarifications: [], defaults: [] },
  attempts: {},
});

describe('PendingOperations', () => {
  let agora: number;
  let pendentes: PendingOperations;

  beforeEach(() => {
    agora = 0;
    pendentes = new PendingOperations(() => agora);
  });

  it('separa por usuário e por conversa', () => {
    pendentes.set('u1', 'c1', operacao());

    expect(pendentes.get('u1', 'c1')).not.toBeNull();
    expect(pendentes.get('u1', 'c2')).toBeNull();
    expect(pendentes.get('u2', 'c1')).toBeNull();
  });

  it('expira depois de 15 minutos parado', () => {
    pendentes.set('u1', 'c1', operacao());
    agora += 15 * 60 * 1000 + 1;

    expect(pendentes.get('u1', 'c1')).toBeNull();
  });

  it('cada atualização renova o prazo', () => {
    pendentes.set('u1', 'c1', operacao());
    agora += 10 * 60 * 1000;
    pendentes.set('u1', 'c1', operacao());
    agora += 10 * 60 * 1000;

    expect(pendentes.get('u1', 'c1')).not.toBeNull();
  });

  it('limita a quantidade por usuário, descartando a mais antiga', () => {
    for (let i = 0; i <= 20; i++) pendentes.set('u1', `c${i}`, operacao());

    expect(pendentes.get('u1', 'c0')).toBeNull();
    expect(pendentes.get('u1', 'c20')).not.toBeNull();
  });

  it('informa se havia algo para remover', () => {
    pendentes.set('u1', 'c1', operacao());

    expect(pendentes.delete('u1', 'c1')).toBe(true);
    expect(pendentes.delete('u1', 'c1')).toBe(false);
  });
});
