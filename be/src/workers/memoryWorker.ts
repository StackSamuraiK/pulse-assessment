import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { Memory } from '../models/Memory';
import { Conversation } from '../models/Conversation';
import { DocumentChunk } from '../models/DocumentChunk';
import { logger } from '../utils/logger';

let aiInstance: any = null;

async function getAI() {
  if (!aiInstance) {
    const { GoogleGenAI } = await import('@google/genai');
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return aiInstance;
}

/**
 * Processes all job types on the memory-processing queue:
 *   - "summarize-memory": Summarize recent conversation into long-term memory
 *   - "ingest-live-chunks": Self-learning — embed and store live-fetched doc chunks
 */
const processJob = async (job: Job) => {
  switch (job.name) {
    case 'summarize-memory':
      return processSummarizeMemory(job);
    case 'ingest-live-chunks':
      return processIngestLiveChunks(job);
    default:
      logger.warn(`Unknown job name: ${job.name}`);
  }
};

/**
 * Summarize recent conversation into long-term memory
 */
const processSummarizeMemory = async (job: Job) => {
  const { userId } = job.data;

  try {
    const convo = await Conversation.findOne({ userId });
    if (!convo || convo.messages.length === 0) return;

    const memory = await Memory.findOne({ userId });
    const existingSummary = memory?.summary || '';

    const recentMessages = convo.messages.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n');

    const prompt = `
Update the conversation summary for the user based on these recent interactions. 
If there's an existing summary, extend or modify it briefly. Keep the total summary concise.

EXISTING SUMMARY:
${existingSummary}

RECENT CONVERSATION:
${recentMessages}

Provide only the updated summary.`;

    const ai = await getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { temperature: 0.2 }
    });

    const newSummary = response.text?.trim() || existingSummary;

    await Memory.findOneAndUpdate(
      { userId },
      { summary: newSummary, updatedAt: new Date() },
      { upsert: true }
    );

    logger.info(`Memory updated for user ${userId}`);

  } catch (error: any) {
    logger.error(`Error in summarize-memory for ${userId}: ${error.message}`);
    throw error;
  }
};

/**
 * Self-learning: embed and store live-fetched documentation chunks into the vector DB
 * so future queries can use the fast RAG path instead of live fetching.
 */
const processIngestLiveChunks = async (job: Job) => {
  const { chunks } = job.data as { chunks: { text: string; url: string; title: string }[] };

  try {
    let ingested = 0;

    for (const chunk of chunks) {
      // Check if we already have this exact text (dedup)
      const existing = await DocumentChunk.findOne({ text: chunk.text });
      if (existing) {
        logger.info(`Skipping duplicate chunk from ${chunk.url}`);
        continue;
      }

      // Generate embedding
      const ai = await getAI();
      const embedding = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: chunk.text,
      });

      const values = embedding.embeddings?.[0]?.values;
      if (!values || values.length === 0) continue;

      // Store in DocumentChunk collection
      await DocumentChunk.create({
        text: chunk.text,
        embedding: values,
        metadata: { url: chunk.url, title: chunk.title },
      });

      ingested++;
    }

    logger.info(`Self-learning: ingested ${ingested}/${chunks.length} live doc chunks into vector DB`);

  } catch (error: any) {
    logger.error(`Error in ingest-live-chunks: ${error.message}`);
    throw error;
  }
};

export const memoryWorker = new Worker('memory-processing', processJob, {
  connection: redisConnection
});

memoryWorker.on('completed', job => {
  logger.info(`Job ${job.id} (${job.name}) completed successfully`);
});

memoryWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} (${job?.name}) failed: ${err.message}`);
});
