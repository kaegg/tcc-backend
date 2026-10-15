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
   for f in docker-compose.yml deploy.sh auto-deploy.sh .env.example; do curl -fsSLO "https://raw.githubusercontent.com/kaegg/tcc-backend/main/deploy/$f"; done
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

O túnel e o nginx de entrada pertencem a outro compose do servidor (`servidor_web`), que atende várias aplicações e
separa cada uma pelo domínio. O caminho de uma requisição é:

```
Cloudflare → cloudflared → nginx (servidor_web) → web (Caddy) → backend
```

O `web` deste compose entra na rede `EDGE_NETWORK` daquele, com o nome `intellifinance-app`, e o nginx encaminha
`intellifinance.com.br` para `intellifinance-app:80`. No `.env`:

```
PUBLIC_URL=http://localhost:8080,https://intellifinance.com.br
EDGE_NETWORK=servidor_web_intellifinance_backend
```

A rede precisa existir antes do `up` deste compose; se o `servidor_web` for derrubado com `down`, subir ele de novo e
depois recriar o `web` daqui (`docker compose up -d web`).

São três proxies à frente da API (Caddy, nginx e `cloudflared`), cada um acrescentando um endereço ao
`X-Forwarded-For`; por isso `TRUST_PROXY_HOPS=3`. Com menos, todos os participantes teriam o IP do `cloudflared` e o
limite de cadastro por IP (5 por minuto) bloquearia o estudo.

## Atualizar

```bash
sh deploy.sh backend
```

```bash
sh deploy.sh web
```

Cada um atualiza só o seu lado. Se a migração falhar, a API anterior continua no ar.

## Atualização automática

Atrás do túnel o GitHub não alcança o servidor, então é o servidor que confere o registry. O `auto-deploy.sh` roda
pelo cron a cada 5 minutos, baixa as imagens `latest` e só age quando alguma mudou:

- **API nova:** backup do banco em `backups/` (guarda os 30 mais recentes) e `deploy.sh backend`.
- **Frontend novo:** `deploy.sh web`.
- **Falhou:** registra no log e não tenta de novo aquela mesma versão; o próximo push na `main` tenta outra vez.

O CI publica a imagem de migração antes da API, então uma API nova sempre encontra as migrações do mesmo commit.
O `docker-compose.yml` e os scripts **não** são atualizados sozinhos: quando mudarem, baixar de novo (passo 2 da
primeira subida).

Instalar, na pasta da aplicação:

```bash
curl -fsSLO https://raw.githubusercontent.com/kaegg/tcc-backend/main/deploy/auto-deploy.sh
```

```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * cd $PWD && sh auto-deploy.sh >> auto-deploy.log 2>&1") | crontab -
```

O log só recebe linhas quando algo acontece:

```bash
tail -f auto-deploy.log
```

**Pausar** (por exemplo, durante as sessões do estudo de usabilidade) e **retomar**:

```bash
touch deploy-pausado
```

```bash
rm deploy-pausado
```

Fixar `BACKEND_TAG` ou `FRONTEND_TAG` no `.env` também congela aquele lado. Para rodar `deploy.sh` à mão sem
disputar com o automático, pausar antes.

## Métricas de uso (estudo)

A coleta é passiva e anônima: cada cadastro de lançamento e cada consulta de relatório, nos dois modos, de contas que
aceitaram os Termos de Uso no cadastro (TCC-030). Só funciona com `USAGE_METRICS_ENABLED=true` no `.env` e a API
reiniciada; com qualquer outro valor, nada é gravado. **Deixe desligada nos seus testes e ligue só durante a aplicação
do estudo.**

Exportar (o separador `;` e o BOM abrem direto no Excel em português):

```bash
docker compose exec -T backend node dist/src/metrics/export-metrics --desde=2026-10-20 > "metricas-$(date +%F).csv"
```

`--desde` descarta o que foi coletado antes do início da aplicação; `--separador=,` troca o separador.

## Documentação da API (Swagger)

`/api/docs` só abre pelo túnel SSH (`http://localhost:8080/api/docs`). Pelo domínio público, o Caddy responde 404 (regra
no `Caddyfile` do frontend). Depois de cada deploy do `web`, confira no servidor:

```bash
docker compose exec web caddy validate --config /etc/caddy/Caddyfile
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/docs/                                 # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Cf-Connecting-Ip: 1.2.3.4" http://localhost:8080/api/docs/  # 404
curl -s -o /dev/null -w "%{http_code}\n" https://intellifinance.com.br/api/docs/                        # 404
```

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
