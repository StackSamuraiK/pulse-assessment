import mongoose, { Schema, Document } from 'mongoose';

export interface IDocumentChunk extends Document {
  text: string;
  embedding: number[];
  metadata: {
    url?: string;
    title?: string;
  };
}

const documentChunkSchema: Schema = new Schema({
  text: { type: String, required: true },
  embedding: { type: [Number], required: true },
  metadata: {
    url: String,
    title: String,
  }
});

// Defining a vector search index for this collection using MongoDB Atlas is usually done via the Atlas UI or Atlas Search API.
// We will query it via an aggregation pipeline later.

export const DocumentChunk = mongoose.model<IDocumentChunk>('DocumentChunk', documentChunkSchema);
