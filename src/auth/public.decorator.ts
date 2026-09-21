import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Libera a rota da autenticação. O guard é global e nega por padrão: rota nova
 * nasce protegida, e expor uma rota é uma decisão visível no código.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
