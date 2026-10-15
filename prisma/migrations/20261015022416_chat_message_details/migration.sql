-- Conversas do chatbot passam a ser gravadas: a mensagem do assistente guarda o tipo da resposta e,
-- quando foi uma consulta, o período, para a conversa reaberta mostrar o mesmo que mostrou ao vivo.

-- CreateEnum
CREATE TYPE "chat_reply_kind" AS ENUM ('pergunta', 'confirmacao', 'sucesso', 'erro', 'informacao');

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "kind" "chat_reply_kind",
ADD COLUMN     "report_from" DATE,
ADD COLUMN     "report_to" DATE;

-- Restrições que o schema.prisma não expressa.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_details_only_assistant"
    CHECK ("role" = 'assistant' OR ("kind" IS NULL AND "report_from" IS NULL AND "report_to" IS NULL));

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_report_period"
    CHECK (("report_from" IS NULL) = ("report_to" IS NULL) AND ("report_from" IS NULL OR "report_from" <= "report_to"));
