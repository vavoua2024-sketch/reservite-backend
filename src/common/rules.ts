// Règles métier pures (sans base de données) : faciles à tester.

export const DEFAULT_FEE_RATE = 0.05;
export const DEFAULT_CANCEL_LIMIT_HOURS = 2;

/**
 * Frais de service (5 % par défaut), arrondis au franc. Calcul unique côté serveur.
 * `step` : certains opérateurs (CinetPay en XOF) exigent un total multiple de 5 ; les frais sont alors arrondis vers le haut.
 */
export function computeFees(unitPrice: number, seats: number, feeRate = DEFAULT_FEE_RATE, step = 1) {
  const subtotal = unitPrice * seats;
  let fee = Math.round(subtotal * feeRate);
  const rest = (subtotal + fee) % step;
  if (step > 1 && rest !== 0) fee += step - rest;
  return { subtotal, fee, total: subtotal + fee };
}

/** Annulation autorisée jusqu'à N heures avant le départ (2 h par défaut). */
export function canCancel(departureAt: Date, now = new Date(), limitHours = DEFAULT_CANCEL_LIMIT_HOURS) {
  return departureAt.getTime() - now.getTime() >= limitHours * 3600 * 1000;
}

/** Choisit les `count` plus petits numéros de place libres entre 1 et `capacity`. */
export function pickSeats(capacity: number, taken: Iterable<number>, count: number): number[] | null {
  const used = new Set(taken);
  const seats: number[] = [];
  for (let n = 1; n <= capacity && seats.length < count; n++) {
    if (!used.has(n)) seats.push(n);
  }
  return seats.length === count ? seats : null;
}

/** Code lisible et difficile à deviner (billets, suivi de colis). */
export function randomCode(prefix: string, length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bytes: Buffer = require('crypto').randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${out}`;
}

/** Tickets qui occupent une place : valides, scannés, ou en attente de paiement dont la réservation n'a pas expiré. */
export function activeTicketWhere(now = new Date()) {
  return {
    OR: [
      { status: { in: ['VALID', 'SCANNED'] as ('VALID' | 'SCANNED')[] } },
      { status: 'PENDING' as const, holdExpiresAt: { gt: now } },
    ],
  };
}
