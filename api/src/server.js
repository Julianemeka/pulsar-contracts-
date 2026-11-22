import express from "express";
import { errorMiddleware } from "./middleware/errors.js";
import { auditMiddleware } from "./middleware/audit.js";
import merchantsRouter from "./routes/merchants.js";
import paymentsRouter from "./routes/payments.js";

const app = express();

app.use(express.json());

// Structured audit logging for admin-equivalent endpoints.
// Logs timestamp, caller IP, endpoint, HTTP method, response status,
// and business-critical PII (wallet addresses). See docs/audit-log.md
// for the retention policy (suggested: 90 days).
app.use(auditMiddleware);

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/merchants", merchantsRouter);
app.use("/api/payments", paymentsRouter);

app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pulsar API running on port ${PORT}`));