require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const companiesRoutes = require("./routes/companies.routes");
const garesRoutes = require("./routes/gares.routes");
const trajetsRoutes = require("./routes/trajets.routes");
const vehiculesRoutes = require("./routes/vehicules.routes");
const voyagesRoutes = require("./routes/voyages.routes");
const ticketsRoutes = require("./routes/tickets.routes");
const colisRoutes = require("./routes/colis.routes");
const proformaRoutes = require("./routes/proforma.routes");
const rentalVehiclesRoutes = require("./routes/rentalVehicles.routes");
const usersRoutes = require("./routes/users.routes");
const clientsRoutes = require("./routes/clients.routes");
const reclamationsRoutes = require("./routes/reclamations.routes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// Vérification rapide que le serveur tourne (utile pour l'hébergeur : Render,
// Railway, Fly.io demandent souvent une route de "health check").
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/companies", companiesRoutes);
app.use("/api/gares", garesRoutes);
app.use("/api/trajets", trajetsRoutes);
app.use("/api/vehicules", vehiculesRoutes);
app.use("/api/voyages", voyagesRoutes);
app.use("/api/tickets", ticketsRoutes);
app.use("/api/colis", colisRoutes);
app.use("/api/proforma", proformaRoutes);
app.use("/api/rental-vehicles", rentalVehiclesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/reclamations", reclamationsRoutes);

app.use((req, res) => res.status(404).json({ error: "Route introuvable." }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RESERVITE API démarrée sur http://localhost:${PORT}`);
  console.log(`Vérification : http://localhost:${PORT}/health`);
});
