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
| `DATABASE_URL_TEST` | Opcional. Banco separado usado por `test/schema-constraints.e2e-spec.ts`; sem ela o spec é pulado |
| `SEED_DEMO` | Opcional. Com `true`, o seed também cria usuário e lançamentos de demonstração |
| `SEED_DEMO_PASSWORD` | Exigida quando `SEED_DEMO=true`. Não tem valor padrão de propósito |

**4. Aplicar as migrações e semear as categorias**

```bash
npm run prisma:migrate
```

Cria as tabelas e roda o seed, que insere as dez categorias do sistema. Para ter também um
usuário e lançamentos de demonstração, defina `SEED_DEMO=true` e `SEED_DEMO_PASSWORD` no `.env`
antes de rodar `npm run prisma:seed`.

## Execução

```bash
npm run start:dev
```

- API: `http://localhost:3000/api` — todas as rotas REST ficam sob o prefixo `/api`
- Documentação Swagger: `http://localhost:3000/api/docs`

Se o banco ainda não estiver configurado, a aplicação sobe assim mesmo e registra um erro no log
avisando que nenhuma query vai funcionar.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe em modo watch |
| `npm run build` | Compila para `dist/` (roda `prisma generate` antes) |
| `npm run start:prod` | Executa o build |
| `npm run verify` | **Roda o portão completo: lint, build, unitários e e2e** |
| `npm run lint` | ESLint — reprova sem corrigir, e é o que o CI executa |
| `npm run lint:fix` | ESLint corrigindo o que der (uso local) |
| `npm run format` | Prettier reescrevendo os arquivos |
| `npm test` | Testes unitários (Jest) |
| `npm run test:e2e` | Testes end-to-end |
| `npm run test:cov` | Cobertura |
| `npm run prisma:generate` | Regenera o Prisma Client |
| `npm run prisma:migrate` | Cria e aplica uma migração de desenvolvimento |
| `npm run prisma:deploy` | Aplica migrações pendentes (produção) |
| `npm run prisma:reset` | Recria o banco do zero, reaplica todas as migrações e roda o seed |
| `npm run prisma:seed` | Roda o seed sem recriar o banco |
| `npm run prisma:studio` | Abre o Prisma Studio |

## Endpoints

| Método | Rota | O que faz | Issue |
|---|---|---|---|
| `GET` | `/api/health` | Disponibilidade da API e do PostgreSQL | TCC-006 |
| `GET` | `/api/categories` | Categorias ativas do sistema; aceita `?type=receita\|despesa` | TCC-006 |

`GET /api/health` responde **200** quando tudo opera e **503** quando alguma dependência caiu, com o
mesmo corpo nos dois casos:

```json
{
  "status": "ok",
  "timestamp": "2026-09-02T21:57:03.482Z",
  "uptimeSeconds": 15,
  "dependencies": { "database": { "status": "ok", "latencyMs": 3 } }
}
```

É o único endpoint que, fora da faixa 2xx, não usa o envelope de erro da API: lançar
`ServiceUnavailableException` perderia a informação de **qual** dependência falhou, e o frontend
precisa distinguir três situações — API saudável, API viva com o banco fora, e API sem resposta.

O corpo é deliberadamente pobre: não traz versão, host, nome do banco nem mensagem do driver. Um
health público que descreve a infraestrutura é reconhecimento gratuito para quem varre a rede. O
motivo real da falha vai só para o log, já mascarado por `redactSecrets()`.

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

Erros de validação chegam com `message` como **lista de strings** (uma por violação), e não como
string única. O cliente precisa tratar os dois formatos.

### Configuração de infraestrutura

Prefixo global, CORS, Helmet e os parsers de corpo ficam em `src/configure-app.ts`, chamado pelo
`main.ts` **e** pelos testes e2e. O motivo é o mesmo dos providers acima: os testes montam a
aplicação pelo `AppModule` e nunca executam `bootstrap()`. Com o prefixo só no `main.ts`, a suíte
exercitaria `/categories` enquanto o processo real serve `/api/categories` — passaria provando o
oposto do que roda.

`configureApp()` precisa ser chamado **antes** de `SwaggerModule.createDocument`, senão o documento
sai sem o prefixo e todo "Try it out" responde 404 com a API no ar.

### CORS

`CORS_ORIGIN` aceita uma lista separada por vírgula. As origens são normalizadas (sem barra final,
minúsculas), porque o header `Origin` nunca traz barra final e a comparação é sensível a caixa.

Origem fora da lista **não** vira erro: a resposta segue normal, apenas sem os headers de CORS, e o
servidor registra um aviso. Rejeitar com `Error` faria o pacote `cors` repassar ao `next()`, o filtro
global capturaria e tudo viraria 500 — inclusive requisição sem header `Origin`, que é o caso de
`curl`, dos testes e de qualquer sonda de infraestrutura.

Requisição sem `Origin` é liberada: CORS é regra de navegador, e sem `Origin` não há o que proteger.

### Limite de corpo

Os parsers são registrados com limite explícito de `100kb` (`NestFactory.create` recebe
`bodyParser: false` para que `configureApp` os registre).

As falhas do parser são traduzidas em `src/common/middleware/body-parser-errors.ts`, registrado logo
depois dos parsers. Não dá para tratá-las no filtro global: o parser lança `http-errors`, não
`HttpException`, e o Nest reescreve `SyntaxError` como `BadRequestException` com a mensagem crua do
motor de JavaScript **antes** de qualquer filtro ver o erro. No middleware o erro ainda está inteiro.

| Situação | Status | Mensagem |
|---|---|---|
| Corpo acima do limite | 413 | Corpo da requisição excede o limite permitido. |
| JSON malformado | 400 | Corpo da requisição não é um JSON válido. |

