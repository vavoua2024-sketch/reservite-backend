import { BadRequestException, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/http-exception.filter';

const FR: Record<string, string> = {
  isEmail: 'adresse e-mail invalide',
  isNotEmpty: 'champ obligatoire',
  isString: 'texte attendu',
  minLength: 'valeur trop courte',
  maxLength: 'valeur trop longue',
  isInt: 'nombre entier attendu',
  isNumber: 'nombre attendu',
  min: 'valeur trop petite',
  max: 'valeur trop grande',
  isEnum: 'valeur non autorisée',
  isIn: 'valeur non autorisée',
  isDateString: 'date invalide',
  isArray: 'liste attendue',
  arrayMinSize: 'liste trop courte',
  arrayMaxSize: 'liste trop longue',
  isBoolean: 'vrai ou faux attendu',
  matches: 'format invalide',
};

/** Messages de validation en français : « champ : explication ». Les messages personnalisés des DTO sont conservés. */
function frenchMessages(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.entries(e.constraints ?? {}).map(([key, msg]) => (msg.startsWith(e.property) ? `${path} : ${FR[key] ?? 'valeur invalide'}` : msg));
    return [...own, ...frenchMessages(e.children ?? [], path)];
  });
}

/** Configuration commune à l'application et aux tests de bout en bout. */
export function configureApp(app: INestApplication) {
  app.use(helmet());
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, exceptionFactory: (errors) => new BadRequestException(frenchMessages(errors)) }));
  app.useGlobalFilters(new AllExceptionsFilter());
}
