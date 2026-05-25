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

// ── Utilities & Config ────────────────────────────────────────
import { swaggerSpec } from "./utils/swagger.js";
import { logger, stream } from "./utils/logger.js";
import { initCronJobs } from "./services/cronService.js";
import { initSocketGateway } from "./modules/chat/gateway/socketGateway.js";
import { initializeTrie } from "./services/trieSearchService.js";
import "./config/cloudinary.js";
import { initKafka, startKafkaConsumer, disconnectKafka } from "./lib/kafka.js";

// ── Middlewares ────────────────────────────────────────────────
import { errorHandler } from "./middlewares/errorMiddleware.js";
import { performanceMonitor } from "./middlewares/performanceMiddleware.js";
import { traceMiddleware } from "./middlewares/traceMiddleware.js";
import { activityLogMiddleware } from "./middlewares/activityLogMiddleware.js";

// ── Module Routes ─────────────────────────────────────────────
import adminRoutes from "./modules/admin/routes/index.js";
import authRoutes from "./modules/auth/routes/authRoutes.js";
import userRoutes from "./modules/user/routes/userRoutes.js";
import itemRoutes from "./modules/item/routes/itemRoutes.js";
import listingRoutes from "./modules/listing/routes/listingRoutes.js";
import orderRoutes from "./modules/order/routes/orderRoutes.js";
import paymentRoutes from "./modules/payment/routes/paymentRoutes.js";
import chatRoutes from "./modules/chat/routes/chatRoutes.js";
import kycRoutes from "./modules/kyc/routes/kycRoutes.js";
import warehouseRoutes from "./modules/warehouse/routes/warehouseRoutes.js";
import collectorRoutes from "./modules/warehouse/routes/collectorRoutes.js";
import erpRoutes from "./modules/warehouse/routes/erpRoutes.js";
import transactionRoutes from "./modules/transaction/routes/transactionRoutes.js";
import reservationRoutes from "./modules/reservation/routes/reservationRoutes.js";
import reportRoutes from "./modules/report/routes/reportRoutes.js";
import complaintRoutes from "./modules/complaint/routes/complaintRoutes.js";
import batchRoutes from "./modules/batch/routes/batchRoutes.js";
import appRoutes from "./modules/app/routes/appRoutes.js";
import logRoutes from "./modules/log/routes/logRoutes.js";
import notificationRoutes from "./modules/notification/routes/notificationRoutes.js";
import rewardsRoutes from "./modules/rewards/routes/rewardsRoutes.js";


// ── App Initialization ───────────────────────────────────────
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

// ── Security & Performance Middleware ─────────────────────────
app.use(helmet());
app.use(compression());

// CORS Configuration
const defaultOrigins = [
    'http://localhost:3000',
    'http://192.168.194.2:3000',
    'http://localhost:5173',
    'https://admin.ranatayyab.dev/'
];

const allowedOrigins = process.env.FRONTEND_URL
    ? [...process.env.FRONTEND_URL.split(','), ...defaultOrigins]
    : defaultOrigins;

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl) or in development mode
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

// ── API Documentation ─────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Global Middleware Pipeline ────────────────────────────────
app.use(traceMiddleware);
app.use(activityLogMiddleware);

// ── API Routes ────────────────────────────────────────────────
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use("/api/warehouse/erp", erpRoutes);
app.use("/api/collector", collectorRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/batch", batchRoutes);
app.use("/api/app", appRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/rewards", rewardsRoutes);


// ── Static Files ──────────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ── System Monitoring ─────────────────────────────────────────
app.use(performanceMonitor);

// ── Health Check ──────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true }));

// ── Error Handler (must be last) ──────────────────────────────
app.use(errorHandler);

// ── Server Startup ────────────────────────────────────────────
initSocketGateway(httpServer);

if (!process.env.VERCEL) {
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`\x1b[32m[SERVER] Running successfully on http://localhost:${PORT}\x1b[0m`);
        console.log(`\x1b[36m[SWAGGER] Documentation available at http://localhost:${PORT}/api-docs\x1b[0m`);

        initCronJobs();
        initializeTrie().catch(err => logger.error(`[TRIE] Init error: ${err.message}`));
        initKafka()
            .then(() => startKafkaConsumer())
            .catch(err => logger.error(`[KAFKA] Startup error: ${err.message}`));
        logger.info(`Server started on port ${PORT}`);

        fetch('http://127.0.0.1:4040/api/tunnels')
            .then(res => res.json())
            .then(data => {
                const tunnel = data.tunnels.find(t => t.public_url.startsWith('https'));
                if (tunnel) {
                    console.log(`\x1b[35m[NGROK] Public URL: ${tunnel.public_url}\x1b[0m`);
                }
            })
            .catch(() => {});
    });

    const handleShutdown = async () => {
        logger.info('Shutting down server and disconnecting Kafka...');
        await disconnectKafka();
        process.exit(0);
    };
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);
}

export default app;
