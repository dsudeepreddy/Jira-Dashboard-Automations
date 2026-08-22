"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = require("express-rate-limit");
const env_1 = require("./config/env");
const jiraClient_1 = require("./services/jiraClient");
const metricsController_1 = require("./controllers/metricsController");
const syncController_1 = require("./controllers/syncController");
const database_1 = require("./db/database");
const database_2 = require("./db/database");
const health_1 = __importDefault(require("./routes/health"));
const errorHandler_1 = require("./middleware/errorHandler");
const observability_1 = require("./middleware/observability");
const app = (0, express_1.default)();
app.use(observability_1.requestContext);
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));
app.use((0, cors_1.default)({ origin: env_1.env.CORS_ORIGIN.split(',') }));
app.use(express_1.default.json({ limit: '1mb' }));
const limiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
app.get('/api/v1/health', async (_req, res) => {
    const database = await (0, database_2.checkDatabase)();
    res.json({
        status: 'ok',
        service: 'backend-api',
        timestamp: new Date().toISOString(),
        jira: jiraClient_1.jiraDiagnostics,
        database,
    });
});
app.use('/api/v1', health_1.default);
app.get('/api/v1/metrics', metricsController_1.getMetricsHandler);
app.post('/api/v1/sync', syncController_1.syncJiraHandler);
app.get('/api/v1/observability/metrics', (_req, res) => {
    res.type('text/plain').send((0, observability_1.metricsText)());
});
app.get('/api/v1/projects', async (_req, res) => {
    const projects = await (await Promise.resolve().then(() => __importStar(require('./services/jiraClient')))).jiraClient.getProjects();
    res.json(projects);
});
app.use(errorHandler_1.errorHandler);
async function start() {
    await (0, database_1.initializeDatabase)();
    app.listen(env_1.env.PORT, () => {
        console.log(JSON.stringify({ event: 'server_started', service: 'backend-api', port: env_1.env.PORT, database: env_1.env.DB_ENABLED ? 'percona' : 'disabled' }));
    });
}
start().catch((error) => {
    console.error(JSON.stringify({ event: 'server_start_failed', error: error instanceof Error ? error.message : 'unknown' }));
    process.exit(1);
});
