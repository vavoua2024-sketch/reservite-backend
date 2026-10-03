import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, publicUser } from './auth.service';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, UpdateProfileDto } from './dto';

// Limite stricte sur les routes sensibles : 10 essais par minute et par adresse IP.
const strict = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Public() @Throttle(strict) @HttpCode(200) @Post('staff/login')
  staffLogin(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, 'staff');
  }

  /** Connexion de l'app mobile : clients et contrôleurs. */
  @Public() @Throttle(strict) @HttpCode(200) @Post('client/login')
  clientLogin(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, 'client');
  }

  @Public() @Throttle(strict) @Post('client/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public() @Throttle(strict) @HttpCode(200) @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public() @HttpCode(200) @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Public() @Throttle(strict) @HttpCode(200) @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public() @Throttle(strict) @HttpCode(200) @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { company: { select: { id: true, name: true } } } });
    return { ...publicUser(full), company: full.company };
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }
}
