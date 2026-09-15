import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { NotifyModule } from './notify/notify.module';

@Module({
  imports: [PrismaModule, AuthModule, NotifyModule],
})
export class AppModule {}
