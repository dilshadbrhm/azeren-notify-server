import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, PmsUserResponse } from './auth.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly pmsAuthUrl = 'https://pms.azerenerji.az/api/v1/auth/men';

  constructor(private readonly prisma: PrismaService) { }

  async validatePmsToken(token: string): Promise<CurrentUser> {
    if (!token) {
      throw new UnauthorizedException('Authorization token tələb olunur');
    }

    try {
      const response = await axios.get<PmsUserResponse>(this.pmsAuthUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
        // FALLBACK: Əgər --use-system-ca işləmirsə, development mühitdə sertifikat
        // yoxlaması müvəqqəti deaktiv edilir.
        // ⚠️  XƏBƏRDARLIQ: Bu production-da TƏHLÜKƏLİDİR (MITM hücumlarına açıqdır)!
        // Production-da mütləq doğru SSL sertifikatı konfiqurasiya edilməlidir.
        ...(process.env.NODE_ENV !== 'production' && {
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        }),
      });

      const pmsData = response.data;
      if (!pmsData || !pmsData.id) {
        throw new UnauthorizedException('PMS-dən etibarlı istifadəçi məlumatı alınmadı');
      }

      const pmsUserId = String(pmsData.id);
      const adSoyad = pmsData.adSoyad || pmsData.name || `İstifadəçi #${pmsUserId}`;

      // Bazada yoxlayırıq və ya ilkin USER kimi tapırıq
      let user = await this.prisma.taninanIstifadeci.findUnique({
        where: { id: pmsUserId },
      });

      if (!user) {
        user = await this.prisma.taninanIstifadeci.create({
          data: {
            id: pmsUserId,
            adSoyad,
            rol: 'USER',
          },
        });
        this.logger.log(`Yeni istifadəçi qeydiyyata alındı: ${adSoyad} (${pmsUserId})`);
      } else if (user.adSoyad !== adSoyad) {
        user = await this.prisma.taninanIstifadeci.update({
          where: { id: pmsUserId },
          data: { adSoyad },
        });
      }

      return {
        id: user.id,
        adSoyad: user.adSoyad,
        rol: user.rol as 'SUPERADMIN' | 'ADMIN' | 'USER',
        sonGirisTarixi: user.sonGirisTarixi,
        cihazId: user.cihazId,
      };
    } catch (error: any) {
      this.logger.error(`PMS auth xətası: ${error.message}`);
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token etibarsızdır və ya PMS serveri ilə əlaqə qurulmadı');
    }
  }
}
