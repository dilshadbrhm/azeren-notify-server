import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUser } from './auth.interface';

export const User = createParamDecorator(
  (data: keyof CurrentUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
