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
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
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
}

@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@WebSocketGateway({
  namespace: '/notify',
  cors: {
    origin: '*',
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

  async handleConnection(client: AuthenticatedSocket) {
    try {
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

      // PMS-dən istifadəçini yoxlayırıq
      const user = await this.authService.validatePmsToken(token);
      client.user = user;

      this.logger.log(`Socket autentifikasiyadan keçdi: ${user.adSoyad} (${user.id})`);
    } catch (error: any) {
      this.logger.warn(`Auth xətası (socket: ${client.id}): ${error.message}`);
      client.emit('xeta', { mesaj: 'Autentifikasiya uğursuz oldu' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.user) {
      const existing = this.userSockets.get(client.user.id);
      if (existing && existing.id === client.id) {
        this.userSockets.delete(client.user.id);
        this.logger.log(`İstifadəçi ayrıldı: ${client.user.adSoyad} (${client.user.id})`);
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
    if (!client.user) {
      client.emit('xeta', { mesaj: 'İstifadəçi tanınmadı' });
      client.disconnect();
      return;
    }

    const { cihazId } = data || {};
    if (!cihazId) {
      client.emit('xeta', { mesaj: 'cihazId parametri tələb olunur' });
      return;
    }

    const userId = client.user.id;

    // Tək cihaz məhdudiyyəti yoxlanışı:
    // Əgər artıq onlayn socket varsa və ya başqa sessiya varsa
    const existingSocket = this.userSockets.get(userId);
    if (existingSocket && existingSocket.id !== client.id) {
      this.logger.log(
        `Yeni cihaz daxil oldu, köhnə sessiya bağlanır: istifadəçi=${client.user.adSoyad}, köhnə socket=${existingSocket.id}`,
      );
      existingSocket.emit('sessiyaBaglandi', {
        mesaj: 'Hesabınıza başqa cihazdan daxil olundu. Bu sessiya sonlandırıldı.',
      });
      existingSocket.disconnect(true);
    }

    // İstifadəçinin sonGirisTarixi və cihazId məlumatlarını yeniləyirik
    const updatedUser = await this.notifyService.registerConnection(userId, cihazId);
    client.user.cihazId = cihazId;
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

    // Offline vaxtı çatmamış bildirişləri dərhal göndəririk
    const undelivered = await this.notifyService.getUndeliveredNotificationsForUser(userId);
    for (const b of undelivered) {
      client.emit('yeniBildiris', b);
      await this.notifyService.markAsDelivered(b.id, userId);
    }

    // Onlayn siyahısını yenilə
    this.broadcastPresence();
  }

  // bildirisGonder (yalnız Admin/SuperAdmin, client→server): { hedefTipi, hedefId?, mesaj, seviyye }
  @SubscribeMessage('bildirisGonder')
  async handleBildirisGonder(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: SendNotificationDto,
  ) {
    if (!client.user) {
      client.emit('xeta', { mesaj: 'İcazə verilmədi' });
      return;
    }

    if (client.user.rol !== 'ADMIN' && client.user.rol !== 'SUPERADMIN') {
      client.emit('xeta', { mesaj: 'Yalnız Admin və ya SuperAdmin bildiriş göndərə bilər' });
      return;
    }

    try {
      const { bildiris, recipientUserIds } = await this.notifyService.createNotification(
        client.user,
        dto,
      );

      this.logger.log(
        `Bildiriş göndərildi: #${bildiris.id} (${bildiris.hedefTipi}) by ${client.user.adSoyad}`,
      );

      // Onlayn olan alıcılara dərhal göndəririk və catdiTarixi qeyd edirik
      for (const recipientId of recipientUserIds) {
        const socket = this.userSockets.get(recipientId);
        if (socket && socket.connected) {
          socket.emit('yeniBildiris', bildiris);
          await this.notifyService.markAsDelivered(bildiris.id, recipientId);
        }
      }

      client.emit('bildirisGonderildi', {
        ugurlu: true,
        bildiris,
        aliciSayi: recipientUserIds.length,
      });
    } catch (error: any) {
      this.logger.error(`Bildiriş göndərmə xətası: ${error.message}`);
      client.emit('xeta', { mesaj: error.message || 'Bildiriş göndərilə bilmədi' });
    }
  }

  // bildirisSil (yalnız göndərən Admin və ya SuperAdmin, client→server): { bildirisId }
  @SubscribeMessage('bildirisSil')
  async handleBildirisSil(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: DeleteNotificationDto,
  ) {
    if (!client.user) {
      client.emit('xeta', { mesaj: 'İcazə verilmədi' });
      return;
    }

    try {
      const { bildiris, recipientUserIds } = await this.notifyService.deleteNotification(
        dto.bildirisId,
        client.user,
      );

      // Alıcılara bildirisSilindi göndər
      for (const recipientId of recipientUserIds) {
        const socket = this.userSockets.get(recipientId);
        if (socket && socket.connected) {
          socket.emit('bildirisSilindi', { bildirisId: bildiris.id });
        }
      }

      client.emit('bildirisSilindi', { bildirisId: bildiris.id, ugurlu: true });
    } catch (error: any) {
      client.emit('xeta', { mesaj: error.message || 'Bildiriş silinə bilmədi' });
    }
  }

  // bildirisCatdi (client→server): { bildirisId }
  @SubscribeMessage('bildirisCatdi')
  async handleBildirisCatdi(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: MarkDeliveredDto,
  ) {
    if (!client.user) return;
    await this.notifyService.markAsDelivered(dto.bildirisId, client.user.id);
  }

  // bildirisOxundu (client→server): { bildirisId }
  @SubscribeMessage('bildirisOxundu')
  async handleBildirisOxundu(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: MarkReadDto,
  ) {
    if (!client.user) return;
    await this.notifyService.markAsRead(dto.bildirisId, client.user.id);
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
