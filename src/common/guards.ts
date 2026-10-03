import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC, ROLES_KEY } from './decorators';

/** Authentifie chaque requête (jeton Bearer), sauf les routes marquées @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Connexion requise.');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      // Le rôle et la compagnie sont relus en base : un compte désactivé ou modifié est pris en compte tout de suite.
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) throw new UnauthorizedException('Compte introuvable ou désactivé.');
      req.user = { id: user.id, email: user.email, role: user.role, companyId: user.companyId, gareId: user.gareId };
      return true;
    } catch (e) {
      if (isPublic) return true;
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Session expirée ou invalide.');
    }
  }
}

/** Vérifie le rôle exigé par @Roles(...). Sans @Roles, tout utilisateur connecté passe. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException("Vous n'avez pas le droit d'effectuer cette action.");
    return true;
  }
}
