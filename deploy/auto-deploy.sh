#!/bin/sh
# Atualização automática, puxada pelo servidor: o GitHub não alcança a máquina atrás do túnel. Roda pelo cron a
# cada poucos minutos e só faz algo quando o CI publicou imagem nova na `latest`. Instalação: README.md desta pasta.
set -eu
cd "$(dirname "$0")"

PAUSE_FILE=deploy-pausado
BACKUP_DIR=backups
BACKUPS_KEPT=30

log() { echo "$(date '+%F %T') $*"; }

[ -e "$PAUSE_FILE" ] && exit 0

exec 9>.auto-deploy.lock
flock -n 9 || exit 0

# Compara a imagem do container em execução com a que a mesma referência aponta depois do pull. Com tag fixada no
# .env (BACKEND_TAG/FRONTEND_TAG) o pull não muda nada, e o lado fica parado até a tag sair.
changed() {
  cid=$(docker compose ps -q "$1")
  [ -n "$cid" ] || return 1
  running=$(docker inspect -f '{{.Image}}' "$cid")
  target=$(docker image inspect -f '{{.Id}}' "$(docker inspect -f '{{.Config.Image}}' "$cid")")
  # Sem esta marca, um deploy que falhou seria repetido a cada execução, com backup e migração a cada vez.
  [ "$target" != "$running" ] && [ "$target" != "$(cat ".falhou-$1" 2>/dev/null)" ]
}

deploy() {
  if sh deploy.sh "$1"; then
    rm -f ".falhou-$1"
    log "$1 atualizado para $target"
  else
    echo "$target" > ".falhou-$1"
    log "$1 FALHOU em $target; esta versão não será tentada de novo automaticamente"
  fi
}

docker compose pull -q migrate backend web

if changed backend; then
  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/antes-do-deploy-$(date +%F-%H%M%S).sql"
  # Em arquivo antes do gzip: num pipe, o sh não vê a falha do pg_dump e seguiria com um backup vazio.
  if ! docker compose exec -T postgres pg_dump -U intellifinance intellifinance > "$backup"; then
    rm -f "$backup"
    log "backup FALHOU; atualização do backend adiada para a próxima execução"
    exit 1
  fi
  gzip "$backup"
  log "backup em $backup.gz"
  ls -1t "$BACKUP_DIR"/antes-do-deploy-*.sql.gz | tail -n +$((BACKUPS_KEPT + 1)) | xargs -r rm --
  deploy backend
fi

if changed web; then
  deploy web
fi