O texto original nunca é repassado: ele revela o limite configurado, o tamanho recebido e a posição
do caractere que quebrou o parse.

## Banco de dados

O esquema físico está em `prisma/schema.prisma` e é aplicado pela migração `initial_schema`. Seis tabelas:

| Tabela | Papel |
|---|---|
| `users` | Conta do usuário. Senha só como hash argon2, em `password_hash` |
| `categories` | Categorias do sistema, compartilhadas por todos os usuários |
| `transactions` | Receitas e despesas, com exclusão lógica |
| `conversations` | Conversas do chatbot |
| `chat_messages` | Mensagens de uma conversa |
| `usage_metrics` | Métricas do estudo comparativo, sem vínculo com o usuário |

### Restrições de integridade

Além das chaves e dos `NOT NULL`, a migração acrescenta `CHECK` constraints escritas à mão — o
`schema.prisma` não as expressa. O Prisma Migrate também não as gerencia, então sobrevivem às
migrações geradas depois.

| Constraint | Garante |
|---|---|
| `transactions_amount_positive` | Valor sempre maior que zero; o sinal vem do tipo |
| `transactions_description_not_blank` | Descrição não é espaço em branco |
| `transactions_date_in_range` | Data entre 2000 e 2100, barrando erro de digitação de ano |
| `transactions_deleted_after_created` | `deleted_at` nunca anterior a `created_at` |
| `users_email_lowercase` | E-mail sempre em minúsculo, o que faz o índice único valer sem diferenciar maiúsculas, sem a extensão `citext` |
| `users_email_has_at` | E-mail tem a forma mínima `a@b` |
| `users_name_not_blank` | Nome com ao menos 3 caracteres não brancos |
| `categories_name_not_blank` | Nome de categoria não é espaço em branco |
| `chat_messages_content_not_blank` | Mensagem não é vazia |
| `usage_metrics_finished_after_started` | Tarefa não termina antes de começar |
| `usage_metrics_counts_not_negative` | Contadores de interação e erro não negativos |
| `usage_metrics_duration_not_negative` | Duração não negativa |

A regra "data não pode estar no futuro" **não** é um `CHECK`: `CURRENT_DATE` não é `IMMUTABLE` e o
PostgreSQL recusa função não-imutável dentro de uma constraint. Ela fica na validação do DTO.

`test/schema-constraints.e2e-spec.ts` prova cada uma dessas restrições contra um PostgreSQL real.
O spec roda em `DATABASE_URL_TEST` e é pulado por inteiro quando a variável não existe:

```bash
"C:\Program Files\PostgreSQLin\psql.exe" -U postgres -c "CREATE DATABASE intellifinance_test;"
```

O script `test:e2e` chama o Jest por `node --experimental-vm-modules` em vez de invocar o
binário direto. O Prisma 7 carrega o compilador de queries por importação dinâmica, que o
ambiente de VM do Jest só aceita com essa flag; sem ela, qualquer consulta dentro de um teste
falha com `A dynamic import callback was invoked without --experimental-vm-modules`. A flag vai
no `node` e não em `NODE_OPTIONS=` porque a sintaxe de variável inline não funciona no `cmd.exe`,
e o projeto precisa rodar em Windows e Linux.

### Migrações e reversão

O Prisma Migrate não gera migrações *down*. A repetibilidade exigida pela issue é demonstrada por
`npm run prisma:reset`, que derruba o banco, reaplica todo o histórico e roda o seed. Quando um
script de rollback explícito for necessário, ele é gerado sob demanda:

```bash
npx prisma migrate diff --from-schema prisma/schema.prisma --to-empty --script
```

## Estrutura

```
prisma/
  schema.prisma          # enums, modelos, índices e relacionamentos (TCC-005)
  migrations/            # histórico versionado; os CHECK ficam no fim do .sql
  seed.ts                # categorias do sistema; demo só com SEED_DEMO=true
prisma.config.ts         # configuração do CLI (schema, migrations, seed, DATABASE_URL)
src/
  common/
    common.module.ts     # pipe, interceptor e filtro globais
    cors-origins.ts      # lista de origens do CORS (reusada pelo gateway na TCC-022)
    filters/             # AllExceptionsFilter
    middleware/          # tradução das falhas do body-parser
    utils/redact.ts      # remoção de credenciais dos logs
  generated/prisma/      # Prisma Client gerado (não versionado)
  prisma/                # PrismaModule, PrismaService e scopes.ts (filtros RN07/RN09)
  health/                # TCC-006 - disponibilidade da API e do banco
  auth/                  # TCC-009  - login, logout, sessão
  users/                 # TCC-008, TCC-010 - cadastro e perfil
  transactions/          # TCC-012 a TCC-015 - lançamentos
  categories/            # TCC-011 - categorias financeiras
  reports/               # TCC-016, TCC-017 - relatórios
  chat/                  # TCC-021, TCC-022 - chatbot (gateway Socket.IO)
  app.module.ts
  configure-app.ts       # Helmet, CORS, prefixo /api e parsers (usado por main e pelos e2e)
  main.ts                # bootstrap e Swagger
test/
  create-test-app.ts             # monta a app como em produção, com Prisma dublado
  app.e2e-spec.ts                # prova que o prefixo /api está ativo
  health.e2e-spec.ts             # 200/503, timeout da sonda e não vazamento
  categories.e2e-spec.ts         # envelope, filtro de tipo e rejeição de query
  body-limit.e2e-spec.ts         # 413 e 400 do body-parser
  error-handling.e2e-spec.ts     # prova o formato de erro e o não vazamento
  schema-constraints.e2e-spec.ts # prova as restrições do esquema no banco real
```