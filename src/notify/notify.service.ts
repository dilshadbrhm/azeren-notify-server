import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendNotificationDto } from './notify.dto';
import { CurrentUser } from '../auth/auth.interface';

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Bağlantı qeydiyyatı və tək cihaz yoxlanışı
  async registerConnection(userId: string, cihazId: string) {
    const user = await this.prisma.taninanIstifadeci.update({
      where: { id: userId },
      data: {
        cihazId,
        sonGirisTarixi: new Date(),
      },
      include: {
        sobeler: true,
      },
    });

    return user;
  }

  // Bildiriş yaratma və alıcıları müəyyən etmə
  async createNotification(sender: CurrentUser, dto: SendNotificationDto) {
    let recipientUserIds: string[] = [];

    if (dto.hedefTipi === 'USER') {
      if (!dto.hedefId) {
        throw new Error('İstifadəçi hədəfi üçün hedefId mütləqdir');
      }
      const recipient = await this.prisma.taninanIstifadeci.findUnique({
        where: { id: dto.hedefId },
      });
      if (!recipient) {
        throw new NotFoundException('Hədəf istifadəçi tapılmadı');
      }
      recipientUserIds = [recipient.id];
    } else if (dto.hedefTipi === 'SOBE') {
      if (!dto.hedefId) {
        throw new Error('Şöbə hədəfi üçün hedefId mütləqdir');
      }
      const sobe = await this.prisma.sobe.findUnique({
        where: { id: dto.hedefId },
        include: { uzvler: true },
      });
      if (!sobe) {
        throw new NotFoundException('Hədəf şöbə tapılmadı');
      }
      recipientUserIds = sobe.uzvler.map((u) => u.id);
    } else if (dto.hedefTipi === 'HAMISI') {
      const allUsers = await this.prisma.taninanIstifadeci.findMany({
        select: { id: true },
      });
      recipientUserIds = allUsers.map((u) => u.id);
    }

    const senderName = sender.adSoyad || (sender as any).name || `İstifadəçi #${sender.id}`;

    // Bildirişi və hər alıcı üçün BildirisOxunma qeydlərini yaradırıq
    const bildiris = await this.prisma.bildiris.create({
      data: {
        gonderenId: sender.id,
        gonderenAd: senderName,
        mesaj: dto.mesaj,
        seviyye: dto.seviyye || 'ADI',
        hedefTipi: dto.hedefTipi,
        hedefId: dto.hedefId || null,
        oxunmalar: {
          create: recipientUserIds.map((uId) => ({
            istifadeciId: uId,
          })),
        },
      },
      include: {
        oxunmalar: true,
      },
    });

    return {
      bildiris,
      recipientUserIds,
    };
  }

  // Bildirişin silinməsi (yalnız göndərən admin və ya SuperAdmin)
  async deleteNotification(bildirisId: string, currentUser: CurrentUser) {
    const bildiris = await this.prisma.bildiris.findUnique({
      where: { id: bildirisId },
      include: {
        oxunmalar: true,
      },
    });

    if (!bildiris) {
      throw new NotFoundException('Bildiriş tapılmadı');
    }

    if (currentUser.rol !== 'ADMIN' && currentUser.rol !== 'SUPERADMIN') {
      throw new ForbiddenException('Yalnız Admin və ya SuperAdmin bildiriş silə bilər');
    }

    if (bildiris.gonderenId !== currentUser.id) {
      throw new ForbiddenException('Yalnız bildirişin öz göndərəni bu bildirişi silə bilər');
    }

    const updated = await this.prisma.bildiris.update({
      where: { id: bildirisId },
      data: { silinib: true },
    });

    const recipientUserIds = bildiris.oxunmalar.map((o) => o.istifadeciId);

    return {
      bildiris: updated,
      recipientUserIds,
    };
  }

  // Çatdırıldı statusu (online olanda dərhal və ya sonradan)
  async markAsDelivered(bildirisId: string, userId: string) {
    const record = await this.prisma.bildirisOxunma.findUnique({
      where: {
        bildirisId_istifadeciId: {
          bildirisId,
          istifadeciId: userId,
        },
      },
    });

    if (record && !record.catdiTarixi) {
      return this.prisma.bildirisOxunma.update({
        where: { id: record.id },
        data: { catdiTarixi: new Date() },
      });
    }

    return record;
  }

  // Çatmamış (pending) bildirişləri götürmək (köhnədən yeniyə ardıcıllıqla)
  async getUndeliveredNotificationsForUser(userId: string) {
    const undelivered = await this.prisma.bildirisOxunma.findMany({
      where: {
        istifadeciId: userId,
        catdiTarixi: null,
        bildiris: {
          silinib: false,
        },
      },
      include: {
        bildiris: true,
      },
      orderBy: {
        gonderildiTarixi: 'asc',
      },
    });

    return undelivered.map((u) => u.bildiris);
  }

  // Oxundu statusu
  async markAsRead(bildirisId: string, userId: string) {
    const record = await this.prisma.bildirisOxunma.findUnique({
      where: {
        bildirisId_istifadeciId: {
          bildirisId,
          istifadeciId: userId,
        },
      },
    });

    if (record) {
      return this.prisma.bildirisOxunma.update({
        where: { id: record.id },
        data: {
          oxunduTarixi: new Date(),
          catdiTarixi: record.catdiTarixi ? undefined : new Date(),
        },
      });
    }

    return null;
  }

  // REST: Cari istifadəçinin bildiriş tarixçəsi
  async getUserHistory(userId: string) {
    return this.prisma.bildirisOxunma.findMany({
      where: {
        istifadeciId: userId,
        bildiris: {
          silinib: false,
        },
      },
      include: {
        bildiris: true,
      },
      orderBy: {
        gonderildiTarixi: 'desc',
      },
    });
  }

  // REST: Adminin göndərdiyi bildirişlər
  async getAdminSentNotifications(adminId: string, isSuperAdmin: boolean) {
    const [bildirisler, sobeler] = await Promise.all([
      this.prisma.bildiris.findMany({
        where: isSuperAdmin ? {} : { gonderenId: adminId },
        include: {
          oxunmalar: {
            include: {
              istifadeci: {
                select: { id: true, adSoyad: true },
              },
            },
          },
        },
        orderBy: {
          yaradildi: 'desc',
        },
      }),
      this.prisma.sobe.findMany({
        select: { id: true, ad: true },
      }),
    ]);

    const sobeMap = new Map<string, string>(sobeler.map((s) => [s.id, s.ad]));

    return bildirisler.map((b) => {
      const cemiAlici = b.oxunmalar.length;
      const oxuyanSay = b.oxunmalar.filter((o) => o.oxunduTarixi != null).length;
      let hedefAd = 'Bütün İstifadəçilər';
      if (b.hedefTipi === 'SOBE' && b.hedefId) {
        hedefAd = sobeMap.get(b.hedefId) || ('Şöbə #' + b.hedefId);
      } else if (b.hedefTipi === 'USER' && b.hedefId) {
        hedefAd = 'İstifadəçi #' + b.hedefId;
      }

      return {
        ...b,
        cemiAlici,
        oxuyanSay,
        hedefAd,
      };
    });
  }

  async getAllUsers() {
    return this.prisma.taninanIstifadeci.findMany({
      include: {
        sobeler: true,
      },
      orderBy: {
        yaradildi: 'desc',
      },
    });
  }

  // REST: Şöbə yarat
  async createSobe(ad: string) {
    const trimmedAd = (ad || '').trim();
    const existing = await this.prisma.sobe.findUnique({
      where: { ad: trimmedAd },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.sobe.create({
      data: { ad: trimmedAd },
    });
  }

  // REST: Bütün şöbələri gətir (üzv sayı ilə)
  async getAllSobeler() {
    const sobeler = await this.prisma.sobe.findMany({
      include: {
        _count: {
          select: { uzvler: true },
        },
        uzvler: {
          select: { id: true, adSoyad: true, rol: true },
        },
      },
      orderBy: {
        ad: 'asc',
      },
    });

    return sobeler.map((s) => ({
      id: s.id,
      ad: s.ad,
      uzvSayi: s._count?.uzvler ?? s.uzvler?.length ?? 0,
      memberCount: s._count?.uzvler ?? s.uzvler?.length ?? 0,
      uzvler: s.uzvler,
      yaradildi: s.yaradildi,
    }));
  }

  // REST: İstifadəçini şöbələrə təyin et
  async assignUserSobeler(userId: string, sobeIds: string[]) {
    const user = await this.prisma.taninanIstifadeci.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    const validIds = Array.isArray(sobeIds) ? sobeIds : [];

    const updatedUser = await this.prisma.taninanIstifadeci.update({
      where: { id: userId },
      data: {
        sobeler: {
          set: validIds.map((id) => ({ id })),
        },
      },
      include: {
        sobeler: {
          select: { id: true, ad: true },
        },
      },
    });

    return {
      id: updatedUser.id,
      adSoyad: updatedUser.adSoyad,
      rol: updatedUser.rol,
      sobeler: updatedUser.sobeler.map((s) => ({ id: s.id, ad: s.ad })),
    };
  }
}
