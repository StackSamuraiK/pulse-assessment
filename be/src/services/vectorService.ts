import { DocumentChunk } from '../models/DocumentChunk';
import { AIService } from './aiService';
import { memoryQueue } from '../config/redis';
import { logger } from '../utils/logger';

const CONFIDENCE_THRESHOLD = 0.7;

export interface ConfidenceResult {
  route: 'rag' | 'live';
  topScore: number;
  vectorContext: { text: string; metadata: any; score: number }[];
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class VectorService {
  /**
   * Search for closest documents and return results WITH scores.
   * Used by confidence router to decide RAG vs live retrieval.
   */
  static async searchWithScores(query: string, limit: number = 3): Promise<ConfidenceResult> {
    try {
      const queryEmbedding = await AIService.generateEmbedding(query);

      let results: { text: string; metadata: any; score: number }[] = [];

      // --- Attempt 1: Atlas $vectorSearch ---
      try {
        const atlasResults = await DocumentChunk.aggregate([
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 5,
              limit: limit
            }
          },
          {
            $project: {
              _id: 0,
              text: 1,
              metadata: 1,
              score: { $meta: 'vectorSearchScore' }
            }
          }
        ]);

        if (atlasResults.length > 0) {
          logger.info(`Atlas vector search returned ${atlasResults.length} results`);
          results = atlasResults;
        }
      } catch {
        logger.warn('Atlas $vectorSearch unavailable, falling back to in-memory cosine similarity');
      }

      // --- Attempt 2: In-memory cosine similarity fallback ---
      if (results.length === 0) {
        const allChunks = await DocumentChunk.find({}, { text: 1, embedding: 1, metadata: 1 }).lean();

        const scored = allChunks.map(chunk => ({
          text: chunk.text,
          metadata: chunk.metadata,
          score: cosineSimilarity(queryEmbedding, chunk.embedding),
        }));

        scored.sort((a, b) => b.score - a.score);
        results = scored.slice(0, limit);
      }

      const topScore = results[0]?.score ?? 0;
      const route = topScore >= CONFIDENCE_THRESHOLD ? 'rag' : 'live';

      logger.info(`Confidence router: topScore=${topScore.toFixed(4)}, threshold=${CONFIDENCE_THRESHOLD}, route=${route}`);

      return { route, topScore, vectorContext: results };

    } catch (error: any) {
      logger.error(`Vector search error: ${error.message}`);
      return { route: 'live', topScore: 0, vectorContext: [] };
    }
  }

  /**
   * Original simple search (kept for backward compat)
   */
  static async search(query: string, limit: number = 3) {
    const result = await this.searchWithScores(query, limit);
    return result.vectorContext;
  }

  /**
   * Self-learning: store new chunks into the vector DB so future queries are faster.
   * Enqueues a background job to avoid blocking the request.
   */
  static async learnFromLiveDocs(chunks: { text: string; url: string; title: string }[]) {
    try {
      await memoryQueue.add('ingest-live-chunks', { chunks });
      logger.info(`Enqueued ${chunks.length} live doc chunks for self-learning ingestion`);
    } catch (error: any) {
      logger.error(`Error enqueueing live doc chunks: ${error.message}`);
    }
  }
}
