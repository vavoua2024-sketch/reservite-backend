import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { AuthUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class DeviceTokenDto {
  @IsString() @MinLength(10) token: string;
  @IsOptional() @IsString() platform?: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('device-token')
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: DeviceTokenDto) {
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { token: dto.token, platform: dto.platform, userId: user.id },
      update: { userId: user.id, platform: dto.platform },
    });
    return { ok: true };
  }
}
