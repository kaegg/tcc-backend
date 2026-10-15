-- TCC-030: coleta passiva de metricas, informada nos Termos de Uso.

-- Quando a conta aceitou os Termos de Uso; nulo nas contas anteriores a eles.
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(3);

-- Na coleta passiva a mesma tarefa se repete na mesma sessao: cada cadastro
-- de lancamento e uma linha.
DROP INDEX "usage_metrics_participant_code_session_code_mode_task_code_key";

CREATE INDEX "usage_metrics_session_code_idx" ON "usage_metrics"("session_code");
