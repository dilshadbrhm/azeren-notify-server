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

    // Bildirişi və hər alıcı üçün BildirisOxunma qeydlərini yaradırıq
    const bildiris = await this.prisma.bildiris.create({
      data: {
        gonderenId: sender.id,
        gonderenAd: sender.adSoyad,
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

    if (currentUser.rol !== 'SUPERADMIN' && bildiris.gonderenId !== currentUser.id) {
      throw new ForbiddenException('Yalnız bildirişi göndərən admin və ya SuperAdmin silə bilər');
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

  // Çatmamış (pending) bildirişləri götürmək
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
    return this.prisma.bildiris.findMany({
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
    });
  }

  // REST: Bütün tanınan istifadəçilər (şöbələri ilə)
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
    return this.prisma.sobe.create({
      data: { ad },
    });
  }

  // REST: Bütün şöbələri gətir
  async getAllSobeler() {
    return this.prisma.sobe.findMany({
      include: {
        uzvler: {
          select: { id: true, adSoyad: true, rol: true },
        },
      },
    });
  }

  // REST: İstifadəçini şöbələrə təyin et
  async assignUserSobeler(userId: string, sobeIds: string[]) {
    const user = await this.prisma.taninanIstifadeci.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('İstifadəçi tapılmadı');
    }

    return this.prisma.taninanIstifadeci.update({
      where: { id: userId },
      data: {
        sobeler: {
          set: sobeIds.map((id) => ({ id })),
        },
      },
      include: {
        sobeler: true,
      },
    });
  }
}
