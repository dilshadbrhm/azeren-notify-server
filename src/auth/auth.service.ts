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

    // Diaqnostika: tokenin ilk 20 simvolunu logla
    const tokenPreview = token.length > 20 ? token.substring(0, 20) + '...' : token;
    this.logger.debug(`[PMS] Token doğrulanır. İlk 20 simvol: "${tokenPreview}"`);
    this.logger.debug(`[PMS] Sorğu URL: ${this.pmsAuthUrl}`);
    this.logger.debug(`[PMS] Authorization header: "Bearer ${tokenPreview}"`);

    try {
      const response = await axios.get<PmsUserResponse>(this.pmsAuthUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
        // FALLBACK: Əgər --use-system-ca işləmirsə, development mühitdə sertifikat
        // yoxlaması müvəqqəti deaktiv edilir.
        // ⚠️  XƏBƏRDARLIQ: Bu production-da TƏHLÜKƏLİDİR (MITM hücumlarına açıqdır!)!
        // Production-da mütləq doğru SSL sertifikatı konfiqurasiya edilməlidir.
        ...(process.env.NODE_ENV !== 'production' && {
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        }),
      });

      this.logger.debug(`[PMS] Cavab HTTP status: ${response.status}`);
      this.logger.debug(`[PMS] Cavab body: ${JSON.stringify(response.data)}`);

      const pmsData = response.data;

      // PMS-in cavabı {istifadeci: {id, name, adSoyad, status}} formatında ola bilər
      // Hər iki variantı dəstəkləyirik: birbaşa {id, ...} və nested {istifadeci: {id, ...}}
      const istifadeciData = (pmsData as any)?.istifadeci ?? pmsData;

      if (!istifadeciData || !istifadeciData.id) {
        this.logger.error(
          `[PMS] Etibarlı istifadəçi məlumatı tapılmadı. Tam cavab: ${JSON.stringify(pmsData)}`,
        );
        throw new UnauthorizedException('PMS-dən etibarlı istifadəçi məlumatı alınmadı');
      }

      const pmsUserId = String(istifadeciData.id);
      const adSoyad =
        istifadeciData.adSoyad ||
        istifadeciData.name ||
        `İstifadəçi #${pmsUserId}`;

      this.logger.log(`[PMS] İstifadəçi doğrulandı: ${adSoyad} (ID: ${pmsUserId})`);

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
      // Timeout xətası
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        this.logger.error(
          `[PMS] TIMEOUT xətası — PMS serveri ${10000}ms ərzində cavab vermədi. URL: ${this.pmsAuthUrl}`,
        );
        throw new UnauthorizedException('PMS serveri vaxt aşımına uğradı, yenidən cəhd edin');
      }

      // HTTP xətası (4xx, 5xx)
      if (error.response) {
        this.logger.error(
          `[PMS] HTTP xətası — Status: ${error.response.status}, ` +
          `Body: ${JSON.stringify(error.response.data)}, ` +
          `Göndərilən header: "Bearer ${tokenPreview}"`,
        );
        if (error.response.status === 401 || error.response.status === 403) {
          throw new UnauthorizedException(
            `PMS tokeni rədd edildi (HTTP ${error.response.status})`,
          );
        }
        throw new UnauthorizedException(
          `PMS serveri xəta qaytardı (HTTP ${error.response.status})`,
        );
      }

      // Şəbəkə / SSL xətası
      if (error.request) {
        this.logger.error(
          `[PMS] Şəbəkə xətası — PMS serverə çatmaq mümkün olmadı. ` +
          `Kod: ${error.code}, Mesaj: ${error.message}`,
        );
        throw new UnauthorizedException('PMS serveri ilə əlaqə qurulmadı (şəbəkə xətası)');
      }

      // Digər xətalar (UnauthorizedException daxil)
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(`[PMS] Gözlənilməz xəta: ${error.message}`);
      throw new UnauthorizedException('Token etibarsızdır və ya PMS serveri ilə əlaqə qurulmadı');
    }
  }
}
