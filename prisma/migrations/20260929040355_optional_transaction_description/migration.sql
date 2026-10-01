-- A descrição passa a ser opcional: o critério de aceite da TCC-012 exige valor, data, tipo e
-- categoria, não descrição. O CHECK "transactions_description_not_blank" continua valendo:
-- CHECK com NULL passa no PostgreSQL, e texto só com espaços segue recusado.

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "description" DROP NOT NULL;
