import { ApiProperty } from '@nestjs/swagger';

export class CollectionStatusDto {
  @ApiProperty({
    description:
      'A coleta está ligada neste servidor (USAGE_METRICS_ENABLED) e a conta aceitou os Termos de Uso.',
  })
  collecting!: boolean;
}
