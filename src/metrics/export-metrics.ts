import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { toCsv } from './metrics-csv';

/**
 * Exporta `usage_metrics` em CSV na saída padrão (TCC-030).
 *
 * Roda no servidor, ao lado do banco, para os dados do estudo não precisarem
 * de rota HTTP de exportação:
 *
 *   docker compose exec -T backend node dist/src/metrics/export-metrics > metricas.csv
 *
 * Localmente: `npm run build` e `node --env-file=.env dist/src/metrics/export-metrics`.
 * Opções: `--desde=AAAA-MM-DD` exporta só o que foi coletado a partir da data
 * (descarta o que veio antes da aplicação); `--separador=,` troca o `;`.
 */
async function main() {
  const option = (name: string) =>
    process.argv
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.slice(name.length + 3);

  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL não definida.\n');
    process.exit(1);
  }
  const separator = option('separador') === ',' ? ',' : ';';
  const since = option('desde');
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    process.stderr.write('Use --desde=AAAA-MM-DD.\n');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const rows = await prisma.usageMetric.findMany({
      where: since
        ? { startedAt: { gte: new Date(`${since}T00:00:00-03:00`) } }
        : {},
      orderBy: [{ participantCode: 'asc' }, { startedAt: 'asc' }],
    });
    process.stdout.write(toCsv(rows, separator));
    process.stderr.write(`${rows.length} linha(s) exportada(s).\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
