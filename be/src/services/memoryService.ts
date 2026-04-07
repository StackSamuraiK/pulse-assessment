import { Conversation, type IMessage } from '../models/Conversation';
import { Memory } from '../models/Memory';
import { logger } from '../utils/logger';
import { memoryQueue } from '../config/redis';

export class MemoryService {
  /**
   * Fetch recent messages
   */
  static async getRecentMessages(userId: string, limit: number = 5): Promise<IMessage[]> {
    try {
      const convo = await Conversation.findOne({ userId });
      if (!convo || !convo.messages) return [];
      
      // Get the last N messages
      return convo.messages.slice(-limit);
    } catch (error: any) {
      logger.error(`Error fetching recent messages: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch long-term memory summary
   */
  static async getLongTermSummary(userId: string): Promise<string> {
    try {
      const memory = await Memory.findOne({ userId });
      return memory?.summary || '';
    } catch (error: any) {
      logger.error(`Error fetching long-term memory: ${error.message}`);
      return '';
    }
  }

  /**
   * Save messages to Conversation and enqueue summarization job
   */
  static async saveInteraction(userId: string, userMessage: string, assistantMessage: string) {
    try {
      await Conversation.findOneAndUpdate(
        { userId },
        { 
          $push: { 
            messages: { 
              $each: [
                { role: 'user', content: userMessage, timestamp: new Date() },
                { role: 'assistant', content: assistantMessage, timestamp: new Date() }
              ] 
            } 
          },
          $set: { updatedAt: new Date() }
        },
        { upsert: true, new: true }
      );

      // Enqueue job to update long-term memory asynchronously
      await memoryQueue.add('summarize-memory', { userId });
      
    } catch (error: any) {
      logger.error(`Error saving interaction: ${error.message}`);
    }
  }
}
