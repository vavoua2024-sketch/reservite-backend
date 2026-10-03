import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import 'dotenv/config';

const prisma = new PrismaClient();

// Données de démonstration : mêmes comptes que dans les README. NE JAMAIS exécuter en production.
async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'true') {
    throw new Error('Seed de démonstration refusé en production (définir SEED_DEMO=true pour forcer).');
  }

  const hash = (p: string) => bcrypt.hash(p, 10);
  const upsertUser = async (email: string, name: string, role: Role, password: string, extra: { companyId?: string; gareId?: string; phone?: string } = {}) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role, passwordHash: await hash(password), ...extra },
    });

  const utb = await prisma.company.upsert({ where: { name: 'UTB' }, update: {}, create: { name: 'UTB', phone: '+225 27 20 00 00 01', email: 'contact@utb.ci' } });
  const sbta = await prisma.company.upsert({ where: { name: 'SBTA' }, update: {}, create: { name: 'SBTA', phone: '+225 27 20 00 00 02', email: 'contact@sbta.ci' } });

  const findOrCreate = async <T>(find: () => Promise<T | null>, create: () => Promise<T>) => (await find()) ?? (await create());

  const gareAbj = await findOrCreate(
    () => prisma.gare.findFirst({ where: { companyId: utb.id, city: 'Abidjan' } }),
    () => prisma.gare.create({ data: { name: 'Gare UTB Adjamé', city: 'Abidjan', address: 'Adjamé', companyId: utb.id } }),
  );
  await findOrCreate(
    () => prisma.gare.findFirst({ where: { companyId: utb.id, city: 'Yamoussoukro' } }),
    () => prisma.gare.create({ data: { name: 'Gare UTB Yamoussoukro', city: 'Yamoussoukro', companyId: utb.id } }),
  );
  await findOrCreate(
    () => prisma.gare.findFirst({ where: { companyId: sbta.id } }),
    () => prisma.gare.create({ data: { name: 'Gare SBTA Abobo', city: 'Abidjan', companyId: sbta.id } }),
  );

  await upsertUser('admin@factotumn.ci', 'Super Admin', 'SUPER_ADMIN', 'super2024');
  await upsertUser('yao.kouadio@utb.ci', 'Yao Kouadio', 'COMPANY_ADMIN', 'utb2024', { companyId: utb.id });
  await upsertUser('aicha.bamba@utb.ci', 'Aïcha Bamba', 'GARE_MANAGER', 'gare2024', { companyId: utb.id, gareId: gareAbj.id });
  await upsertUser('fatou.diarra@utb.ci', 'Fatou Diarra', 'CASHIER', 'caisse2024', { companyId: utb.id, gareId: gareAbj.id });
  await upsertUser('ibrahim.coulibaly@utb.ci', 'Ibrahim Coulibaly', 'CONTROLLER', 'scan2024', { companyId: utb.id });
  await upsertUser('fatoumata.sangare@utb.ci', 'Fatoumata Sangaré', 'PARCEL_AGENT', 'colis2024', { companyId: utb.id });
  await upsertUser('aya.ndri@gmail.com', 'Aya Ndri', 'CLIENT', 'client2024', { phone: '+225 07 00 00 00 01' });
  // Deuxième compagnie : sert à tester l'isolation entre compagnies et la location multi-compagnies.
  await upsertUser('admin@sbta.ci', 'Admin SBTA', 'COMPANY_ADMIN', 'sbta2024', { companyId: sbta.id });

  for (const company of [utb, sbta]) {
    const existing = await prisma.trajet.count({ where: { companyId: company.id } });
    if (existing > 0) continue;
    const abjYak = await prisma.trajet.create({ data: { fromCity: 'Abidjan', toCity: 'Yamoussoukro', basePrice: 5000, durationMin: 240, companyId: company.id } });
    const abjBke = await prisma.trajet.create({ data: { fromCity: 'Abidjan', toCity: 'Bouaké', basePrice: 7000, durationMin: 330, companyId: company.id } });
    const bus = await prisma.vehicule.create({ data: { plate: `${company.name}-001-CI`, model: 'Yutong 55 places', capacity: 55, companyId: company.id } });
    const mini = await prisma.vehicule.create({ data: { plate: `${company.name}-002-CI`, model: 'Minibus 30 places', capacity: 30, companyId: company.id } });
    const gare = await prisma.gare.findFirstOrThrow({ where: { companyId: company.id, city: 'Abidjan' } });
    const at = (days: number, hour: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      d.setUTCHours(hour, 0, 0, 0);
      return d;
    };
    for (const [trajet, vehicule, days, hour] of [
      [abjYak, bus, 1, 7], [abjYak, mini, 1, 14], [abjBke, bus, 2, 8], [abjBke, mini, 3, 9],
    ] as const) {
      await prisma.voyage.create({
        data: { trajetId: trajet.id, vehiculeId: vehicule.id, gareId: gare.id, companyId: company.id, departureAt: at(days, hour), price: trajet.basePrice, seatsTotal: vehicule.capacity, status: 'PUBLISHED' },
      });
    }
    await prisma.rentalVehicle.create({ data: { companyId: company.id, name: 'Car grand tourisme', type: 'Autocar', seats: 55, pricePerDay: 250000 } });
    await prisma.rentalVehicle.create({ data: { companyId: company.id, name: 'Minibus', type: 'Minibus', seats: 30, pricePerDay: 120000 } });
  }
  console.log('Données de démonstration prêtes.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
