import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { NotifyService } from './notify.service';
import { NotifyGateway } from './notify.gateway';
import { RestAuthGuard } from '../auth/rest-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { User } from '../auth/user.decorator';
import type { CurrentUser } from '../auth/auth.interface';
import { CreateSobeDto, AssignUserSobeDto } from './notify.dto';

@Controller('notify')
@UseGuards(RestAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class NotifyController {
  constructor(
    private readonly notifyService: NotifyService,
    private readonly notifyGateway: NotifyGateway,
  ) {}

  // GET /notify/men - cari istifadecinin notify sistemindeki rolu ve melumatlari
  @Get('men')
  async getMen(@User() user: CurrentUser) {
    return {
      ugurlu: true,
      data: {
        id: user.id,
        adSoyad: user.adSoyad,
        rol: user.rol,
      },
    };
  }

  // GET /notify/tarixce — cari istifadəçinin bütün aldığı bildirişlərin tarixçəsi
  @Get('tarixce')
  async getTarixce(@User() user: CurrentUser) {
    const records = await this.notifyService.getUserHistory(user.id);
    return {
      ugurlu: true,
      data: records.map((r) => ({
        id: r.bildiris.id,
        mesaj: r.bildiris.mesaj,
        seviyye: r.bildiris.seviyye,
        gonderenAd: r.bildiris.gonderenAd,
        gonderenId: r.bildiris.gonderenId,
        gonderen: {
          id: r.bildiris.gonderenId,
          adSoyad: r.bildiris.gonderenAd,
          name: r.bildiris.gonderenAd,
        },
        hedefTipi: r.bildiris.hedefTipi,
        hedefId: r.bildiris.hedefId,
        gonderildiTarixi: r.gonderildiTarixi,
        catdiTarixi: r.catdiTarixi,
        oxunduTarixi: r.oxunduTarixi,
      })),
    };
  }

  // GET /notify/gonderilenler — (yalnız Admin/SuperAdmin) öz göndərdiyi bildirişlərin siyahısı
  @Get('gonderilenler')
  @Roles('ADMIN', 'SUPERADMIN')
  async getGonderilenler(@User() user: CurrentUser) {
    const isSuperAdmin = user.rol === 'SUPERADMIN';
    const bildirisler = await this.notifyService.getAdminSentNotifications(user.id, isSuperAdmin);
    return {
      ugurlu: true,
      data: bildirisler,
    };
  }

  // GET /notify/istifadeciler — (yalnız Admin/SuperAdmin) bütün tanınan istifadəçilər, onlayn statusu, şöbələri ilə
  @Get('istifadeciler')
  @Roles('ADMIN', 'SUPERADMIN')
  async getIstifadeciler() {
    const users = await this.notifyService.getAllUsers();
    const result = users.map((u) => {
      const onlayn = this.notifyGateway.isUserOnline(u.id);
      return {
        id: u.id,
        adSoyad: u.adSoyad,
        rol: u.rol,
        onlayn,
        isOnline: onlayn,
        sonGirisTarixi: u.sonGirisTarixi,
        sobeler: (u.sobeler || []).map((s) => ({ id: s.id, ad: s.ad })),
      };
    });

    return {
      ugurlu: true,
      data: result,
    };
  }

  // GET /notify/sobeler — bütün mövcud şöbələr
  @Get('sobeler')
  @Roles('ADMIN', 'SUPERADMIN')
  async getSobeler() {
    const sobeler = await this.notifyService.getAllSobeler();
    return {
      ugurlu: true,
      data: sobeler,
    };
  }

  // POST /notify/sobe — (yalnız Admin/SuperAdmin) yeni şöbə yarat
  @Post('sobe')
  @Roles('ADMIN', 'SUPERADMIN')
  async createSobe(@Body() dto: CreateSobeDto) {
    const sobe = await this.notifyService.createSobe(dto.ad);
    return {
      ugurlu: true,
      data: sobe,
    };
  }

  // PATCH /notify/istifadeci/:id/sobe — istifadəçini şöbə(lər)ə əlavə et
  @Patch('istifadeci/:id/sobe')
  @Roles('ADMIN', 'SUPERADMIN')
  async assignUserSobe(
    @Param('id') userId: string,
    @Body() dto: AssignUserSobeDto,
  ) {
    const updatedUser = await this.notifyService.assignUserSobeler(userId, dto.sobeIds);
    return {
      ugurlu: true,
      data: updatedUser,
    };
  }
}
