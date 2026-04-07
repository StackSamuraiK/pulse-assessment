import { CrawledDocument } from '../../models/CrawledDocument';
import { logger } from '../../utils/logger';

export interface StorageDoc {
  url: string;
  title: string;
  content: string;
  contentHash: string;
}

export class StorageService {
  /**
   * Upsert a crawled page — insert if new, update if content changed.
   */
  static async upsert(doc: StorageDoc): Promise<'inserted' | 'updated' | 'skipped'> {
    try {
      const existing = await CrawledDocument.findOne({ url: doc.url });

      if (!existing) {
        await CrawledDocument.create({
          url: doc.url,
          title: doc.title,
          content: doc.content,
          contentHash: doc.contentHash,
          lastCrawledAt: new Date(),
        });
        return 'inserted';
      }

      if (existing.contentHash !== doc.contentHash) {
        existing.title = doc.title;
        existing.content = doc.content;
        existing.contentHash = doc.contentHash;
        existing.lastCrawledAt = new Date();
        await existing.save();
        return 'updated';
      }

      return 'skipped';
    } catch (error: any) {
      logger.error(`[Storage] Error upserting ${doc.url}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Batch upsert multiple documents.
   */
  static async batchUpsert(docs: StorageDoc[]): Promise<{ inserted: number; updated: number; skipped: number }> {
    const counts = { inserted: 0, updated: 0, skipped: 0 };

    for (const doc of docs) {
      try {
        const result = await this.upsert(doc);
        counts[result]++;
      } catch {
        // Individual errors are logged inside upsert
      }
    }

    return counts;
  }

  /**
   * Get total document count.
   */
  static async getDocumentCount(): Promise<number> {
    return await CrawledDocument.countDocuments();
  }
}
