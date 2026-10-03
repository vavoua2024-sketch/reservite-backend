import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

// Ces tests utilisent la base de DATABASE_URL (jeu de démonstration chargé par `npm run prisma:seed`).
describe('API RESERVITE (bout en bout)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};

  const login = async (key: string, path: string, email: string, password: string) => {
    const res = await http().post(path).send({ email, password }).expect(200);
    tokens[key] = res.body.accessToken;
    return res.body;
  };
  const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER = 'simulated';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    await login('super', '/auth/staff/login', 'admin@factotumn.ci', 'super2024');
    await login('admin', '/auth/staff/login', 'yao.kouadio@utb.ci', 'utb2024');
    await login('cashier', '/auth/staff/login', 'fatou.diarra@utb.ci', 'caisse2024');
    await login('parcel', '/auth/staff/login', 'fatoumata.sangare@utb.ci', 'colis2024');
    await login('sbta', '/auth/staff/login', 'admin@sbta.ci', 'sbta2024');
    await login('controller', '/auth/client/login', 'ibrahim.coulibaly@utb.ci', 'scan2024');
    await login('client', '/auth/client/login', 'aya.ndri@gmail.com', 'client2024');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /** Voyage publié de la compagnie UTB, créé directement en base pour maîtriser capacité et horaire. */
  async function makeVoyage(capacity: number, hoursFromNow: number, price = 5000) {
    const company = await prisma.company.findUniqueOrThrow({ where: { name: 'UTB' } });
    const trajet = await prisma.trajet.findFirstOrThrow({ where: { companyId: company.id } });
    const vehicule = await prisma.vehicule.create({ data: { plate: `T-${Math.random().toString(36).slice(2, 8)}`, capacity, companyId: company.id } });
    return prisma.voyage.create({
      data: {
        trajetId: trajet.id, vehiculeId: vehicule.id, companyId: company.id, price, seatsTotal: capacity,
        departureAt: new Date(Date.now() + hoursFromNow * 3600_000), status: 'PUBLISHED',
      },
    });
  }

  describe('santé et authentification', () => {
    it('répond sur /health', async () => {
      const res = await http().get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('refuse une route protégée sans jeton', async () => {
      await http().get('/tickets').expect(401);
    });

    it('refuse un mauvais mot de passe avec un message clair', async () => {
      const res = await http().post('/auth/staff/login').send({ email: 'fatou.diarra@utb.ci', password: 'faux' }).expect(401);
      expect(res.body.error).toMatch(/incorrect/);
    });

    it('un client ne peut pas se connecter au backoffice', async () => {
      await http().post('/auth/staff/login').send({ email: 'aya.ndri@gmail.com', password: 'client2024' }).expect(401);
    });

    it("inscrit un client, puis renouvelle et révoque son jeton", async () => {
      const email = `test-${Date.now()}@example.com`;
      const reg = await http().post('/auth/client/register').send({ name: 'Test Client', email, password: 'motdepasse1' }).expect(201);
      expect(reg.body.user.role).toBe('CLIENT');
      const refreshed = await http().post('/auth/refresh').send({ refreshToken: reg.body.refreshToken }).expect(200);
      expect(refreshed.body.accessToken).toBeTruthy();
      await http().post('/auth/refresh').send({ refreshToken: reg.body.refreshToken }).expect(401); // rotation : usage unique
      await http().post('/auth/client/register').send({ name: 'Doublon', email, password: 'motdepasse1' }).expect(409);
    });

    it('rejette un mot de passe trop court', async () => {
      await http().post('/auth/client/register').send({ name: 'X Y', email: 'court@example.com', password: '123' }).expect(400);
    });
  });

  describe('rôles et isolation entre compagnies', () => {
    it("un caissier ne peut pas créer de gare", async () => {
      await http().post('/gares').set(auth('cashier')).send({ name: 'Gare X', city: 'Abidjan' }).expect(403);
    });

    it("l'admin SBTA ne voit pas les gares de UTB et ne peut pas les modifier", async () => {
      const utbGares = await http().get('/gares').set(auth('admin')).expect(200);
      const sbtaGares = await http().get('/gares').set(auth('sbta')).expect(200);
      expect(sbtaGares.body.every((g: any) => g.companyId !== utbGares.body[0].companyId)).toBe(true);
      await http().patch(`/gares/${utbGares.body[0].id}`).set(auth('sbta')).send({ name: 'Piraté' }).expect(403);
    });

    it("l'admin compagnie crée un caissier mais pas un SuperAdmin", async () => {
      const email = `caissier-${Date.now()}@utb.ci`;
      const ok = await http().post('/users').set(auth('admin')).send({ name: 'Nouveau Caissier', email, password: 'motdepasse1', role: 'CASHIER' }).expect(201);
      expect(ok.body.role).toBe('CASHIER');
      expect(ok.body.companyId).toBeTruthy();
      await http().post('/users').set(auth('admin')).send({ name: 'Pirate', email: `p-${email}`, password: 'motdepasse1', role: 'SUPER_ADMIN' }).expect(403);
    });
  });

  describe('voyages', () => {
    it('le caissier crée un voyage en brouillon, invisible du public, puis le publie', async () => {
      const trajets = await http().get('/trajets').set(auth('cashier')).expect(200);
      const vehicules = await http().get('/vehicules').set(auth('cashier')).expect(200);
      const created = await http().post('/voyages').set(auth('cashier')).send({
        trajetId: trajets.body[0].id, vehiculeId: vehicules.body[0].id,
        departureAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      }).expect(201);
      expect(created.body.status).toBe('DRAFT');
      expect(created.body.seatsAvailable).toBe(created.body.seatsTotal);
      await http().get(`/voyages/${created.body.id}`).expect(404);
      const pub = await http().post(`/voyages/${created.body.id}/publish`).set(auth('cashier')).expect(201);
      expect(pub.body.status).toBe('PUBLISHED');
      await http().get(`/voyages/${created.body.id}`).expect(200);
    });

    it('la recherche publique ne renvoie que des voyages publiés à venir', async () => {
      const res = await http().get('/voyages?from=abidjan').expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const v of res.body) {
        expect(v.status).toBe('PUBLISHED');
        expect(new Date(v.departureAt).getTime()).toBeGreaterThan(Date.now());
      }
    });
  });

  describe('billetterie', () => {
    it('réserve 2 places : un billet par place, 5 % de frais, paiement simulé confirmé', async () => {
      const v = await makeVoyage(10, 24, 5000);
      const res = await http().post('/tickets/book').set(auth('client')).send({ voyageId: v.id, seats: 2, passengers: ['Aya', 'Koffi'] }).expect(201);
      expect(res.body.subtotal).toBe(10000);
      expect(res.body.fee).toBe(500);
      expect(res.body.total).toBe(10500);
      expect(res.body.paymentStatus).toBe('PAID');
      expect(res.body.tickets).toHaveLength(2);
      expect(res.body.tickets.map((t: any) => t.seatNumber)).toEqual([1, 2]);
      expect(new Set(res.body.tickets.map((t: any) => t.code)).size).toBe(2);
      expect(res.body.tickets.every((t: any) => t.status === 'VALID')).toBe(true);
    });

    it('ANTI-SURVENTE : 8 réservations simultanées pour 3 places, exactement 3 réussissent', async () => {
      const v = await makeVoyage(3, 24);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => http().post('/tickets/book').set(auth('client')).send({ voyageId: v.id, seats: 1 })),
      );
      const ok = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 409);
      expect(ok).toHaveLength(3);
      expect(refused).toHaveLength(5);
      const seats = ok.map((r) => r.body.tickets[0].seatNumber).sort();
      expect(seats).toEqual([1, 2, 3]);
      expect(refused[0].body.error).toMatch(/complet/);
    });

    it('refuse une réservation de plus de places que disponible', async () => {
      const v = await makeVoyage(2, 24);
      const res = await http().post('/tickets/book').set(auth('client')).send({ voyageId: v.id, seats: 3 }).expect(409);
      expect(res.body.error).toMatch(/2 place/);
    });

    it("refuse la réservation d'un voyage brouillon ou déjà parti", async () => {
      const draft = await prisma.voyage.update({ where: { id: (await makeVoyage(5, 24)).id }, data: { status: 'DRAFT' } });
      await http().post('/tickets/book').set(auth('client')).send({ voyageId: draft.id, seats: 1 }).expect(400);
    });

    it('vente au guichet par le caissier, payée en espèces', async () => {
      const v = await makeVoyage(5, 24);
      const res = await http().post('/tickets/book').set(auth('cashier')).send({ voyageId: v.id, seats: 1, customerName: 'Client guichet', customerPhone: '+22507000000' }).expect(201);
      expect(res.body.paymentMethod).toBe('CASH');
      expect(res.body.paymentStatus).toBe('PAID');
    });

    it("annulation : refusée à moins de 2 h du départ, acceptée au-delà, jamais deux fois", async () => {
      const soon = await makeVoyage(5, 1);
      const far = await makeVoyage(5, 24, 5000);
      const bSoon = await http().post('/tickets/book').set(auth('client')).send({ voyageId: soon.id, seats: 1 }).expect(201);
      const bFar = await http().post('/tickets/book').set(auth('client')).send({ voyageId: far.id, seats: 1 }).expect(201);

      const refused = await http().post(`/tickets/${bSoon.body.tickets[0].id}/cancel`).set(auth('client')).expect(400);
      expect(refused.body.error).toMatch(/2 h/);

      const cancelled = await http().post(`/tickets/${bFar.body.tickets[0].id}/cancel`).set(auth('client')).expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.refundAmount).toBe(5000); // prix du billet, sans les frais de service
      await http().post(`/tickets/${bFar.body.tickets[0].id}/cancel`).set(auth('client')).expect(400);

      // la place annulée est de nouveau disponible
      const again = await http().post('/tickets/book').set(auth('client')).send({ voyageId: far.id, seats: 1 }).expect(201);
      expect(again.body.tickets[0].seatNumber).toBe(1);
    });

    it("un client ne voit que ses billets et ne peut pas lire ceux d'un autre", async () => {
      const mine = await http().get('/tickets').set(auth('client')).expect(200);
      expect(mine.body.length).toBeGreaterThan(0);
      const other = await http().post('/auth/client/register').send({ name: 'Autre Client', email: `autre-${Date.now()}@example.com`, password: 'motdepasse1' }).expect(201);
      const stranger = { Authorization: `Bearer ${other.body.accessToken}` };
      await http().get(`/tickets/${mine.body[0].id}`).set(stranger).expect(404);
      expect((await http().get('/tickets').set(stranger).expect(200)).body).toHaveLength(0);
    });

    it('SCAN : un billet valide passe une seule fois, un faux code est refusé', async () => {
      const v = await makeVoyage(5, 24);
      const b = await http().post('/tickets/book').set(auth('client')).send({ voyageId: v.id, seats: 2 }).expect(201);
      const [t1, t2] = b.body.tickets;
      const first = await http().post('/tickets/scan').set(auth('controller')).send({ code: t1.code }).expect(201);
      expect(first.body.ticket.status).toBe('SCANNED');
      const second = await http().post('/tickets/scan').set(auth('controller')).send({ code: t1.code }).expect(409);
      expect(second.body.error).toMatch(/déjà scanné/);
      await http().post('/tickets/scan').set(auth('controller')).send({ code: t2.code }).expect(201); // chaque place se scanne indépendamment
      await http().post('/tickets/scan').set(auth('controller')).send({ code: 'TKT-FAUXCODE' }).expect(404);
      await http().post('/tickets/scan').set(auth('client')).send({ code: t1.code }).expect(403);
    });

    it("le contrôleur d'une autre compagnie ne peut pas scanner", async () => {
      const v = await makeVoyage(5, 24);
      const b = await http().post('/tickets/book').set(auth('client')).send({ voyageId: v.id, seats: 1 }).expect(201);
      await http().post('/tickets/scan').set(auth('sbta')).send({ code: b.body.tickets[0].code }).expect(403);
    });
  });

  describe('colis', () => {
    it("enregistre un colis, journalise les SMS et permet le suivi public sans connexion", async () => {
      const created = await http().post('/colis').set(auth('parcel')).send({
        senderName: 'Expéditeur', senderPhone: '+22501010101', receiverName: 'Destinataire', receiverPhone: '+22502020202',
        price: 3000, originCity: 'Abidjan', destCity: 'Bouaké',
      }).expect(201);
      expect(created.body.trackingCode).toMatch(/^COL-/);
      const track = await http().get(`/colis/track/${created.body.trackingCode}`).expect(200);
      expect(track.body.status).toBe('REGISTERED');
      expect(JSON.stringify(track.body)).not.toMatch(/Expéditeur|0101/); // aucune donnée personnelle publique
      await http().patch(`/colis/${created.body.id}/status`).set(auth('parcel')).send({ status: 'ARRIVED' }).expect(200);
      const after = await http().get(`/colis/track/${created.body.trackingCode}`).expect(200);
      expect(after.body.events.map((e: any) => e.status)).toEqual(['REGISTERED', 'ARRIVED']);
      const detail = await http().get(`/colis/${created.body.id}`).set(auth('parcel')).expect(200);
      expect(detail.body.sms.length).toBeGreaterThanOrEqual(3);
      await http().get('/colis/track/COL-INCONNU').expect(404);
      await http().get(`/colis/${created.body.id}`).set(auth('sbta')).expect(403);
    });
  });

  describe('location multi-compagnies', () => {
    it("la demande part à 2 compagnies ; accepter une offre refuse automatiquement l'autre", async () => {
      const companies = await prisma.company.findMany({ where: { name: { in: ['UTB', 'SBTA'] } } });
      const start = new Date(Date.now() + 7 * 86400_000).toISOString();
      const end = new Date(Date.now() + 9 * 86400_000).toISOString();
      const created = await http().post('/proforma').set(auth('client')).send({
        startDate: start, endDate: end, passengers: 40, details: 'Mariage', companyIds: companies.map((c) => c.id),
      }).expect(201);
      expect(created.body.offers).toHaveLength(2);

      const utbOffer = (await http().get('/proforma').set(auth('admin')).expect(200)).body.find((o: any) => o.proformaId === created.body.id);
      const sbtaOffer = (await http().get('/proforma').set(auth('sbta')).expect(200)).body.find((o: any) => o.proformaId === created.body.id);
      expect(utbOffer).toBeTruthy();
      await http().post(`/proforma/offers/${utbOffer.id}/respond`).set(auth('sbta')).send({ price: 1 }).expect(403);
      await http().post(`/proforma/offers/${utbOffer.id}/respond`).set(auth('admin')).send({ price: 400000, message: 'Autocar 55 places' }).expect(201);
      await http().post(`/proforma/offers/${sbtaOffer.id}/respond`).set(auth('sbta')).send({ price: 380000 }).expect(201);
      await http().post(`/proforma/offers/${utbOffer.id}/accept`).set(auth('admin')).expect(403);

      const accepted = await http().post(`/proforma/offers/${utbOffer.id}/accept`).set(auth('client')).expect(201);
      expect(accepted.body.status).toBe('ACCEPTED');
      const byCompany = Object.fromEntries(accepted.body.offers.map((o: any) => [o.company.name, o.status]));
      expect(byCompany).toEqual({ UTB: 'ACCEPTED', SBTA: 'REFUSED' });
      await http().post(`/proforma/offers/${sbtaOffer.id}/accept`).set(auth('client')).expect(400);
    });
  });

  describe('réclamations', () => {
    it('le client dépose une réclamation, la compagnie répond', async () => {
      const company = await prisma.company.findUniqueOrThrow({ where: { name: 'UTB' } });
      const r = await http().post('/reclamations').set(auth('client')).send({ subject: 'Retard', message: 'Le car est arrivé très en retard.', companyId: company.id }).expect(201);
      await http().patch(`/reclamations/${r.body.id}`).set(auth('sbta')).send({ status: 'RESOLVED' }).expect(403);
      const done = await http().patch(`/reclamations/${r.body.id}`).set(auth('admin')).send({ status: 'RESOLVED', response: 'Nous nous excusons.' }).expect(200);
      expect(done.body.status).toBe('RESOLVED');
      const notifs = await http().get('/notifications').set(auth('client')).expect(200);
      expect(notifs.body.some((n: any) => n.title.includes('réclamation'))).toBe(true);
    });
  });
});
