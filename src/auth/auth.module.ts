import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RestAuthGuard } from './rest-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [AuthService, RestAuthGuard, RolesGuard],
  exports: [AuthService, RestAuthGuard, RolesGuard],
})
export class AuthModule {}
