import { FetcherService } from './crawler/fetcherService';
import { ParserService } from './crawler/parserService';
import { LinkExtractorService } from './crawler/linkExtractorService';
import { DeduplicationService } from './crawler/deduplicationService';
import { StorageService } from './crawler/storageService';
import { AIService } from './aiService';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

const SLACK_DOCS_BASE = 'https://docs.slack.dev';
const PARSED_CACHE_TTL = 21600; // 6 hours

/**
 * Known Slack doc paths mapped to keywords for fast URL resolution.
 */
const DOC_PATH_MAP: Record<string, string[]> = {
  '/apis/web-api': ['web api', 'api call', 'http', 'rest api', 'api method'],
  '/apis/events-api': ['events', 'event subscription', 'event api', 'subscribe'],
  '/block-kit': ['block kit', 'blocks', 'rich message', 'interactive message', 'ui framework'],
  '/surfaces/messages': ['message', 'send message', 'post message', 'chat.postmessage'],
  '/surfaces/modals': ['modal', 'dialog', 'popup', 'view'],
  '/surfaces/app-home': ['app home', 'home tab'],
  '/interactivity': ['interactivity', 'interactive', 'button', 'action', 'shortcut'],
  '/workflows': ['workflow', 'workflow builder', 'automation'],
  '/apis/connections/socket-mode': ['socket mode', 'socket', 'websocket'],
  '/bolt': ['bolt', 'bolt framework', 'bolt js', 'bolt python'],
  '/authentication': ['oauth', 'authentication', 'auth', 'token', 'scopes', 'permissions'],
  '/messaging/webhooks': ['webhook', 'incoming webhook'],
  '/reference/slash-commands': ['slash command', 'command'],
};

export interface ParsedDocContent {
  url: string;
  title: string;
  chunks: string[];
}

export class LiveDocsService {

  /**
   * Resolve a user query to the most relevant Slack doc URL(s).
   */
  static resolveDocUrls(query: string): string[] {
    const q = query.toLowerCase();
    const matches: { path: string; score: number }[] = [];

    for (const [path, keywords] of Object.entries(DOC_PATH_MAP)) {
      let score = 0;
      for (const kw of keywords) {
        if (q.includes(kw)) score += kw.split(' ').length;
      }
      if (score > 0) matches.push({ path, score });
    }

    matches.sort((a, b) => b.score - a.score);
    const urls = matches.slice(0, 2).map(m => `${SLACK_DOCS_BASE}${m.path}`);

    if (urls.length === 0) {
      urls.push(`${SLACK_DOCS_BASE}/apis/web-api`);
    }

    return urls;
  }

