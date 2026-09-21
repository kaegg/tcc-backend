import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { hashPassword, verifyPassword } from './password';

const EMAIL_JA_CADASTRADO = 'Este e-mail já está cadastrado.';
const SENHA_ATUAL_INCORRETA = 'Senha atual incorreta.';

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
} as const;

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
        select: PUBLIC_FIELDS,
      });

      return toResponse(user);
    } catch (error) {
      if (isEmailAlreadyTaken(error)) throw emailTaken();

      throw error;
    }
  }

  /**
   * Altera nome e/ou e-mail do usuário autenticado.
   *
   * Trocar o e-mail muda o identificador de login, então exige a senha atual:
   * quem só roubou um access token não consegue se apropriar da conta.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    if (dto.name === undefined && dto.email === undefined) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['Informe ao menos um campo para alterar.'],
      });
    }

    const current = await this.findCredentialsById(userId);
    if (!current) throw new UnauthorizedException();

    const emailChanges = dto.email !== undefined && dto.email !== current.email;

    if (emailChanges) {
      if (!dto.currentPassword) {
        throw badRequestOnField(
          'currentPassword',
          'Informe sua senha atual para alterar o e-mail.',
        );
      }
      if (!(await verifyPassword(current.passwordHash, dto.currentPassword))) {
        throw badRequestOnField('currentPassword', SENHA_ATUAL_INCORRETA);
      }
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(emailChanges ? { email: dto.email } : {}),
        },
        select: PUBLIC_FIELDS,
      });

      return toResponse(user);
    } catch (error) {
      if (isEmailAlreadyTaken(error)) throw emailTaken();
      throw error;
    }
  }

  /**
   * Troca a senha e encerra todas as outras sessões do usuário.
   *
   * Quem tinha a senha antiga pode ter também uma sessão aberta; sem revogá-las
   * a troca não expulsaria um invasor que já estivesse dentro. A sessão de quem
   * está trocando permanece.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const current = await this.findCredentialsById(userId);
    if (!current) throw new UnauthorizedException();

    if (!(await verifyPassword(current.passwordHash, dto.currentPassword))) {
      throw badRequestOnField('currentPassword', SENHA_ATUAL_INCORRETA);
    }

    if (await verifyPassword(current.passwordHash, dto.newPassword)) {
      throw badRequestOnField(
        'newPassword',
        'A nova senha deve ser diferente da atual.',
      );
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
        select: { id: true },
      }),
      this.prisma.session.updateMany({
        where: {
          userId,
          id: { not: currentSessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Único caminho que lê `passwordHash` por e-mail; o resultado nunca sai da camada de autenticação. */
  findCredentialsByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { ...PUBLIC_FIELDS, passwordHash: true },
    });
  }

  private findCredentialsById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { ...PUBLIC_FIELDS, passwordHash: true },
    });
  }
}

/** Monta campo a campo: nada além disto pode sair, mesmo que a consulta traga mais. */
function toResponse(user: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

function badRequestOnField(
  field: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: [message],
    fieldErrors: { [field]: [message] },
  });
}

function emailTaken(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: EMAIL_JA_CADASTRADO,
    fieldErrors: { email: [EMAIL_JA_CADASTRADO] },
  });
}

function isEmailAlreadyTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;

  const target = (error.meta as { target?: unknown } | undefined)?.target;

  return Array.isArray(target)
    ? target.includes('email')
    : typeof target === 'string' && target.includes('email');
}
