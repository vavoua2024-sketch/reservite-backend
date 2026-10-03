import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Format d'erreur uniforme : { "error": "message" }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private logger = new Logger('Erreur');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erreur interne du serveur.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      const raw = typeof body === 'string' ? body : body?.message ?? exception.message;
      message = Array.isArray(raw) ? raw.join(' ; ') : raw;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'Cette valeur existe déjà.';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        message = 'Impossible : cet élément est lié à d\'autres données.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Élément introuvable.';
      } else {
        this.logger.error(exception.message);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json({ error: message });
  }
}