  /**
   * Chunk text into pieces of roughly 200-400 tokens (~800-1600 chars).
   */
  static chunkText(text: string, maxChars: number = 1200): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/(?:\. |\n)+/).filter(p => p.trim().length > 30);

    let current = '';
    for (const para of paragraphs) {
      if ((current + ' ' + para).length > maxChars && current.length > 0) {
        chunks.push(current.trim());
        current = para;
      } else {
        current += ' ' + para;
      }
    }
    if (current.trim().length > 30) {
      chunks.push(current.trim());
    }

    if (chunks.length === 0 && text.length > 0) {
      for (let i = 0; i < text.length; i += maxChars) {
        chunks.push(text.slice(i, i + maxChars).trim());
      }
    }

    return chunks;
  }

  /**
   * Full on-demand pipeline triggered when RAG confidence is low:
   *  1. Resolve query → target doc URLs
   *  2. Fetch pages using crawler's FetcherService (retries, timeouts)
   *  3. Parse using crawler's ParserService (Cheerio, content cleaning)
   *  4. Optionally crawl 1-level deep (linked pages within the same doc section)
   *  5. Store crawled pages in MongoDB via StorageService (for future RAG hits)
   *  6. Chunk and return content for immediate LLM use
   */
  static async fetchAndParse(query: string): Promise<ParsedDocContent[]> {
    try {
      // Cache check
      const cacheKey = `parsed-docs:${query.toLowerCase().trim()}`;
      const cached = await redisConnection.get(cacheKey);
      if (cached) {
        logger.info('[LiveDocs] Parsed docs cache hit');
        return JSON.parse(cached);
      }

      const urls = this.resolveDocUrls(query);
      logger.info(`[LiveDocs] Resolving query to URLs: ${JSON.stringify(urls)}`);

      // Step 1: Fetch all target pages in parallel using the robust FetcherService
      const htmlResults = await Promise.all(urls.map(url => FetcherService.fetch(url)));

      const results: ParsedDocContent[] = [];
      const childUrls: string[] = [];

      for (let i = 0; i < urls.length; i++) {
        const html = htmlResults[i];
        if (!html) continue;

        // Step 2: Parse with crawler's ParserService
        const parsed = ParserService.parse(html, urls[i]);
        if (parsed.content.length < 50) continue;

        const chunks = this.chunkText(parsed.content);
        results.push({ url: urls[i], title: parsed.title, chunks });

        // Step 3: Store in MongoDB for future RAG (self-learning)
        const contentHash = DeduplicationService.hashContent(parsed.content);
        StorageService.upsert({
          url: urls[i],
          title: parsed.title,
          content: parsed.content,
          contentHash,
        }).then(result => {
          logger.info(`[LiveDocs] Stored page: ${urls[i]} (${result})`);
        }).catch(() => {}); // fire-and-forget, don't block response

        // Step 4: Extract child links for 1-level deep crawl
        const links = LinkExtractorService.extract(html, urls[i]);
        // Only take first 3 child links to keep latency low
        childUrls.push(...links.slice(0, 3));
      }

      // Step 5: Fetch child pages in parallel (1 level deep, lightweight)
      if (childUrls.length > 0) {
        const uniqueChildren = [...new Set(childUrls)].slice(0, 5);
        logger.info(`[LiveDocs] Crawling ${uniqueChildren.length} child pages 1-level deep`);

        const childHtmlResults = await Promise.all(uniqueChildren.map(u => FetcherService.fetch(u)));

        for (let i = 0; i < uniqueChildren.length; i++) {
          const html = childHtmlResults[i];
          if (!html) continue;

          const parsed = ParserService.parse(html, uniqueChildren[i]);
          if (parsed.content.length < 50) continue;

          const chunks = this.chunkText(parsed.content);
          results.push({ url: uniqueChildren[i], title: parsed.title, chunks });

          // Store child pages too
          const contentHash = DeduplicationService.hashContent(parsed.content);
          StorageService.upsert({
            url: uniqueChildren[i],
            title: parsed.title,
            content: parsed.content,
            contentHash,
          }).catch(() => {}); // fire-and-forget
        }
      }

      // Cache the parsed results
      if (results.length > 0) {
        await redisConnection.set(cacheKey, JSON.stringify(results), 'EX', PARSED_CACHE_TTL);
      }

      logger.info(`[LiveDocs] Fetched ${results.length} pages, total chunks: ${results.reduce((s, r) => s + r.chunks.length, 0)}`);
      return results;

    } catch (error: any) {
      logger.error(`[LiveDocs] Fetch error: ${error.message}`);
      return [];
    }
  }

  /**
   * Rank chunks by embedding similarity to select the most relevant ones.
   */
  static async rankChunks(
    query: string,
    docs: ParsedDocContent[],
    topK: number = 5
  ): Promise<{ text: string; url: string; title: string; score: number }[]> {
    const queryEmbedding = await AIService.generateEmbedding(query);

    const allChunks = docs.flatMap(doc =>
      doc.chunks.map(chunk => ({ text: chunk, url: doc.url, title: doc.title }))
    );

    // Limit to 20 chunks to control embedding API cost
    const toEmbed = allChunks.slice(0, 20);
    const scored: { text: string; url: string; title: string; score: number }[] = [];
    const batchSize = 5;

    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map(c => AIService.generateEmbedding(c.text)));

      for (let j = 0; j < batch.length; j++) {
        const sim = cosineSim(queryEmbedding, embeddings[j]);
        scored.push({ ...batch[j], score: sim });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
