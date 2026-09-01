CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "transaction_type" AS ENUM ('receita', 'despesa');

CREATE TYPE "transaction_source" AS ENUM ('formulario', 'assistente');

CREATE TYPE "chat_role" AS ENUM ('user', 'assistant');

CREATE TYPE "interaction_mode" AS ENUM ('formulario', 'assistente');

CREATE TYPE "task_outcome" AS ENUM ('sucesso', 'falha', 'abandono');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" "transaction_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "source" "transaction_source" NOT NULL DEFAULT 'formulario',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "chat_role" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_metrics" (
    "id" UUID NOT NULL,
    "participant_code" VARCHAR(40) NOT NULL,
    "session_code" VARCHAR(40) NOT NULL,
    "mode" "interaction_mode" NOT NULL,
    "task_code" VARCHAR(40) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "outcome" "task_outcome",
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE INDEX "categories_type_is_active_idx" ON "categories"("type", "is_active");

CREATE UNIQUE INDEX "categories_name_type_key" ON "categories"("name", "type");

CREATE UNIQUE INDEX "categories_id_type_key" ON "categories"("id", "type");

CREATE INDEX "transactions_user_id_date_idx" ON "transactions"("user_id", "date");

CREATE INDEX "transactions_user_id_category_id_date_idx" ON "transactions"("user_id", "category_id", "date");

CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at");

CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

CREATE INDEX "usage_metrics_participant_code_idx" ON "usage_metrics"("participant_code");

CREATE INDEX "usage_metrics_mode_task_code_idx" ON "usage_metrics"("mode", "task_code");

CREATE UNIQUE INDEX "usage_metrics_participant_code_session_code_mode_task_code_key" ON "usage_metrics"("participant_code", "session_code", "mode", "task_code");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_type_fkey" FOREIGN KEY ("category_id", "type") REFERENCES "categories"("id", "type") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Restricoes de integridade.
--
-- O schema.prisma nao expressa CHECK constraints. O Prisma Migrate tambem nao
-- as gerencia, entao elas sobrevivem as migracoes geradas depois desta.
-- ---------------------------------------------------------------------------

ALTER TABLE "users"
  ADD CONSTRAINT "users_name_not_blank"
      CHECK (char_length(btrim("name")) >= 3),
  -- Faz o indice unico de email valer como comparacao sem diferenciar
  -- maiusculas, sem depender da extensao citext.
  ADD CONSTRAINT "users_email_lowercase"
      CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_has_at"
      CHECK ("email" LIKE '%_@_%');

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_not_blank"
      CHECK (char_length(btrim("name")) > 0);

ALTER TABLE "transactions"
  -- RN03: o valor e sempre positivo; o sinal vem do tipo, nunca do valor.
  ADD CONSTRAINT "transactions_amount_positive"
      CHECK ("amount" > 0),
  ADD CONSTRAINT "transactions_description_not_blank"
      CHECK (char_length(btrim("description")) > 0),
  -- RN04: barra erro de digitacao de ano (2206, 20026). A regra "nao pode ser
  -- no futuro" fica no DTO: CURRENT_DATE nao e immutable e o PostgreSQL recusa
  -- funcao nao-immutable dentro de CHECK.
  ADD CONSTRAINT "transactions_date_in_range"
      CHECK ("date" BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'),
  ADD CONSTRAINT "transactions_deleted_after_created"
      CHECK ("deleted_at" IS NULL OR "deleted_at" >= "created_at");

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_content_not_blank"
      CHECK (char_length(btrim("content")) > 0);

ALTER TABLE "usage_metrics"
  ADD CONSTRAINT "usage_metrics_finished_after_started"
      CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
  ADD CONSTRAINT "usage_metrics_counts_not_negative"
      CHECK ("interaction_count" >= 0 AND "error_count" >= 0),
  ADD CONSTRAINT "usage_metrics_duration_not_negative"
      CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);