const { PrismaClient } = require("@prisma/client");

// Une seule instance partagée dans toute l'app — évite d'ouvrir trop de
// connexions à la base de données.
const prisma = new PrismaClient();

module.exports = prisma;
