import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  companyId: string | null;
  gareId: string | null;
}

export const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER', 'CONTROLLER', 'PARCEL_AGENT'];
export const COMPANY_ROLES: Role[] = ['COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER', 'CONTROLLER', 'PARCEL_AGENT'];
