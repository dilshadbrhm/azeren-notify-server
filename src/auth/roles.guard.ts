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

    // SUPERADMIN bütün ADMIN icazələrinə də malikdir
    const hasRole = requiredRoles.some((role) => {
      if (user.rol === 'SUPERADMIN') return true;
      return user.rol === role;
    });

    if (!hasRole) {
      throw new ForbiddenException('Bu əməliyyat üçün kifayət qədər hüququnuz yoxdur');
    }

    return true;
  }
}
