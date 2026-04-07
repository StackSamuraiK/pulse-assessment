import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { logger } from '../utils/logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (err:any) => {
  logger.error(`Redis connection error: ${err}`);
});

redisConnection.on('connect', () => {
  logger.info('Redis connected successfully');
});

// Create our BullMQ queues for background tasks
export const memoryQueue = new Queue('memory-processing', { 
  connection: redisConnection 
});

export const crawlerQueue = new Queue('crawler', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
