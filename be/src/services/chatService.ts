import { AIService } from './aiService';
import { VectorService, ConfidenceResult } from './vectorService';
import { LiveDocsService } from './liveDocsService';
import { MemoryService } from './memoryService';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

export class ChatService {
  /**
   * Process a chat query.
   * Decides between RAG path and live retrieval based on confidence scoring.
   */
  static async processChat(userId: string, message: string) {
    try {
      // Step 1: Classify intent + Vector search + Memory (parallel)
      const cacheKey = `chat-cache:${message.toLowerCase().trim()}`;

      const [cachedResponse, intent, confidenceResult, recentMessages] = await Promise.all([
        redisConnection.get(cacheKey),
        AIService.classifyQuery(message),
        VectorService.searchWithScores(message, 5),
        MemoryService.getRecentMessages(userId, 5),
      ]);

      // Fast path: cache hit
      if (cachedResponse) {
        logger.info('Cache hit for query');
        return { cachedResponse };
      }

      // Step 2: Fetch long-term memory only for complex queries
      const longTermSummary = intent === 'complex'
        ? await MemoryService.getLongTermSummary(userId)
        : '';

      // Step 3: Confidence-based routing
      let contextStr: string;
      let citations: { text: string; url?: string; title?: string; score?: number }[] = [];
      let source: 'rag' | 'live' | 'hybrid';

      if (confidenceResult.route === 'rag') {
        // ---- RAG PATH: vector results are good enough ----
        source = 'rag';
        citations = confidenceResult.vectorContext;
        contextStr = this.buildDocsContext(confidenceResult.vectorContext);
        logger.info(`Using RAG path (topScore: ${confidenceResult.topScore.toFixed(4)})`);

      } else {
        // ---- LIVE PATH: vector results are weak, fetch live docs ----
        logger.info(`Using LIVE path (topScore: ${confidenceResult.topScore.toFixed(4)})`);

        try {
          const liveDocs = await LiveDocsService.fetchAndParse(message);

          if (liveDocs.length > 0) {
            // Rank the live chunks by embedding similarity
            const rankedChunks = await LiveDocsService.rankChunks(message, liveDocs, 5);

            source = confidenceResult.vectorContext.length > 0 ? 'hybrid' : 'live';
            citations = rankedChunks;

            // Build context from live docs
            contextStr = "REAL-TIME SLACK DOCUMENTATION:\n";
            rankedChunks.forEach((chunk, i) => {
              contextStr += `[LiveDoc ${i + 1}] (URL: ${chunk.url}, Title: ${chunk.title}): ${chunk.text}\n`;
            });

            // Also include any RAG results we had (hybrid approach)
            if (confidenceResult.vectorContext.length > 0) {
              contextStr += "\nPRE-INDEXED DOCUMENTATION:\n";
              contextStr += this.buildDocsContext(confidenceResult.vectorContext);
            }

            // Self-learning: queue these chunks for ingestion into vector DB
            VectorService.learnFromLiveDocs(
              rankedChunks.map(c => ({ text: c.text, url: c.url, title: c.title }))
            );

          } else {
            // Live fetch returned nothing — use whatever RAG had + fallback
            source = 'rag';
            citations = confidenceResult.vectorContext;
            contextStr = this.buildDocsContext(confidenceResult.vectorContext);
          }

        } catch (liveError: any) {
          logger.error(`Live docs fetch failed: ${liveError.message}`);
          // Fallback to whatever RAG had
          source = 'rag';
          citations = confidenceResult.vectorContext;
          contextStr = this.buildDocsContext(confidenceResult.vectorContext);
        }
      }

      // Step 4: Build full prompt
      const systemInstruction = source === 'live'
        ? 'You must answer ONLY from the provided real-time documentation. If the answer is not in the provided documentation, say "I couldn\'t find this information in the current Slack documentation."'
        : 'You are an assistant that answers strictly from Slack documentation. If the answer is not in the context, say "I don\'t know based on docs."';

      let promptBuilder = `SYSTEM: ${systemInstruction}\n\nCONTEXT:\n${contextStr}\n`;

      if (longTermSummary) {
        promptBuilder += `\nUSER LONG TERM SUMMARY: ${longTermSummary}\n`;
      }

      if (intent !== 'simple' && recentMessages.length > 0) {
        promptBuilder += "\nRECENT CONVERSATION:\n";
        recentMessages.forEach((msg: any) => {
          promptBuilder += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
        });
      }

      promptBuilder += `\nUSER: ${message}`;

      // Step 5: LLM Response (Streaming)
      const stream = await AIService.getStreamingResponse(promptBuilder);

      return { stream, contextChunks: citations, source };

    } catch (error: any) {
      logger.error(`Error in ChatService.processChat: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build a docs context string from scored vector results
   */
  private static buildDocsContext(docs: { text: string; metadata?: any; score?: number }[]): string {
    let ctx = "";
    docs.forEach((doc, i) => {
      const url = doc.metadata?.url || 'N/A';
      ctx += `[Doc ${i + 1}] (URL: ${url}): ${doc.text}\n`;
    });
    return ctx;
  }
}
