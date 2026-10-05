# Produção

O sistema roda no servidor com Docker Compose, a partir de imagens publicadas pelo CI no GitHub Container Registry.
O servidor não precisa do código-fonte nem de Node: só de Docker, do `docker-compose.yml`, do `deploy.sh` e de um
`.env`.

| Serviço | Imagem | Papel |
|---|---|---|
| `postgres` | `postgres:17-bookworm` | Banco, com volume persistente |
| `migrate` | `ghcr.io/kaegg/tcc-backend-migrate` | Aplica migrações e o seed das categorias, e encerra |
| `backend` | `ghcr.io/kaegg/tcc-backend` | API NestJS, só na rede interna |
| `web` | `ghcr.io/kaegg/tcc-frontend` | Caddy: serve o frontend, encaminha `/api` e cuida do HTTPS |
| `ollama` | `ollama/ollama` | Profile `llm`, desligado até a TCC-020 |

## Fluxo de atualização

```
push na main ─► CI (lint, testes, build) ─► publica a imagem ─► se DEPLOY_ENABLED=true, deploy via SSH
```

- Push na `main` do **backend** atualiza só `migrate` e `backend` (e envia o compose e o `deploy.sh` atualizados).
- Push na `main` do **frontend** atualiza só o `web`.
- Branches `main#TCC-xxx` só passam pelas verificações.
- Se a migração falhar, a API anterior continua no ar e o job falha no GitHub.

## Primeira subida no servidor

1. Instalar o Docker Engine com o plugin Compose (`docker compose version` precisa responder).
2. Criar a pasta da aplicação e copiar para ela os arquivos desta pasta:

   ```bash
   sudo mkdir -p /opt/intellifinance && sudo chown "$USER" /opt/intellifinance
   ```

   Copiar `docker-compose.yml`, `deploy.sh` e `.env.example` (com `scp` ou colando o conteúdo).
3. `cp .env.example .env` e preencher. As instruções de cada variável estão no próprio arquivo.
4. Subir:

   ```bash
   sh deploy.sh backend && sh deploy.sh web
   ```

As imagens são públicas, então não precisa de `docker login`.

## Ligar o deploy automático

Configurar **nos dois repositórios** (Settings → Secrets and variables → Actions). Conta pessoal no GitHub não tem
segredo compartilhado entre repositórios, então os valores são cadastrados duas vezes.

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | Chave privada de um par criado só para o deploy |
| Secret | `DEPLOY_KNOWN_HOSTS` | Saída de `ssh-keyscan -p <porta> <host>`, conferida com a impressão digital do servidor |
| Variable | `DEPLOY_HOST` | IP ou domínio do servidor |
| Variable | `DEPLOY_USER` | Usuário do servidor, membro do grupo `docker` |
| Variable | `DEPLOY_PATH` | `/opt/intellifinance` |
| Variable | `DEPLOY_SSH_PORT` | Opcional; padrão 22 |
| Variable | `DEPLOY_ENABLED` | `true` liga o deploy; qualquer outro valor pausa |

Par de chaves do deploy, gerado na sua máquina:

```bash
ssh-keygen -t ed25519 -N "" -C deploy-intellifinance -f deploy_intellifinance
```

A chave pública (`.pub`) vai para `~/.ssh/authorized_keys` do usuário no servidor; a privada vai para o secret
`DEPLOY_SSH_KEY` dos dois repositórios e depois pode ser apagada da sua máquina.

**Durante o estudo de usabilidade**, troque `DEPLOY_ENABLED` para `false` nos dois repositórios. As imagens continuam
sendo publicadas, mas nada muda no servidor até religar.

Se o GitHub não alcançar o servidor por SSH (servidor atrás de VPN ou firewall da universidade), o job `deploy` muda
para um runner auto-hospedado no próprio servidor; publicação e `deploy.sh` continuam iguais.

## Operação

```bash
docker compose ps
```

```bash
docker compose logs -f backend
```

Voltar uma versão: fixar `BACKEND_TAG` ou `FRONTEND_TAG` no `.env` com a tag `sha-<hash>` do commit desejado e rodar
`sh deploy.sh backend` (ou `web`). Remover a linha volta a seguir a `latest`.
