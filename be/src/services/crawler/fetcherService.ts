import { logger } from '../../utils/logger';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 1000;

export class FetcherService {
  /**
   * Fetch a URL with retries, timeout, and proper error handling.
   * Returns raw HTML string or null on failure.
   */
  static async fetch(url: string): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SlackDocsCrawler/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          logger.warn(`[Fetcher] HTTP ${response.status} for ${url} (attempt ${attempt}/${MAX_RETRIES})`);

          // Don't retry 4xx errors (except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            return null;
          }

          // Rate limited — wait longer
          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
            await this.delay(retryAfter * 1000);
            continue;
          }

          if (attempt < MAX_RETRIES) {
            await this.delay(RETRY_DELAY_MS * attempt);
            continue;
          }
          return null;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
          logger.info(`[Fetcher] Skipping non-HTML content at ${url}: ${contentType}`);
          return null;
        }

        return await response.text();

      } catch (error: any) {
        logger.warn(`[Fetcher] Error fetching ${url} (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * attempt);
        }
      }
    }

    logger.error(`[Fetcher] Failed to fetch ${url} after ${MAX_RETRIES} attempts`);
    return null;
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
