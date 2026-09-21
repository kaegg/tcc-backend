import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { CATEGORIA_INVALIDA, CategoriesService } from './categories.service';

const ID = '0199a1b2-c3d4-7000-8000-000000000001';

function criar(count: number) {
  const prisma = { category: { count: jest.fn().mockResolvedValue(count) } };
  const service = new CategoriesService(prisma as unknown as PrismaService);

  return { prisma, service };
}

describe('CategoriesService.assertUsable', () => {
  it('aceita categoria ativa do tipo informado', async () => {
    const { prisma, service } = criar(1);

    await expect(service.assertUsable(ID, 'despesa')).resolves.toBeUndefined();

    expect(prisma.category.count).toHaveBeenCalledWith({
      where: { id: ID, type: 'despesa', isActive: true },
    });
  });

  it('recusa quando nao ha categoria ativa daquele tipo', async () => {
    const { service } = criar(0);

    await expect(service.assertUsable(ID, 'receita')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('inexistente, inativa e de outro tipo respondem igual', async () => {
    const { service } = criar(0);

    const erro: unknown = await service
      .assertUsable(ID, 'receita')
      .catch((e: unknown) => e);

    expect((erro as BadRequestException).getResponse()).toMatchObject({
      message: [CATEGORIA_INVALIDA],
      fieldErrors: { categoryId: [CATEGORIA_INVALIDA] },
    });
  });

  it('recusa id que nao e UUID sem consultar o banco', async () => {
    const { prisma, service } = criar(1);

    await expect(
      service.assertUsable("1' OR '1'='1", 'despesa'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.category.count).not.toHaveBeenCalled();
  });
});
