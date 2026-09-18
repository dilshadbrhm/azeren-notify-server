import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { CurrentUser } from './auth.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<('SUPERADMIN' | 'ADMIN' | 'USER')[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: CurrentUser = request.user;

    if (!user || !user.rol) {
      throw new ForbiddenException('İstifadəçi rolu tapılmadı');
    }

    const userRole = String(user.rol || '').trim().toUpperCase();

    // SUPERADMIN bütün icazələrə malikdir. ADMIN isə ADMIN və USER icazələrinə malikdir.
    const hasRole = requiredRoles.some((role) => {
      const targetRole = String(role).trim().toUpperCase();
      if (userRole === 'SUPERADMIN') return true;
      if (userRole === 'ADMIN' && (targetRole === 'ADMIN' || targetRole === 'USER')) return true;
      return userRole === targetRole;
    });

    if (!hasRole) {
      throw new ForbiddenException('Bu əməliyyat üçün kifayət qədər hüququnuz yoxdur');
    }

    return true;
  }
}
