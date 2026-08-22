"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const redisClient_1 = require("../cache/redisClient");
const database_1 = require("../db/database");
const router = (0, express_1.Router)();
router.get('/health', async (_req, res) => {
    const [redisStatus, databaseStatus] = await Promise.all([Promise.resolve(redisClient_1.redisCache.getStatus()), (0, database_1.checkDatabase)()]);
    res.status(200).json({
        status: 'ok',
        service: 'backend-api',
        uptime: process.uptime(),
        redis: redisStatus,
        database: databaseStatus,
        timestamp: new Date().toISOString(),
    });
});
exports.default = router;
