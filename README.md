# RESERVITE — Backend réel

Ceci est le **vrai serveur** de RESERVITE : une API complète, avec une vraie base de
données et de vrais mots de passe chiffrés. Contrairement à la démo construite dans
Claude (qui utilisait `window.storage`, propre à l'environnement Claude), ce code
**tourne n'importe où** — sur votre ordinateur, ou sur un vrai serveur en ligne.

## 1. Installation locale (pour tester)

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus, installé sur votre machine.

```bash
cd reservite-backend
cp .env.example .env
npm run setup
```

La commande `npm run setup` fait tout d'un coup : installe les dépendances, crée la
base de données SQLite (`dev.db`, un simple fichier — rien à installer en plus), et
la remplit avec les mêmes données de démonstration qu'on a utilisées jusqu'ici
(mêmes comptes, mêmes compagnies, mêmes trajets).

Puis démarrez le serveur :

```bash
npm run dev
```

Le serveur tourne sur `http://localhost:4000`. Testez qu'il fonctionne en ouvrant
`http://localhost:4000/health` dans un navigateur — vous devez voir `{"status":"ok"}`.

## 2. Comptes de démonstration (identiques à ceux utilisés jusqu'ici)

| Rôle | Email | Mot de passe |
|---|---|---|
| SuperAdmin | admin@factotumn.ci | super2024 |
| Admin Compagnie (UTB) | yao.kouadio@utb.ci | utb2024 |
| Gérant de gare | aicha.bamba@utb.ci | gare2024 |
| Caissier | fatou.diarra@utb.ci | caisse2024 |
| Contrôleur | ibrahim.coulibaly@utb.ci | scan2024 |
| Agent colis & bagages | fatoumata.sangare@utb.ci | colis2024 |
| Client (app) | aya.ndri@gmail.com | client2024 |

## 3. Comment appeler l'API

Toutes les routes protégées attendent un jeton dans l'en-tête `Authorization`.

**Connexion personnel :**
```bash
curl -X POST http://localhost:4000/api/auth/staff/login \
  -H "Content-Type: application/json" \
  -d '{"email":"fatou.diarra@utb.ci","password":"caisse2024"}'
```
La réponse contient un `token`. Utilisez-le ensuite dans chaque appel :
```bash
curl http://localhost:4000/api/tickets \
  -H "Authorization: Bearer LE_TOKEN_RECU"
```

## 4. Passer en production (mise en ligne réelle)

### a) Changer de base de données
SQLite convient pour tester, mais pour un vrai site avec plusieurs utilisateurs en
même temps, utilisez PostgreSQL — gratuit pour démarrer chez
[Supabase](https://supabase.com), [Neon](https://neon.tech) ou [Railway](https://railway.app).

Dans `prisma/schema.prisma`, changez :
```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```
en :
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
Puis mettez la vraie adresse Postgres dans `DATABASE_URL` (fichier `.env`), et relancez :
```bash
npx prisma migrate dev --name switch-to-postgres
```

### b) Héberger le serveur
Options simples et abordables pour la Côte d'Ivoire (peu ou pas de carte bancaire
internationale nécessaire selon l'offre) :
- [Render](https://render.com) — gratuit pour démarrer, très simple
- [Railway](https://railway.app)
- [Fly.io](https://fly.io)

Dans tous les cas : connectez votre dépôt GitHub, indiquez `npm start` comme
commande de démarrage, et renseignez les mêmes variables que dans `.env.example`.

### c) Activer les vrais paiements
Voir `src/payments/cinetpay.js` — il suffit de renseigner vos clés CinetPay dans
`.env` une fois votre compte marchand créé. Aucune autre modification de code
n'est nécessaire.

### d) Activer les vrais SMS
Voir le commentaire `TODO production` dans `src/routes/colis.routes.js` — à
brancher sur un fournisseur SMS (Twilio, ou un agrégateur local).

### e) Sécuriser `JWT_SECRET`
Générez une vraie valeur secrète avant la mise en ligne :
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 5. Brancher le frontend (backoffice web + app mobile)

Les fichiers React qu'on a construits (`reservite-backoffice.jsx` et
`reservite-app-client.jsx`) utilisent actuellement `window.storage`, propre à
Claude. Pour les connecter à cette vraie API, il faut remplacer ces appels par de
vrais appels réseau (`fetch`) vers les routes ci-dessus — par exemple :

```js
// Avant (démo Claude) :
await window.storage.set(STORAGE_KEY, JSON.stringify(data), false);

// Après (vraie API) :
await fetch("https://votre-api.com/api/tickets/book", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
  body: JSON.stringify({ voyageId, seats, payment }),
});
```

C'est un travail de connexion écran par écran — demandez-moi de le faire si vous
voulez que je m'en occupe.

## 6. Ce qui est déjà résolu dans ce backend

- Mots de passe chiffrés (jamais stockés en clair)
- Anti-survente : la réservation de billets vérifie les places restantes dans une
  transaction, pour empêcher deux clients de réserver la même place en même temps
- Génération d'un billet individuel par place (scan indépendant par le contrôleur)
- Calcul centralisé des frais de service (5%)
- Règle d'annulation à 2h du départ
- Demande de location à plusieurs compagnies + refus automatique des concurrents
  à l'acceptation d'une offre
- Suivi de colis public (sans connexion), avec journal de SMS
