import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_TITLE_CHARS } from '../conversations.service';

const TITLE_MESSAGE = `Informe um nome de 1 a ${MAX_TITLE_CHARS} caracteres.`;

export class RenameConversationDto {
  @ApiProperty({ example: 'Mercado de outubro', maxLength: MAX_TITLE_CHARS })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value,
  )
  @IsString({ message: TITLE_MESSAGE })
  @IsNotEmpty({ message: TITLE_MESSAGE })
  @MaxLength(MAX_TITLE_CHARS, { message: TITLE_MESSAGE })
  title!: string;
}
