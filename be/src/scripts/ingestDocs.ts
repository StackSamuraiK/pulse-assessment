import 'dotenv/config';
import mongoose from 'mongoose';
import { DocumentChunk } from '../models/DocumentChunk';
import { AIService } from '../services/aiService';
import { logger } from '../utils/logger';

// Example simplified Slack documentation
const MOCK_DOCS = [
  {
    text: 'Slack provides a Web API that is a collection of HTTP RPC-style methods. You can use it to build bots, apps, and custom integrations. To authenticate, include a Bearer token in the Authorization header.',
    metadata: { url: 'https://api.slack.com/web', title: 'Web API Basics' }
  },
  {
    text: 'Events API allows you to subscribe to events in Slack, like when a message is posted or a channel is created. Your app must provide a Request URL that responds to a challenge request to verify ownership.',
    metadata: { url: 'https://api.slack.com/events-api', title: 'Events API Overview' }
  },
  {
    text: 'Block Kit is a UI framework for Slack apps that offers a balance of control and flexibility when building experiences. You use blocks like Section, Divider, Image, and Actions to build rich messages.',
    metadata: { url: 'https://api.slack.com/block-kit', title: 'Block Kit Introduction' }
  }
];

const ingestDocs = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    logger.info('Connected to MongoDB');

    // Create chunks and generate embeddings
    for (const doc of MOCK_DOCS) {
      const embedding = await AIService.generateEmbedding(doc.text);

      const chunk = new DocumentChunk({
        text: doc.text,
        embedding: embedding,
        metadata: doc.metadata
      });

      await chunk.save();
      logger.info(`Saved document chunk: ${doc.metadata.title}`);
    }

    logger.info('Finished ingesting documents.');
    process.exit(0);

  } catch (error: any) {
    logger.error('Error ingesting documents:', error.message);
    process.exit(1);
  }
};

ingestDocs();
