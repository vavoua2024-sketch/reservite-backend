import { BadRequestException, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { STAFF_ROLES } from '../common/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, UpdateProfileDto } from './dto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, companyId: u.companyId, gareId: u.gareId };
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private notifications: NotificationsService) {}

  private async issueTokens(user: User) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('hex');
    const days = Number(process.env.REFRESH_TOKEN_DAYS || 30);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + days * 86400 * 1000) },
    });
    return { token: accessToken, accessToken, refreshToken, user: publicUser(user) };
  }

  private async checkCredentials(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) throw new UnauthorizedException('Email ou mot de passe incorrect.');
    if (!user.isActive) throw new UnauthorizedException('Ce compte est désactivé.');
    return user;
  }

  async login(email: string, password: string, audience: 'staff' | 'client') {
    const user = await this.checkCredentials(email, password);
    const isStaff = STAFF_ROLES.includes(user.role);
    if (audience === 'staff' && !isStaff) throw new UnauthorizedException('Email ou mot de passe incorrect.');
    if (audience === 'client' && user.role !== 'CLIENT' && user.role !== 'CONTROLLER') {
      throw new UnauthorizedException('Email ou mot de passe incorrect.');
    }
    return this.issueTokens(user);
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Un compte existe déjà avec cet email.');
    const user = await this.prisma.user.create({
      data: { email, name: dto.name.trim(), phone: dto.phone, role: Role.CLIENT, passwordHash: await bcrypt.hash(dto.password, 10) },
    });
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!record || record.revokedAt || record.expiresAt < new Date() || !record.user.isActive) {
      throw new UnauthorizedException('Session expirée, reconnectez-vous.');
    }
    // Rotation : l'ancien jeton de rafraîchissement ne sert qu'une fois.
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.user);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  /** Répond toujours pareil, pour ne pas révéler quels emails existent. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (user && user.isActive) {
      const token = randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600 * 1000) },
      });
      await this.notifications.sendEmail(user.email, 'Réinitialisation du mot de passe RESERVITE', `Code de réinitialisation (valable 1 h) : ${token}`);
    }
    return { ok: true, message: 'Si un compte existe avec cet email, un message de réinitialisation a été envoyé.' };
  }

  async resetPassword(token: string, password: string) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw new BadRequestException('Code invalide ou expiré.');
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: { name?: string; phone?: string; passwordHash?: string } = {};
    if (dto.name) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    return publicUser(user);
  }
}
