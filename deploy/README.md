# Produção

O sistema roda no servidor com Docker Compose, a partir de imagens publicadas pelo CI no GitHub Container Registry.
O servidor não precisa do código-fonte nem de Node: só de Docker, do `docker-compose.yml`, do `deploy.sh` e de um
`.env`.

| Serviço | Imagem | Papel |
|---|---|---|
| `postgres` | `postgres:17-bookworm` | Banco, com volume persistente |
| `migrate` | `ghcr.io/kaegg/tcc-backend-migrate` | Aplica migrações e o seed das categorias, e encerra |
| `backend` | `ghcr.io/kaegg/tcc-backend` | API NestJS, só na rede interna |
| `web` | `ghcr.io/kaegg/tcc-frontend` | Caddy: serve o frontend e encaminha `/api` ao backend |
| `ollama` | `ollama/ollama` | LLM local do chatbot, só na rede interna |

O sistema atende em `http://localhost:8080` **do servidor**, sem porta aberta para a rede. O acesso é por túnel SSH
enquanto o sistema estabiliza e, depois, por um túnel da Cloudflare, que entrega o HTTPS.

## Primeira subida

1. Conferir o Docker (se algum falhar, pedir a instalação a quem administra o servidor):

   ```bash
   docker --version && docker compose version && docker ps
   ```

   `permission denied` no `docker ps` significa que o usuário não está no grupo `docker`.
2. Baixar os arquivos para a pasta da aplicação (não precisa clonar):

   ```bash
   for f in docker-compose.yml deploy.sh .env.example; do curl -fsSLO "https://raw.githubusercontent.com/kaegg/tcc-backend/main/deploy/$f"; done
   ```
3. `cp .env.example .env`, gerar os segredos com `openssl rand -hex 24` e `openssl rand -hex 48` e preencher.
4. Subir e conferir:

   ```bash
   sh deploy.sh backend && sh deploy.sh web
   ```

   ```bash
   docker compose ps && curl -s http://localhost:8080/api/health
   ```

## Chatbot (Ollama)

O primeiro `pull` do modelo baixa alguns GB (cerca de 4,7 GB para `qwen2.5:7b`):

```bash
sh deploy.sh ollama
```

Para comparar variantes sem trocar a configurada, baixar e rodar direto no container. O `--verbose`
mostra carga e tokens/s, e o `ollama ps` informa se rodou em GPU ou CPU:

```bash
docker compose exec ollama ollama pull qwen2.5:3b
```

```bash
docker compose exec ollama ollama run qwen2.5:3b --verbose "Gastei 45 reais no mercado ontem"
```

```bash
docker compose exec ollama ollama ps
```

Variante que não for usar ocupa disco no volume; remover com `docker compose exec ollama ollama rm <variante>`.

Sem GPU, o container usa a CPU. Para usar uma GPU NVIDIA, o servidor precisa do `nvidia-container-toolkit`
(instalado pelo administrador) e de uma reserva de dispositivo no serviço `ollama` do compose.

Se o Ollama também estiver instalado direto no servidor (`systemctl is-active ollama`), os dois não conflitam
(o container não publica porta), mas cada um guarda os próprios modelos e disputa memória. Parar o do sistema:
`sudo systemctl disable --now ollama`.

## Acessar da sua máquina (túnel SSH)

```bash
ssh -N -L 8080:localhost:8080 usuario@servidor
```

Com o comando aberto, `http://localhost:8080` no seu navegador é o sistema do servidor. Precisa ser `localhost` e a
mesma porta do `PUBLIC_URL`: o cookie de sessão só é aceito em HTTPS ou em `localhost`.

## Túnel da Cloudflare

O serviço do túnel aponta para `http://localhost:8080`. Depois de criado, acrescentar o endereço público ao `.env`
e recriar API e frontend:

```
PUBLIC_URL=http://localhost:8080,https://intellifinance.exemplo.com.br
```

```bash
docker compose up -d backend web
```

O Caddy confia no `X-Forwarded-For` vindo de endereço privado (o `cloudflared` local), então a API enxerga o IP real
de cada participante. Sem isso, todos teriam o mesmo IP e o limite de cadastro por IP (5 por minuto) bloquearia o
estudo.

## Atualizar

```bash
sh deploy.sh backend
```

```bash
sh deploy.sh web
```

Cada um atualiza só o seu lado. Se a migração falhar, a API anterior continua no ar.

O job `deploy` do CI entra por SSH e fica desligado enquanto `DEPLOY_ENABLED` não for `true`. Atrás de túnel o
GitHub não alcança o servidor; a atualização automática nesse caso precisa ser puxada pelo próprio servidor.

## Operação

```bash
docker compose logs -f backend
```

Backup do banco (ali ficam os dados do estudo):

```bash
docker compose exec -T postgres pg_dump -U intellifinance intellifinance | gzip > "backup-$(date +%F).sql.gz"
```

Voltar uma versão: fixar `BACKEND_TAG` ou `FRONTEND_TAG` no `.env` com a tag `sha-<hash>` do commit desejado e rodar
o `deploy.sh` do lado correspondente. Remover a linha volta a seguir a `latest`.
