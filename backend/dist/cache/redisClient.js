"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisCache = exports.RedisCacheClient = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const lru_cache_1 = require("lru-cache");
const env_1 = require("../config/env");
const lru = new lru_cache_1.LRUCache({ max: 500, ttl: env_1.env.CACHE_TTL_MS });
class RedisCacheClient {
    client = null;
    lastError = null;
    constructor() {
        this.connect();
    }
    connect() {
        try {
            this.client = new ioredis_1.default({
                host: env_1.env.REDIS_HOST,
                port: env_1.env.REDIS_PORT,
                password: env_1.env.REDIS_PASSWORD || undefined,
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
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : 'redis init failed';
        }
    }
    async get(key) {
        const local = lru.get(key);
        if (local !== undefined)
            return local;
        if (!this.client)
            return null;
        try {
            const value = await this.client.get(key);
            if (!value)
                return null;
            const parsed = JSON.parse(value);
            lru.set(key, parsed, { ttl: env_1.env.CACHE_TTL_MS });
            return parsed;
        }
        catch {
            return null;
        }
    }
    async set(key, value, ttlMs = env_1.env.CACHE_TTL_MS) {
        lru.set(key, value, { ttl: ttlMs });
        if (!this.client)
            return;
        try {
            await this.client.set(key, JSON.stringify(value), 'PX', ttlMs);
        }
        catch {
            // fallback to in-memory only
        }
    }
    async del(key) {
        lru.delete(key);
        if (!this.client)
            return;
        try {
            await this.client.del(key);
        }
        catch {
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
exports.RedisCacheClient = RedisCacheClient;
exports.redisCache = new RedisCacheClient();
