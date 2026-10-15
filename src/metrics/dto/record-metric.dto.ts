import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import { InteractionMode, TaskOutcome } from '../../generated/prisma/enums';
import { METRIC_TASKS, type MetricTask } from '../metric-tasks';

const MAX_COUNT = 10_000;
/** Duas horas: acima disso a tarefa ficou aberta esquecida, e não é medida útil. */
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Uma tarefa medida no navegador. Os códigos são UUIDs aleatórios gerados lá:
 * só aceitar esse formato impede que um nome ou e-mail chegue à tabela.
 */
export class RecordMetricDto {
  @ApiProperty({ description: 'Identificador anônimo do participante.' })
  @IsUUID('4', { message: 'Identificador anônimo inválido.' })
  participantCode!: string;

  @ApiProperty({ description: 'Identificador anônimo da sessão.' })
  @IsUUID('4', { message: 'Identificador anônimo inválido.' })
  sessionCode!: string;

  @ApiProperty({ enum: InteractionMode, enumName: 'InteractionMode' })
  @IsEnum(InteractionMode)
  mode!: InteractionMode;

  @ApiProperty({ enum: METRIC_TASKS })
  @IsIn(METRIC_TASKS)
  task!: MetricTask;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_DURATION_MS)
  durationMs!: number;

  @ApiProperty({
    description: 'Cliques no modo formulário, mensagens no modo assistente.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  interactionCount!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_COUNT)
  errorCount!: number;

  @ApiProperty({ enum: TaskOutcome, enumName: 'TaskOutcome' })
  @IsEnum(TaskOutcome)
  outcome!: TaskOutcome;
}
