import crypto from 'crypto';
import { redisConnection } from '../../config/redis';
import { CrawledDocument } from '../../models/CrawledDocument';
import { logger } from '../../utils/logger';

const VISITED_SET_KEY = 'crawler:visited_urls';

export class DeduplicationService {
  /**
   * Check if a URL has already been visited in this crawl session.
   * Uses a Redis SET for O(1) lookups.
   */
  static async isVisited(url: string): Promise<boolean> {
    const result = await redisConnection.sismember(VISITED_SET_KEY, url);
    return result === 1;
  }

  /**
   * Mark a URL as visited.
   */
  static async markVisited(url: string): Promise<void> {
    await redisConnection.sadd(VISITED_SET_KEY, url);
  }

  /**
   * Get total count of visited URLs.
   */
  static async getVisitedCount(): Promise<number> {
    return await redisConnection.scard(VISITED_SET_KEY);
  }

  /**
   * Clear the visited set (for a fresh crawl).
   */
  static async resetVisited(): Promise<void> {
    await redisConnection.del(VISITED_SET_KEY);
  }

  /**
   * Generate a SHA256 hash of content for change detection.
   */
  static hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if content has changed since last crawl.
   * Returns true if the page should be updated (new or changed).
   */
  static async shouldUpdate(url: string, contentHash: string): Promise<boolean> {
    try {
      const existing = await CrawledDocument.findOne({ url }, { contentHash: 1 }).lean();
      if (!existing) return true; // new page
      return existing.contentHash !== contentHash; // changed content
    } catch (error: any) {
      logger.error(`[Dedup] Error checking ${url}: ${error.message}`);
      return true; // err on the side of updating
    }
  }
}
