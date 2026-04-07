import { Request, Response } from 'express';
import { crawlerQueue } from '../config/redis';
import { DeduplicationService } from '../services/crawler/deduplicationService';
import { StorageService } from '../services/crawler/storageService';
import { getCrawlerStats, resetCrawlerStats, CrawlJobData } from '../workers/crawlerWorker';
import { logger } from '../utils/logger';

const DEFAULT_ROOT_URL = 'https://docs.slack.dev';
const DEFAULT_MAX_DEPTH = 3;

/**
 * POST /api/crawler/start
 * Body (optional): { rootUrl?: string, maxDepth?: number, reset?: boolean }
 * 
 * Starts a crawl from the root URL. Optionally reset visited set for a fresh crawl.
 */
export const startCrawl = async (req: Request, res: Response): Promise<void> => {
  try {
    const rootUrl = req.body.rootUrl || DEFAULT_ROOT_URL;
    const maxDepth = req.body.maxDepth || DEFAULT_MAX_DEPTH;
    const reset = req.body.reset || false;

    if (reset) {
      await DeduplicationService.resetVisited();
      resetCrawlerStats();
      logger.info('[Crawler] Reset visited URLs and stats');
    }

    // Check if root URL is already visited (crawl might be in progress)
    if (await DeduplicationService.isVisited(rootUrl)) {
      res.json({
        message: 'Crawl already in progress or completed for this URL. Set reset=true to start fresh.',
        stats: getCrawlerStats(),
      });
      return;
    }

    // Enqueue the seed job
    await crawlerQueue.add('crawl-page', {
      url: rootUrl,
      depth: 0,
      maxDepth,
    } as CrawlJobData);

    logger.info(`[Crawler] Started crawl from ${rootUrl} with maxDepth=${maxDepth}`);

    res.json({
      message: 'Crawl started',
      rootUrl,
      maxDepth,
    });
  } catch (error: any) {
    logger.error(`[Crawler] Error starting crawl: ${error.message}`);
    res.status(500).json({ error: 'Failed to start crawl' });
  }
};

/**
 * GET /api/crawler/status
 * Returns current crawl stats and queue health.
 */
export const getCrawlStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const [visitedCount, documentCount, queueCounts] = await Promise.all([
      DeduplicationService.getVisitedCount(),
      StorageService.getDocumentCount(),
      crawlerQueue.getJobCounts(),
    ]);

    res.json({
      stats: getCrawlerStats(),
      visitedUrls: visitedCount,
      storedDocuments: documentCount,
      queue: queueCounts,
    });
  } catch (error: any) {
    logger.error(`[Crawler] Error getting status: ${error.message}`);
    res.status(500).json({ error: 'Failed to get crawler status' });
  }
};
