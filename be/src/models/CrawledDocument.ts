import mongoose, { Schema, Document } from 'mongoose';

export interface ICrawledDocument extends Document {
  url: string;
  title: string;
  content: string;
  contentHash: string;
  lastCrawledAt: Date;
}

const crawledDocumentSchema: Schema = new Schema({
  url: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  contentHash: { type: String, required: true, index: true },
  lastCrawledAt: { type: Date, default: Date.now },
});

export const CrawledDocument = mongoose.model<ICrawledDocument>('CrawledDocument', crawledDocumentSchema);
