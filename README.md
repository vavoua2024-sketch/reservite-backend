# RESERVITE — API (NestJS)

Point d'entrée unique de la plateforme : le **web** (`reservite-backoffice-web`, Next.js) et le **mobile**
(`reservite-mobile-app`, React Native / Expo) appellent tous deux cette API. Toute la logique métier, l'authentification
et les permissions sont ici ; aucun client ne parle directement à la base.

**Stack** : Node.js 20+, NestJS 11, TypeScript, Prisma 5, PostgreSQL 16, JWT, bcrypt, Swagger.

## 1. Démarrer en local

Prérequis : Node.js 20 ou plus, et PostgreSQL (le plus simple : Docker).

```bash
docker compose up -d          # base PostgreSQL locale (ou utilisez votre propre PostgreSQL)
cp .env.example .env          # puis adaptez JWT_SECRET (32 caractères minimum)
npm run setup                 # installe, crée les tables, charge les données de démonstration
npm run start:dev
```

- Santé : http://localhost:4000/health
- Documentation interactive (Swagger) : http://localhost:4000/docs (hors production)

## 2. Comptes de démonstration (jeu de données `npm run prisma:seed`)

| Rôle | Email | Mot de passe |
|---|---|---|
| SuperAdmin | admin@factotumn.ci | super2024 |
| Admin Compagnie (UTB) | yao.kouadio@utb.ci | utb2024 |
| Gérant de gare | aicha.bamba@utb.ci | gare2024 |
| Caissier | fatou.diarra@utb.ci | caisse2024 |
| Contrôleur | ibrahim.coulibaly@utb.ci | scan2024 |
| Agent colis & bagages | fatoumata.sangare@utb.ci | colis2024 |
| Client (app) | aya.ndri@gmail.com | client2024 |
| Admin Compagnie (SBTA, 2e compagnie) | admin@sbta.ci | sbta2024 |

⚠️ Ces comptes n'existent que pour le développement. Le seed refuse de tourner avec `NODE_ENV=production`.

## 3. Authentification

- Personnel (web) : `POST /auth/staff/login` — Clients et contrôleurs (mobile) : `POST /auth/client/login`.
- La réponse contient `accessToken` (court : 1 h) et `refreshToken` (30 jours, à usage unique).
  Renouvellement : `POST /auth/refresh`. Déconnexion : `POST /auth/logout`.
- Chaque requête : `Authorization: Bearer <accessToken>`.
- Le rôle et la compagnie sont relus en base à chaque requête : un compte désactivé perd l'accès immédiatement.

## 4. Routes

| Préfixe | Contenu | Qui |
|---|---|---|
| `/auth` | connexion, inscription client, refresh, mot de passe oublié, `me` | public puis connecté |
| `/companies` | liste, création (avec son admin), modification | création : SuperAdmin |
| `/gares`, `/trajets`, `/vehicules`, `/rental-vehicles` | CRUD limité à la compagnie | Admin Compagnie / SuperAdmin |
| `/voyages` | recherche publique, création, publication, annulation, billets d'un voyage | création : Caissier et plus |
| `/tickets` | `book`, liste, détail, `cancel`, `scan` ; `/bookings/:id` | client, guichet, contrôleur |
| `/colis` | enregistrement, statut, `track/:code` public | Agent colis et plus |
| `/proforma` | demande de location multi-compagnies, offres, acceptation | client, Admin Compagnie |
| `/users`, `/clients` | personnel de la compagnie, clients | Admin Compagnie / SuperAdmin |
| `/reclamations` | dépôt (client), traitement (personnel) | |
| `/notifications` | liste, lu, enregistrement du jeton push | connecté |
| `/storage` | URL signées S3 (envoi et lecture de fichiers) | connecté |
| `/payments/cinetpay/webhook` | notification de paiement | CinetPay |

Erreurs : toujours `{ "error": "message lisible" }`.

## 5. Règles métier (toutes testées)

- **Anti-survente** : la réservation verrouille le voyage (`SELECT … FOR UPDATE`) pendant qu'elle compte les places.
  Test : 8 réservations simultanées pour 3 places → exactement 3 réussissent.
- **Un billet par place**, avec code unique à scanner ; chaque billet se scanne une seule fois.
- **Frais de service 5 %** (`SERVICE_FEE_RATE`), calculés uniquement côté serveur.
- **Annulation** : client jusqu'à 2 h avant le départ (`CANCEL_LIMIT_HOURS`) ; la compagnie peut annuler à tout moment.
  Remboursement dû = prix du billet **sans** les frais de service. ⚠️ Règle par défaut, à confirmer avec le commanditaire ;
  le remboursement réel via CinetPay n'est pas automatisé.
- **Places en attente de paiement** : réservées `SEAT_HOLD_MINUTES` (15 min), puis libérées si non payées.
- **Location** : une demande part vers plusieurs compagnies ; accepter une offre refuse automatiquement les autres.
- **Isolation** : le personnel d'une compagnie ne voit et ne modifie que les données de sa compagnie.
- **Suivi de colis public** : sans connexion, sans noms ni téléphones. Chaque changement de statut journalise un SMS.

## 6. Paiement CinetPay

Par défaut `PAYMENT_PROVIDER=simulated` : le paiement est accepté tout de suite (développement). Pour de vrais paiements :

1. Créez un compte marchand CinetPay, renseignez `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `PUBLIC_API_URL` (adresse publique de l'API,
   en HTTPS) et `PAYMENT_RETURN_URL`, puis mettez `PAYMENT_PROVIDER=cinetpay`.
2. L'app ouvre `paymentUrl` ; CinetPay appelle ensuite `POST /payments/cinetpay/webhook`.
3. Le webhook **n'est jamais cru tel quel** : l'API interroge CinetPay (`/payment/check`) et compare le montant avant de valider les billets.
4. Les montants sont arrondis à un multiple de 5 (exigence CinetPay en XOF) en ajustant les frais de service.

⚠️ L'intégration est écrite d'après la documentation CinetPay mais n'a pas pu être testée avec de vrais identifiants : à valider
en environnement de test CinetPay avant la production.

## 7. SMS, e-mail, push, stockage

- **SMS / e-mail** : `SMS_PROVIDER=log` et `EMAIL_PROVIDER=log` écrivent dans les journaux et en base. Branchez un fournisseur dans
  `src/notifications/notifications.service.ts` (Twilio, agrégateur local, Resend, Brevo...).
- **Push** : notifications Expo, envoyées si l'appareil a enregistré son jeton (`POST /notifications/device-token`).
- **Fichiers** : stockage compatible S3 (AWS S3, Cloudflare R2, Scaleway) par URL signées ; renseignez les variables `S3_*`.

## 8. Tests

```bash
npm test            # règles métier pures
npm run test:e2e    # API complète sur la base de DATABASE_URL (chargez d'abord le seed)
```

La CI GitHub (`.github/workflows/ci.yml`) lance les deux sur un PostgreSQL éphémère.

## 9. Mise en production

- Base PostgreSQL gérée (Neon, Supabase, Railway...). `npx prisma migrate deploy` applique les migrations.
- Image Docker fournie (`Dockerfile`) : Render, Railway ou Fly.io.
- Avant la mise en ligne : `JWT_SECRET` aléatoire (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`),
  `CORS_ORIGIN` limité aux adresses réelles du web, `NODE_ENV=production`, pas de seed.
