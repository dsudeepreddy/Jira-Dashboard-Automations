import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';
import { env } from '../config/env';

const lru = new LRUCache<string, any>({ max: 500, ttl: env.CACHE_TTL_MS });

export class RedisCacheClient {
  private client: Redis | null = null;
  private lastError: string | null = null;

  constructor() {
    this.connect();
  }

  private connect() {
    try {
      this.client = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        reconnectOnError: (err) => {
          const msg = err.message || String(err);
          this.lastError = msg;
          return msg.includes('ECONNRESET');
        },
      });

      this.client.on('connect', () => {
        this.lastError = null;
      });

      this.client.on('error', (err) => {
        this.lastError = err.message || String(err);
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'redis init failed';
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const local = lru.get(key) as T | undefined;
    if (local !== undefined) return local;

    if (!this.client) return null;

    try {
      const value = await this.client.get(key);
      if (!value) return null;
      const parsed = JSON.parse(value) as T;
      lru.set(key, parsed, { ttl: env.CACHE_TTL_MS });
      return parsed;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs = env.CACHE_TTL_MS) {
    lru.set(key, value, { ttl: ttlMs });
    if (!this.client) return;

    try {
      await this.client.set(key, JSON.stringify(value), 'PX', ttlMs);
    } catch {
      // fallback to in-memory only
    }
  }

  async del(key: string) {
    lru.delete(key);
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch {
      // no-op
    }
  }

  getStatus() {
    return {
      redisConnected: !!this.client && this.client.status === 'ready',
      fallbackMode: !this.client || this.client.status !== 'ready',
      lastError: this.lastError,
    };
  }
}

export const redisCache = new RedisCacheClient();
