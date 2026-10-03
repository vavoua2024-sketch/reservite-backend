import { Body, Controller, Get, Post, Query, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { AuthUser } from '../common/auth.types';
import { CurrentUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class PresignDto {
  @IsString() @Matches(/^[\w.\- ]{1,120}$/) filename: string;
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) contentType: string;
  @IsOptional() @IsIn(['logos', 'vehicules', 'documents']) folder?: string;
}

/** Les fichiers vont directement du client vers le stockage S3 par URL signée de courte durée ; jamais dans la base. */
@Controller('storage')
export class StorageController {
  private client?: S3Client;
  constructor(private prisma: PrismaService) {}

  private s3() {
    const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_REGION } = process.env;
    if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new ServiceUnavailableException("Le stockage de fichiers n'est pas configuré.");
    this.client ??= new S3Client({
      region: S3_REGION || 'auto', endpoint: S3_ENDPOINT || undefined, forcePathStyle: !!S3_ENDPOINT,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    });
    return { client: this.client, bucket: S3_BUCKET };
  }

  @Post('presign')
  async presign(@CurrentUser() user: AuthUser, @Body() dto: PresignDto) {
    const { client, bucket } = this.s3();
    const key = `${dto.folder ?? 'documents'}/${user.id}/${randomUUID()}-${dto.filename.replace(/\s+/g, '_')}`;
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: dto.contentType }), { expiresIn: 300 });
    await this.prisma.fileAsset.create({ data: { key, ownerId: user.id, mimeType: dto.contentType } });
    return { uploadUrl, key, method: 'PUT', headers: { 'Content-Type': dto.contentType } };
  }

  @Get('url')
  async url(@Query('key') key?: string) {
    if (!key) throw new BadRequestException('key requis.');
    const { client, bucket } = this.s3();
    const asset = await this.prisma.fileAsset.findUnique({ where: { key } });
    if (!asset) throw new BadRequestException('Fichier inconnu.');
    return { url: await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 }) };
  }
}
