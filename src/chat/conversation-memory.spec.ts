import { ConversationMemory } from './conversation-memory';

describe('ConversationMemory', () => {
  let agora: number;
  let memory: ConversationMemory;

  beforeEach(() => {
    agora = 0;
    memory = new ConversationMemory(() => agora);
  });

  it('separa o histórico por usuário e por conversa', () => {
    memory.append('u1', 'c1', { role: 'user', content: 'a' });
    memory.append('u2', 'c1', { role: 'user', content: 'b' });

    expect(memory.history('u1', 'c1')).toEqual([
      { role: 'user', content: 'a' },
    ]);
    expect(memory.history('u1', 'c2')).toEqual([]);
  });

  it('esquece só a conversa excluída', () => {
    memory.append('u1', 'c1', { role: 'user', content: 'a' });
    memory.append('u1', 'c2', { role: 'user', content: 'b' });

    memory.forget('u1', 'c1');

    expect(memory.history('u1', 'c1')).toEqual([]);
    expect(memory.history('u1', 'c2')).toHaveLength(1);
  });

  it('guarda só as falas mais recentes', () => {
    for (let i = 0; i < 20; i++) {
      memory.append('u1', 'c1', { role: 'user', content: String(i) });
    }

    const historico = memory.history('u1', 'c1');
    expect(historico).toHaveLength(12);
    expect(historico[0].content).toBe('8');
  });

  it('descarta a conversa menos usada além do limite por usuário', () => {
    for (let i = 0; i < 21; i++) {
      memory.append('u1', `c${i}`, { role: 'user', content: 'x' });
    }

    expect(memory.history('u1', 'c0')).toEqual([]);
    expect(memory.history('u1', 'c20')).toHaveLength(1);
  });

  it('esquece conversas paradas', () => {
    memory.append('u1', 'c1', { role: 'user', content: 'x' });
    agora += 6 * 60 * 60 * 1000 + 1;

    expect(memory.history('u1', 'c1')).toEqual([]);
  });

  it('devolve cópia, sem expor o estado interno', () => {
    memory.append('u1', 'c1', { role: 'user', content: 'x' });
    memory.history('u1', 'c1').push({ role: 'assistant', content: 'forjado' });

    expect(memory.history('u1', 'c1')).toHaveLength(1);
  });
});
