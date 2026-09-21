import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  providers: [UsersService],
  controllers: [UsersController],
  // A TCC-009 precisa do servico para autenticar.
  exports: [UsersService],
})
export class UsersModule {}
