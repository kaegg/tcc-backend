#!/bin/sh
# Atualiza um lado da aplicação em produção sem tocar no outro. Chamado pelo CI de cada repositório.
set -eu
cd "$(dirname "$0")"

case "${1:-}" in
  backend)
    docker compose pull migrate backend
    docker compose up -d --wait postgres
    # Migração antes da API nova: se falhar, a API anterior continua no ar.
    docker compose run --rm migrate
    docker compose up -d --no-deps --wait backend
    ;;
  web)
    docker compose pull web
    docker compose up -d --no-deps --wait web
    ;;
  ollama)
    docker compose pull ollama
    docker compose up -d --no-deps --wait ollama
    # Só baixa o que mudou; com o modelo já no volume, termina em segundos.
    docker compose exec -T ollama sh -c 'ollama pull "$OLLAMA_MODEL"'
    ;;
  *)
    echo "uso: $0 backend|web|ollama" >&2
    exit 2
    ;;
esac

docker image prune -f
