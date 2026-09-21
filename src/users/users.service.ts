import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { hashPassword } from './password';

const EMAIL_JA_CADASTRADO = 'Este e-mail já está cadastrado.';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria a conta.
   *
   * A duplicidade e detectada pela violacao do indice unico, e nao por uma
   * consulta previa. Consultar antes e inserir depois abre uma janela entre as
   * duas operacoes: dois cadastros simultaneos com o mesmo e-mail passariam os
   * dois pela verificacao. Aqui quem decide e o banco, que nao tem essa janela.
   */
  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: { name: dto.name, email: dto.email, passwordHash },
        select: { id: true, name: true, email: true, createdAt: true },
      });

      return { ...user, createdAt: user.createdAt.toISOString() };
    } catch (error) {
      if (isEmailAlreadyTaken(error)) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: EMAIL_JA_CADASTRADO,
          fieldErrors: { email: [EMAIL_JA_CADASTRADO] },
        });
      }

      throw error;
    }
  }

  /** Único caminho que lê `passwordHash`; o resultado nunca sai da camada de autenticação. */
  findCredentialsByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        passwordHash: true,
      },
    });
  }
}

function isEmailAlreadyTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = (error.meta as { target?: unknown } | undefined)?.target;

  return Array.isArray(target)
    ? target.includes('email')
    : typeof target === 'string' && target.includes('email');
}
