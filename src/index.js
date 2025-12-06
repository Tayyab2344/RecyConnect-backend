import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { createServer } from "http";
import { swaggerSpec } from "./utils/swagger.js";
import authRoutes from "./routes/authRoute.js";
import warehouseRoutes from "./routes/warehouseRoute.js";
import collectorRoutes from "./routes/collectorRoutes.js";
import adminRoutes from "./routes/adminRoute.js";
import kycRoutes from "./routes/kycRoute.js";
import userRoutes from "./routes/userRoutes.js";
import itemRoutes from "./routes/itemRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import adminReportRoutes from "./routes/adminReportRoutes.js";

import { errorHandler } from "./middlewares/errorMiddleware.js";
import { logger, stream } from "./utils/logger.js";

import "./config/cloudinary.js";

dotenv.config();
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;



app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/auth", authRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use("/api/collector", collectorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/user", userRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin/reports", adminReportRoutes);


app.get("/health", (req, res) => res.json({ ok: true }));

app.use(errorHandler);

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Swagger available at http://localhost:${PORT}/api-docs`);
});

