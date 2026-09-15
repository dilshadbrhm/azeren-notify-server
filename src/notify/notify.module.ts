import { Module } from '@nestjs/common';
import { NotifyService } from './notify.service';
import { NotifyGateway } from './notify.gateway';
import { NotifyController } from './notify.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotifyController],
  providers: [NotifyService, NotifyGateway],
  exports: [NotifyService, NotifyGateway],
})
export class NotifyModule {}
