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

describe('CategoriesService.findAll', () => {
  it('poe "Outros" no fim de cada tipo, mantendo a ordem do banco', async () => {
    const rows = [
      { id: '1', name: 'Freelance', type: 'receita' },
      { id: '2', name: 'Outros', type: 'receita' },
      { id: '3', name: 'Salário', type: 'receita' },
      { id: '4', name: 'Alimentação', type: 'despesa' },
      { id: '5', name: 'Outros', type: 'despesa' },
      { id: '6', name: 'Transporte', type: 'despesa' },
    ];
    const prisma = {
      category: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new CategoriesService(prisma as unknown as PrismaService);

    const nomes = (await service.findAll()).map((c) => `${c.type}:${c.name}`);

    expect(nomes).toEqual([
      'receita:Freelance',
      'receita:Salário',
      'receita:Outros',
      'despesa:Alimentação',
      'despesa:Transporte',
      'despesa:Outros',
    ]);
  });
});
