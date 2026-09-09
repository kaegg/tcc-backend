import { ApiProperty } from '@nestjs/swagger';

/** Estado agregado da aplicacao. */
export type HealthStatus = 'ok' | 'degradado';

/** Estado de uma dependencia externa. */
export type DependencyStatus = 'ok' | 'indisponivel';

export class DatabaseHealthDto {
  @ApiProperty({
    enum: ['ok', 'indisponivel'],
    description: 'Resultado da consulta de verificacao no PostgreSQL.',
  })
  status!: DependencyStatus;

  @ApiProperty({
    required: false,
    description:
      'Tempo da consulta de verificacao, em milissegundos. Ausente quando o ' +
      'banco nao respondeu.',
  })
  latencyMs?: number;
}

export class HealthDependenciesDto {
  @ApiProperty({ type: DatabaseHealthDto })
  database!: DatabaseHealthDto;
}

/**
 * Resposta de `GET /api/health`.
 *
 * O corpo e deliberadamente pobre: nao traz versao, host, nome do banco,
 * ambiente nem mensagem do driver. Um health publico que descreve a
 * infraestrutura vira reconhecimento gratuito para quem varre a rede
 * (OWASP A05). O motivo real de uma falha vai apenas para o log do servidor,
 * ja mascarado por `redactSecrets`.
 */
export class HealthResponseDto {
  @ApiProperty({
    enum: ['ok', 'degradado'],
    description:
      'Estado agregado. `degradado` acompanha o status HTTP 503 e indica que ' +
      'a API respondeu, mas alguma dependencia nao esta operando.',
  })
  status!: HealthStatus;

  @ApiProperty({ description: 'Instante da verificacao, em ISO-8601 UTC.' })
  timestamp!: string;

  @ApiProperty({ description: 'Tempo de vida do processo, em segundos.' })
  uptimeSeconds!: number;

  @ApiProperty({ type: HealthDependenciesDto })
  dependencies!: HealthDependenciesDto;
}
