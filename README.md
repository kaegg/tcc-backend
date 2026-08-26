# tcc-backend

Backend TCC - 2026

API REST do **IntelliFinance**, sistema web de gestão financeira com suporte a interface
conversacional utilizando LLM. Parte do TCC em Engenharia de Software (UEM/DIN).

A arquitetura é híbrida: **REST** para as operações convencionais (autenticação, lançamentos,
categorias, relatórios) e **WebSocket/Socket.IO** para o chatbot com streaming das respostas do
modelo. A inferência do LLM roda localmente via Ollama + Qwen 2.5, para não enviar dados
financeiros a provedores externos.

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | NestJS 11 |
| Linguagem | TypeScript 5.9 |
| Banco | PostgreSQL 17 |
| ORM | Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Validação | class-validator + class-transformer |
| Autenticação | Passport JWT + argon2 |
| Documentação | Swagger (OpenAPI) |
| Segurança | Helmet |

## Pré-requisitos

- **Node.js 24 LTS** (a versão usada está em `.nvmrc`).
- **PostgreSQL 17**.
- No Windows, o `psql` normalmente não está no PATH. O caminho padrão é:
  `C:\Program Files\PostgreSQL\17\bin\psql.exe`

## Configuração

**1. Instalar as dependências**

```bash
npm install
```

O `postinstall` roda `prisma generate` automaticamente e cria o Prisma Client em
`src/generated/prisma` (pasta ignorada pelo git).

**2. Criar o banco**

```bash
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "CREATE DATABASE intellifinance;"
```

**3. Configurar as variáveis de ambiente**

```bash
cp .env.example .env
```

Depois edite o `.env` e preencha a senha do PostgreSQL em `DATABASE_URL`. Gere também um
`JWT_SECRET` próprio:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP do servidor (padrão `3000`) |
| `CORS_ORIGIN` | Origem do frontend liberada no CORS (padrão `http://localhost:5173`) |
| `DATABASE_URL` | String de conexão do PostgreSQL |
| `JWT_SECRET` | Segredo de assinatura do token |
| `JWT_EXPIRES_IN` | Validade do token (ex.: `1d`) |

## Execução

```bash
npm run start:dev
```

- API: `http://localhost:3000`
- Documentação Swagger: `http://localhost:3000/api/docs`

Se o banco ainda não estiver configurado, a aplicação sobe assim mesmo e registra um erro no log
avisando que nenhuma query vai funcionar.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe em modo watch |
| `npm run build` | Compila para `dist/` (roda `prisma generate` antes) |
| `npm run start:prod` | Executa o build |
| `npm run lint` | ESLint com `--fix` |
| `npm test` | Testes unitários (Jest) |
| `npm run test:e2e` | Testes end-to-end |
| `npm run test:cov` | Cobertura |
| `npm run prisma:generate` | Regenera o Prisma Client |
| `npm run prisma:migrate` | Cria e aplica uma migração de desenvolvimento |
| `npm run prisma:deploy` | Aplica migrações pendentes (produção) |
| `npm run prisma:reset` | Recria o banco do zero e reaplica todas as migrações |
| `npm run prisma:studio` | Abre o Prisma Studio |

## Padrões da API REST

Validação, serialização e tratamento de exceções são registrados como providers em
`src/common/common.module.ts` (via `APP_PIPE`, `APP_INTERCEPTOR` e `APP_FILTER`) em vez de em
`main.ts`. Assim os testes e2e, que montam a aplicação pelo módulo, exercitam exatamente a mesma
configuração que roda em produção.

- **Validação global** — `ValidationPipe` com `whitelist` (remove campo não declarado no DTO) e
  `forbidNonWhitelisted` (rejeita a requisição que enviar um).
- **Serialização** — `ClassSerializerInterceptor`, para que `@Exclude()` em campo como senha valha
  em toda resposta.
- **Erros** — `AllExceptionsFilter` devolve sempre o mesmo corpo:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Lançamento não encontrado",
  "path": "/transactions/42",
  "timestamp": "2026-08-26T15:51:19.589Z"
}
```

Exceções que não são `HttpException` (falha do Prisma, bug, banco fora do ar) nunca têm o texto
original repassado ao cliente — viram uma mensagem genérica com status 500. O detalhe técnico vai
só para o log do servidor, e ainda assim passa por `redactSecrets()`, que mascara credenciais em
string de conexão e em campos como `password`, `token` e `senha`.

## Estrutura

```
prisma/
  schema.prisma          # modelos e generator (TCC-005)
prisma.config.ts         # configuração do CLI (schema, migrations, DATABASE_URL)
src/
  common/
    common.module.ts     # pipe, interceptor e filtro globais
    filters/             # AllExceptionsFilter
    utils/redact.ts      # remoção de credenciais dos logs
  generated/prisma/      # Prisma Client gerado (não versionado)
  prisma/                # PrismaModule e PrismaService
  auth/                  # TCC-009  - login, logout, sessão
  users/                 # TCC-008, TCC-010 - cadastro e perfil
  transactions/          # TCC-012 a TCC-015 - lançamentos
  categories/            # TCC-011 - categorias financeiras
  reports/               # TCC-016, TCC-017 - relatórios
  chat/                  # TCC-021, TCC-022 - chatbot (gateway Socket.IO)
  app.module.ts
  main.ts                # Helmet, CORS e Swagger
test/
  app.e2e-spec.ts
  error-handling.e2e-spec.ts   # prova o formato de erro e o não vazamento
```