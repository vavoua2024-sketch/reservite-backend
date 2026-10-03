import { canCancel, computeFees, pickSeats, randomCode } from './rules';

describe('règles métier', () => {
  it('calcule 5 % de frais de service', () => {
    expect(computeFees(5000, 2)).toEqual({ subtotal: 10000, fee: 500, total: 10500 });
    expect(computeFees(3333, 1)).toEqual({ subtotal: 3333, fee: 167, total: 3500 });
    expect(computeFees(3333, 1, 0.05, 5).total % 5).toBe(0);
    expect(computeFees(1001, 1, 0.05, 5)).toEqual({ subtotal: 1001, fee: 54, total: 1055 });
  });

  it("autorise l'annulation jusqu'à 2 h avant le départ", () => {
    const now = new Date('2026-01-01T10:00:00Z');
    expect(canCancel(new Date('2026-01-01T12:00:00Z'), now)).toBe(true);
    expect(canCancel(new Date('2026-01-01T11:59:59Z'), now)).toBe(false);
    expect(canCancel(new Date('2026-01-01T09:00:00Z'), now)).toBe(false);
  });

  it('attribue les plus petites places libres', () => {
    expect(pickSeats(5, [1, 3], 2)).toEqual([2, 4]);
    expect(pickSeats(3, [1, 2, 3], 1)).toBeNull();
    expect(pickSeats(3, [1], 3)).toBeNull();
  });

  it('génère des codes uniques au bon format', () => {
    const a = randomCode('TKT');
    expect(a).toMatch(/^TKT-[A-Z2-9]{8}$/);
    expect(randomCode('TKT')).not.toBe(a);
  });
});
