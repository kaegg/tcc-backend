import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Disponibilidade da API e das suas dependencias.
   *
   * Responde 200 quando tudo opera e 503 quando alguma dependencia caiu. O
   * frontend precisa distinguir tres situacoes — API saudavel, API viva com o
   * banco fora, e API sem resposta — e so o par status HTTP + corpo separa as
   * duas primeiras.
   *
   * E o unico endpoint que, fora da faixa 2xx, nao usa o envelope de erro
   * padrao da API: lancar `ServiceUnavailableException` converteria o corpo em
   * `ApiErrorBody` e perderia a informacao de QUAL dependencia falhou.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    type: HealthResponseDto,
    description: 'A API e todas as dependencias estao operando.',
  })
  @ApiServiceUnavailableResponse({
    type: HealthResponseDto,
    description:
      'A API respondeu, mas alguma dependencia esta indisponivel. O corpo ' +
      'segue o mesmo formato, com `status: "degradado"`.',
  })
  async check(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const result = await this.health.check();

    // `@HttpCode()` e estatico; o status aqui depende do resultado da sonda.
    response.status(
      result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return result;
  }
}
