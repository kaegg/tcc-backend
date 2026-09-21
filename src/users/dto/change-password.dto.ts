import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password';
import { StrongPassword } from './strong-password.decorator';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString({ message: 'Informe sua senha atual.' })
  @IsNotEmpty({ message: 'Informe sua senha atual.' })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: 'Senha atual incorreta.' })
  currentPassword!: string;

  @StrongPassword()
  newPassword!: string;
}
