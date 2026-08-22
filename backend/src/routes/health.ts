import { Router } from 'express';
import { redisCache } from '../cache/redisClient';
import { checkDatabase } from '../db/database';

const router = Router();

router.get('/health', async (_req, res) => {
  const [redisStatus, databaseStatus] = await Promise.all([Promise.resolve(redisCache.getStatus()), checkDatabase()]);
  res.status(200).json({
    status: 'ok',
    service: 'backend-api',
    uptime: process.uptime(),
    redis: redisStatus,
    database: databaseStatus,
    timestamp: new Date().toISOString(),
  });
});

export default router;
