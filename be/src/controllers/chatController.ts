import { Request, Response } from 'express';
import { z } from 'zod';
import { ChatService } from '../services/chatService';
import { MemoryService } from '../services/memoryService';
import { Conversation } from '../models/Conversation';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

const chatSchema = z.object({
  userId: z.string().min(1),
  message: z.string().min(1),
});

const RESPONSE_CACHE_TTL = 3600; // 1 hour

export const handleChat = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = chatSchema.parse(req.body);
    const { userId, message } = validatedData;

    const result = await ChatService.processChat(userId, message);

    if (result.cachedResponse) {
      res.json({ response: result.cachedResponse, source: 'cache' });
      return;
    }

    // Prepare for streaming response (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullResponse = '';

    if (result.stream) {
      for await (const chunk of result.stream) {
        const chunkText = chunk.text || "";
        fullResponse += chunkText;
        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
      }
    }

    // Save interaction + trigger async memory summarization
    await MemoryService.saveInteraction(userId, message, fullResponse);

    // Cache the full response for future identical queries
    const cacheKey = `chat-cache:${message.toLowerCase().trim()}`;
    await redisConnection.set(cacheKey, fullResponse, 'EX', RESPONSE_CACHE_TTL);

    // Send final event with metadata
    res.write(`data: ${JSON.stringify({
      done: true,
      source: result.source || 'rag',
      citations: result.contextChunks,
    })}\n\n`);
    res.end();

  } catch (error: any) {
    logger.error(`Error in chat controller: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Internal Server Error' })}\n\n`);
      res.end();
    }
  }
};

export const getHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const convo = await Conversation.findOne({ userId });
    res.json({ messages: convo?.messages || [] });
  } catch (error: any) {
    logger.error(`Error fetching history: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
