import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('remove a senha de uma URL de conexao do PostgreSQL', () => {
    const texto =
      'connect ECONNREFUSED postgresql://postgres:SenhaSuperSecreta@localhost:5432/intellifinance';

    const limpo = redactSecrets(texto);

    expect(limpo).not.toContain('SenhaSuperSecreta');
    expect(limpo).toContain(
      'postgresql://***:***@localhost:5432/intellifinance',
    );
  });

  it('remove valores de campos sensiveis', () => {
    const limpo = redactSecrets('password=abc123 token: xyz789 senha=segredo');

    expect(limpo).not.toContain('abc123');
    expect(limpo).not.toContain('xyz789');
    expect(limpo).not.toContain('segredo');
  });

  it('preserva texto sem credencial', () => {
    const texto = 'QueryFailedError: relation "lancamento" does not exist';

    expect(redactSecrets(texto)).toBe(texto);
  });
});
