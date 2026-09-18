import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../auth/auth.service';
import { NotifyService } from './notify.service';
import { CurrentUser } from '../auth/auth.interface';
import {
  SendNotificationDto,
  DeleteNotificationDto,
  MarkDeliveredDto,
  MarkReadDto,
} from './notify.dto';

interface AuthenticatedSocket extends Socket {
  user?: CurrentUser;
  cihazId?: string;
  authPromise?: Promise<CurrentUser>;
}

// @UsePipes silindi: class-level ValidationPipe WebSocket ACK-ini bloklayır.
// Hər handler öz validasiyasını özü edir (aşağıya bax).
@WebSocketGateway({
  namespace: '/notify',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotifyGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotifyGateway.name);

  // userId -> Socket ID map
  private readonly userSockets = new Map<string, AuthenticatedSocket>();

  constructor(
    private readonly authService: AuthService,
    private readonly notifyService: NotifyService,
  ) {}

  private async getAuthenticatedUser(client: AuthenticatedSocket): Promise<CurrentUser | null> {
    if (client.user) return client.user;
    if (client.data?.user) {
      client.user = client.data.user as CurrentUser;
      return client.user;
    }

    if (client.authPromise) {
      try {
        const user = await client.authPromise;
        if (user) {
          client.user = user;
          if (!client.data) client.data = {};
          client.data.user = user;
          return user;
        }
      } catch (err) {
        return null;
      }
    }

    const token =
      (client.handshake.auth?.token as string) ||
      (client.handshake.headers['authorization'] as string)?.replace('Bearer ', '') ||
      (client.handshake.query?.token as string);

    if (token) {
      try {
        const user = await this.authService.validatePmsToken(token);
        client.user = user;
        if (!client.data) client.data = {};
        client.data.user = user;
        return user;
      } catch (err) {
        return null;
      }
    }

    return null;
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      if (!client.data) client.data = {};

      // Token-i handshake auth-dan və ya headers-dən götürürük
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers['authorization'] as string)?.replace('Bearer ', '') ||
        (client.handshake.query?.token as string);

      if (!token) {
        this.logger.warn(`Bağlantı rədd edildi: Token tapılmadı (socket: ${client.id})`);
        client.emit('xeta', { mesaj: 'Token tələb olunur' });
        client.disconnect();
        return;
      }

      // PMS-dən istifadəçini yoxlayırıq və authPromise-ə saxlayırıq (race condition olmasın)
      client.authPromise = this.authService.validatePmsToken(token);
      const user = await client.authPromise;
      client.user = user;
      client.data.user = user;

      this.logger.log(`Socket autentifikasiyadan keçdi: ${user.adSoyad} (${user.id})`);
    } catch (error: any) {
      this.logger.warn(`Auth xətası (socket: ${client.id}): ${error.message}`);
      client.emit('xeta', { mesaj: 'Autentifikasiya uğursuz oldu' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const user = client.user || client.data?.user;
    if (user) {
      const existing = this.userSockets.get(user.id);
      if (existing && existing.id === client.id) {
        this.userSockets.delete(user.id);
        this.logger.log(`İstifadəçi ayrıldı: ${user.adSoyad} (${user.id})`);
        this.broadcastPresence();
      }
    }
  }

  // qoşul (client→server): { cihazId }
  @SubscribeMessage('qosul')
  async handleQosul(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { cihazId: string },
  ) {
    const user = await this.getAuthenticatedUser(client);
    if (!user) {
      this.logger.warn(`[handleQosul] İstifadəçi tanınmadı (socket: ${client.id})`);
      client.emit('xeta', { mesaj: 'İstifadəçi tanınmadı' });
      client.disconnect();
      return;
    }

    const { cihazId } = data || {};
    if (!cihazId) {
      client.emit('xeta', { mesaj: 'cihazId parametri tələb olunur' });
      return;
    }

    const userId = user.id;
    const existingSocket = this.userSockets.get(userId);
    console.log('[NotifyGateway] Yeni qoşulma, əvvəlki socket varmı:', !!existingSocket, 'əvvəlki id:', existingSocket?.id, 'yeni id:', client.id, 'cihazId:', cihazId);

    // Tək cihaz məhdudiyyəti yoxlanışı (MÜVƏQQƏTİ DEAKTİV EDİLDİ - server öz-özünü disconnect etməsin):
    // const existingSocket = this.userSockets.get(userId);
    // if (existingSocket && existingSocket.id !== client.id) {
    //   this.logger.log(
    //     `Yeni cihaz daxil oldu, köhnə sessiya bağlanır: istifadəçi=${user.adSoyad}, köhnə socket=${existingSocket.id}`,
    //   );
    //   existingSocket.emit('sessiyaBaglandi', {
    //     mesaj: 'Hesabınıza başqa cihazdan daxil olundu. Bu sessiya sonlandırıldı.',
    //   });
    //   existingSocket.disconnect(true);
    // }

    // İstifadəçinin sonGirisTarixi və cihazId məlumatlarını yeniləyirik
    const updatedUser = await this.notifyService.registerConnection(userId, cihazId);
    user.cihazId = cihazId;
    client.cihazId = cihazId;
    this.userSockets.set(userId, client);

    client.emit('qosuldu', {
      mesaj: 'Uğurla qoşuldu',
      istifadeci: {
        id: updatedUser.id,
        adSoyad: updatedUser.adSoyad,
        rol: updatedUser.rol,
        sobeler: updatedUser.sobeler,
      },
    });

    // Offline vaxtı çatmamış bildirişləri ardıcıl və 500ms fasilə ilə göndəririk
    const undelivered = await this.notifyService.getUndeliveredNotificationsForUser(userId);
    if (undelivered.length > 0) {
      this.logger.log(
        `[OfflineDelivery] ${undelivered.length} çatdırılmamış bildiriş göndərilir: ${user.adSoyad} (${userId})`,
      );

      (async () => {
        for (let i = 0; i < undelivered.length; i++) {
          if (!client.connected) {
            this.logger.warn(
              `[OfflineDelivery] Socket kəsildi, qalan bildirişlərin göndərilməsi dayandırıldı (${user.adSoyad})`,
            );
            break;
          }

          const b = undelivered[i];
          const senderName = b.gonderenAd || 'Sistem';
          const formattedB = {
            ...b,
            gonderenAd: senderName,
            gonderenId: b.gonderenId,
            gonderen: {
              id: b.gonderenId,
              adSoyad: senderName,
              name: senderName,
            },
          };

          client.emit('yeniBildiris', formattedB);
          await this.notifyService.markAsDelivered(b.id, userId);
          this.logger.log(
            `[OfflineDelivery] Bildiriş #${b.id} çatdırıldı (${i + 1}/${undelivered.length}) -> ${user.adSoyad}`,
          );

          // Eyni anda bir neçə bildiriş varsa, ardıcıl olaraq aralarında 500ms fasilə qoyulur
          if (i < undelivered.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      })().catch((err) => {
        this.logger.error(`[OfflineDelivery] Xəta baş verdi: ${err.message}`);
      });
    }

    // Onlayn siyahısını yenilə
    this.broadcastPresence();
  }

  // ---------------------------------------------------------------
  // TEST EVENT — diaqnostika üçün, heç bir auth/DTO yoxlaması yoxdur
  // ---------------------------------------------------------------
  @SubscribeMessage('test')
  handleTest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    console.log('[NotifyGateway] TEST EVENTİ ÇATDI, socket:', client.id, 'data:', JSON.stringify(data));
    return { ok: true, socketId: client.id, receivedData: data };
  }

  // ---------------------------------------------------------------
  // bildirisGonder (yalnız Admin/SuperAdmin, client→server)
  // ACK mexanizmi: NestJS return dəyərini avtomatik ACK kimi göndərir.
  // ŞƏRTİ: client socket.emit('bildirisGonder', payload, callbackFn) formatında çağırmalıdır.
  // ---------------------------------------------------------------
  @SubscribeMessage('bildirisGonder')
  async handleBildirisGonder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() rawDto: any,
  ) {
    console.log('[NotifyGateway] handleBildirisGonder ÇAĞIRILDI');
    this.logger.log('bildirisGonder alındı: ' + JSON.stringify(rawDto));

    // Manual DTO validasiyası — validation xətası ACK ilə qayıdır, event asılı qalmır
    const dto = plainToInstance(SendNotificationDto, rawDto);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      const details = errors.map(e => Object.values(e.constraints || {}).join(', ')).join('; ');
      this.logger.warn(`[bildirisGonder] DTO validation xətası: ${details}`);
      const resp = { success: false, message: `Məlumat formatı səhvdir: ${details}` };
      client.emit('xeta', { mesaj: resp.message });
      return resp;
    }

    const user = await this.getAuthenticatedUser(client);
    if (!user) {
      const resp = { success: false, message: 'İcazə verilmədi' };
      client.emit('xeta', { mesaj: resp.message });
      return resp;
    }

    if (user.rol !== 'ADMIN' && user.rol !== 'SUPERADMIN') {
      const resp = { success: false, message: 'Yalnız Admin və ya SuperAdmin bildiriş göndərə bilər' };
      client.emit('xeta', { mesaj: resp.message });
      return resp;
    }

    try {
      const { bildiris, recipientUserIds } = await this.notifyService.createNotification(
        user,
        dto,
      );

      const senderName = bildiris.gonderenAd || user.adSoyad || (user as any).name || 'Sistem';
      const bildirisPayload = {
        ...bildiris,
        gonderenAd: senderName,
        gonderenId: bildiris.gonderenId || user.id,
        gonderen: {
          id: user.id,
          adSoyad: senderName,
          name: senderName,
        },
      };

      console.log('[NotifyGateway] Göndərilən bildiriş obyekti:', JSON.stringify(bildirisPayload));

      this.logger.log(
        `Bildiriş göndərildi: #${bildiris.id} (${bildiris.hedefTipi}) by ${senderName}`,
      );

      for (const recipientId of recipientUserIds) {
        const socket = this.userSockets.get(recipientId);
        if (socket && socket.connected) {
          socket.emit('yeniBildiris', bildirisPayload);
          await this.notifyService.markAsDelivered(bildiris.id, recipientId);
        }
      }

      const successResp = {
        success: true,
        ugurlu: true,
        bildiris: bildirisPayload,
        aliciSayi: recipientUserIds.length,
      };

      // Köhnə event (geriyə uyğunluq üçün)
      client.emit('bildirisGonderildi', successResp);
      // NestJS return dəyəri = Socket.IO ACK
      return successResp;
    } catch (error: any) {
      this.logger.error(`Bildiriş göndərmə xətası: ${error.message}`);
      const errResp = { success: false, message: error.message || 'Bildiriş göndərilə bilmədi' };
      client.emit('xeta', { mesaj: errResp.message });
      return errResp;
    }
  }

  // bildirisSil (yalnız göndərən Admin və ya SuperAdmin, client→server): { bildirisId }
  @SubscribeMessage('bildirisSil')
  async handleBildirisSil(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: DeleteNotificationDto,
  ) {
    const user = await this.getAuthenticatedUser(client);
    if (!user) {
      const resp = { success: false, message: 'İcazə verilmədi' };
      client.emit('xeta', { mesaj: resp.message });
      return resp;
    }

    const bildirisId = dto?.bildirisId;
    if (!bildirisId) {
      const resp = { success: false, message: 'bildirisId parametri tələb olunur' };
      client.emit('xeta', { mesaj: resp.message });
      return resp;
    }

    try {
      const { bildiris, recipientUserIds } = await this.notifyService.deleteNotification(
        bildirisId,
        user,
      );

      this.logger.log('Bildiriş silindi: ' + bildirisId + ' by ' + user.adSoyad);

      // Bütün əvvəlki alıcılara bildirisSilindi hadisəsi göndərilir: { bildirisId }
      const payload = { bildirisId: bildiris.id, id: bildiris.id };
      for (const recipientId of recipientUserIds) {
        const socket = this.userSockets.get(recipientId);
        if (socket && socket.connected) {
          socket.emit('bildirisSilindi', payload);
        }
      }

      const successResp = { success: true, ugurlu: true, bildirisId: bildiris.id, id: bildiris.id };
      client.emit('bildirisSilindi', successResp);
      return successResp;
    } catch (error: any) {
      this.logger.warn(`Bildiriş silmə xətası: ${error.message}`);
      const errResp = { success: false, message: error.message || 'Bildiriş silinə bilmədi' };
      client.emit('xeta', { mesaj: errResp.message });
      return errResp;
    }
  }

  // bildirisCatdi (client→server): { bildirisId }
  @SubscribeMessage('bildirisCatdi')
  async handleBildirisCatdi(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: MarkDeliveredDto,
  ) {
    const user = await this.getAuthenticatedUser(client);
    if (!user) return;
    await this.notifyService.markAsDelivered(dto.bildirisId, user.id);
  }

  // bildirisOxundu (client→server): { bildirisId }
  @SubscribeMessage('bildirisOxundu')
  async handleBildirisOxundu(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: MarkReadDto,
  ) {
    const user = await this.getAuthenticatedUser(client);
    if (!user) return;
    await this.notifyService.markAsRead(dto.bildirisId, user.id);
    client.emit('bildirisOxunduTesdiq', { bildirisId: dto.bildirisId });
  }

  // Onlayn istifadəçilərin siyahısı hadisəsi
  @SubscribeMessage('onlineSiyahiTeleb')
  handleOnlineSiyahi(@ConnectedSocket() client: AuthenticatedSocket) {
    client.emit('onlineSiyahi', this.getOnlineUsers());
  }

  // Köməkçi: aktiv onlayn istifadəçi ID-ləri
  isUserOnline(userId: string): boolean {
    const socket = this.userSockets.get(userId);
    return !!socket && socket.connected;
  }

  getOnlineUsers() {
    const onlineList: Array<{ id: string; adSoyad: string; rol: string }> = [];
    for (const [userId, socket] of this.userSockets.entries()) {
      if (socket.connected && socket.user) {
        onlineList.push({
          id: userId,
          adSoyad: socket.user.adSoyad,
          rol: socket.user.rol,
        });
      }
    }
    return onlineList;
  }

  private broadcastPresence() {
    const list = this.getOnlineUsers();
    this.server.emit('presenceYenilendi', list);
    this.server.emit('onlineSiyahi', list);
  }
}
