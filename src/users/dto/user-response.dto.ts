import { ApiProperty } from '@nestjs/swagger';

/**
 * Usuario como o cliente o ve.
 *
 * Nao existe caminho por onde `passwordHash` saia: o `select` da consulta nem o
 * traz do banco, e o mapeamento monta o objeto campo a campo.
 */
export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ description: 'ISO-8601 em UTC.' })
  createdAt!: string;
}
