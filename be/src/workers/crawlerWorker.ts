import { Worker, Job } from 'bullmq';
import { redisConnection, crawlerQueue } from '../config/redis';
import { FetcherService } from '../services/crawler/fetcherService';
import { ParserService } from '../services/crawler/parserService';
import { LinkExtractorService } from '../services/crawler/linkExtractorService';
import { DeduplicationService } from '../services/crawler/deduplicationService';
import { StorageService } from '../services/crawler/storageService';
import { logger } from '../utils/logger';

export interface CrawlJobData {
  url: string;
  depth: number;
  maxDepth: number;
}

// Stats tracking
let stats = { crawled: 0, skipped: 0, failed: 0, enqueued: 0, inserted: 0, updated: 0 };

export function resetCrawlerStats() {
  stats = { crawled: 0, skipped: 0, failed: 0, enqueued: 0, inserted: 0, updated: 0 };
}

export function getCrawlerStats() {
  return { ...stats };
}

/**
 * Process a single crawl job:
 *  1. Check dedup → skip if already visited
 *  2. Fetch HTML
 *  3. Parse content
 *  4. Store in MongoDB (with content hash check)
 *  5. Extract links
 *  6. Enqueue new links (within depth limit)
 */
const processCrawlJob = async (job: Job<CrawlJobData>) => {
  const { url, depth, maxDepth } = job.data;

  try {
    // 1. Dedup check
    if (await DeduplicationService.isVisited(url)) {
      stats.skipped++;
      return { status: 'skipped', reason: 'already visited' };
    }

    // Mark as visited immediately to prevent duplicates from parallel workers
    await DeduplicationService.markVisited(url);

    logger.info(`[Crawler] Processing: ${url} (depth: ${depth}/${maxDepth})`);

    // 2. Fetch HTML
    const html = await FetcherService.fetch(url);
    if (!html) {
      stats.failed++;
      return { status: 'failed', reason: 'fetch failed' };
    }

    // 3. Parse content
    const parsed = ParserService.parse(html, url);
    if (parsed.content.length < 50) {
      logger.info(`[Crawler] Skipping ${url}: content too short (${parsed.content.length} chars)`);
      stats.skipped++;
      return { status: 'skipped', reason: 'content too short' };
    }

    // 4. Store in MongoDB
    const contentHash = DeduplicationService.hashContent(parsed.content);
    const storageResult = await StorageService.upsert({
      url,
      title: parsed.title,
      content: parsed.content,
      contentHash,
    });

    if (storageResult === 'inserted') stats.inserted++;
    if (storageResult === 'updated') stats.updated++;
    stats.crawled++;

    logger.info(`[Crawler] ${storageResult.toUpperCase()}: ${url} (${parsed.content.length} chars, ${parsed.headings.length} headings)`);

    // 5. Extract links and enqueue (if within depth limit)
    if (depth < maxDepth) {
      const links = LinkExtractorService.extract(html, url);
      let newLinks = 0;

      for (const link of links) {
        if (!(await DeduplicationService.isVisited(link))) {
          await crawlerQueue.add('crawl-page', {
            url: link,
            depth: depth + 1,
            maxDepth,
          } as CrawlJobData);
          newLinks++;
          stats.enqueued++;
        }
      }

      logger.info(`[Crawler] Extracted ${links.length} links, enqueued ${newLinks} new ones from ${url}`);
    } else {
      logger.info(`[Crawler] Max depth reached (${maxDepth}), not extracting links from ${url}`);
    }

    return { status: 'success', url, storageResult };

  } catch (error: any) {
    stats.failed++;
    logger.error(`[Crawler] Error processing ${url}: ${error.message}`);
    throw error; // Let BullMQ handle the retry
  }
};

/**
 * Create and start the crawler worker.
 * - concurrency: 5 means up to 5 pages processed in parallel
 * - limiter: rate-limits to max 10 jobs per 2 seconds (500ms spacing)
 */
export const crawlerWorker = new Worker('crawler', processCrawlJob, {
  connection: redisConnection,
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 2000,
  },
});

crawlerWorker.on('completed', (job) => {
  // Only log every 10th completion to reduce noise
  if (stats.crawled % 10 === 0 && stats.crawled > 0) {
    logger.info(`[Crawler] Progress — Crawled: ${stats.crawled}, Skipped: ${stats.skipped}, Failed: ${stats.failed}, Queued: ${stats.enqueued}`);
  }
});

crawlerWorker.on('failed', (job, err) => {
  logger.error(`[Crawler] Job failed for ${job?.data?.url}: ${err.message}`);
});

crawlerWorker.on('error', (err) => {
  logger.error(`[Crawler] Worker error: ${err.message}`);
});

logger.info('[Crawler] Worker initialized and ready');
