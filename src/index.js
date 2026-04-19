import express from "express";
import path from "path";
import { fileURLToPath } from "url";
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
import transactionRoutes from './routes/transactionRoutes.js';
import reservationRoutes from './routes/reservationRoutes.js';
import { initCronJobs } from './services/cronService.js';
import collectorRoutes from "./routes/collectorRoutes.js";
import adminRoutes from "./routes/adminRoute.js";
import kycRoutes from "./routes/kycRoute.js";
import userRoutes from "./routes/userRoutes.js";
import itemRoutes from "./routes/itemRoutes.js";
import listingRoutes from "./routes/listingRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import adminReportRoutes from "./routes/adminReportRoutes.js";
import adminMonitoringRoutes from "./routes/adminMonitoringRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import batchRoutes from "./routes/batchRoutes.js";
import appRoutes from "./routes/appRoutes.js";
import logRoutes from "./routes/logRoutes.js";
import complaintRoutes from "./routes/complaintRoutes.js";

import { errorHandler } from "./middlewares/errorMiddleware.js";
import { performanceMonitor } from "./middlewares/performanceMiddleware.js";
import { traceMiddleware } from "./middlewares/traceMiddleware.js";
import { activityLogMiddleware } from "./middlewares/activityLogMiddleware.js";
import { logger, stream } from "./utils/logger.js";

import "./config/cloudinary.js";

dotenv.config({ quiet: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// Enable trust proxy only in production to handle X-Forwarded-For headers
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(compression());

// CORS Configuration
const allowedOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',')
    : ['http://localhost:3000', 'http://192.168.194.2:3000', 'http://localhost:5173'];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        // or if in development mode
        if (!origin || process.env.NODE_ENV === 'development') {
            return callback(null, true);
        }
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan("combined", { stream }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// End-to-End Distributed Tracing
app.use(traceMiddleware);

// Global Activity Logging — logs EVERY API operation (tiny to big)
app.use(activityLogMiddleware);

app.use("/api/auth", authRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use("/api/collector", collectorRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/user", userRoutes);
app.use("/api/items", itemRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reservations', reservationRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin/reports", adminReportRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/batch", batchRoutes);
app.use("/api/app", appRoutes);
app.use("/api/complaints", complaintRoutes);

// Static folder configuration
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// System Monitoring
app.use(performanceMonitor);

// Admin Control Panel Routes
app.use("/api/admin/monitoring", adminMonitoringRoutes);


app.get("/health", (req, res) => res.json({ ok: true }));

app.use(errorHandler);

// Only start the HTTP server when NOT running on Vercel (serverless)
if (!process.env.VERCEL) {
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`\x1b[32m[SERVER] Running successfully on http://localhost:${PORT}\x1b[0m`);
        console.log(`\x1b[36m[SWAGGER] Documentation available at http://localhost:${PORT}/api-docs\x1b[0m`);

        // Initialize background tasks (only in non-serverless env)
        initCronJobs();

        logger.info(`Server started on port ${PORT}`);

        // Attempt to fetch ngrok URL (timeout 1s to avoid blocking if not running)
        fetch('http://127.0.0.1:4040/api/tunnels')
            .then(res => res.json())
            .then(data => {
                const tunnel = data.tunnels.find(t => t.public_url.startsWith('https'));
                if (tunnel) {
                    console.log(`\x1b[35m[NGROK] Public URL: ${tunnel.public_url}\x1b[0m`);
                }
            })
            .catch(() => {
                // Ngrok not running or not accessible, ignore
            });
    });
}

// Export the app for Vercel serverless
export default app;
