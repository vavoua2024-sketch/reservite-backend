import { ForbiddenException } from '@nestjs/common';
import { AuthUser } from './auth.types';

/**
 * Isolation entre compagnies : le personnel d'une compagnie ne voit que ses données.
 * SuperAdmin voit tout (retourne undefined). Un client n'a pas de compagnie.
 */
export function companyScope(user: AuthUser): string | undefined {
  if (user.role === 'SUPER_ADMIN') return undefined;
  if (!user.companyId) throw new ForbiddenException('Aucune compagnie associée à ce compte.');
  return user.companyId;
}

/** Vérifie qu'une ressource appartient bien à la compagnie de l'utilisateur. */
export function assertSameCompany(user: AuthUser, resourceCompanyId: string | null | undefined) {
  if (user.role === 'SUPER_ADMIN') return;
  if (!resourceCompanyId || resourceCompanyId !== user.companyId) {
    throw new ForbiddenException("Cette ressource n'appartient pas à votre compagnie.");
  }
}

/** Compagnie à utiliser pour une création : celle de l'utilisateur, ou celle fournie par le SuperAdmin. */
export function companyForCreate(user: AuthUser, requested?: string): string {
  if (user.role === 'SUPER_ADMIN') {
    if (!requested) throw new ForbiddenException('companyId requis pour le SuperAdmin.');
    return requested;
  }
  if (!user.companyId) throw new ForbiddenException('Aucune compagnie associée à ce compte.');
  return user.companyId;
}
