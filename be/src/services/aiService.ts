import { logger } from '../utils/logger';

let aiInstance: any = null;

async function getAI() {
  if (!aiInstance) {
    const { GoogleGenAI } = await import('@google/genai');
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return aiInstance;
}

export class AIService {
  
  /**
   * Generates embedding for a given text
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    try {
      const ai = await getAI();
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      });
      return response.embeddings?.[0]?.values || [];
    } catch (error: any) {
      logger.error(`Error generating embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets a streaming response from Gemini for RAG
   */
  static async getStreamingResponse(prompt: string) {
    try {
      const ai = await getAI();
      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: 0.3,
        }
      });
      return responseStream;
    } catch (error: any) {
      logger.error(`Error generating LLM response: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper to quickly classify query intent
   */
  static async classifyQuery(query: string): Promise<'simple' | 'follow_up' | 'complex'> {
    const prompt = `Classify this user query into one of three categories: "simple", "follow_up", or "complex".
- "simple": A direct question that doesn't rely on past conversation context.
- "follow_up": A question that clearly refers to something just discussed.
- "complex": A multi-part question or a question that requires deep reasoning over lots of context.
Only output the category name.

Query: "${query}"`;
    
    try {
      const ai = await getAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          temperature: 0.1,
          maxOutputTokens: 10
        }
      });
      
      const result = response.text?.trim().toLowerCase() || 'simple';
      if (['simple', 'follow_up', 'complex'].includes(result)) {
        return result as 'simple' | 'follow_up' | 'complex';
      }
      return 'simple';
    } catch (error: any) {
      logger.error(`Classification error: ${error.message}`);
      return 'simple';
    }
  }
}
