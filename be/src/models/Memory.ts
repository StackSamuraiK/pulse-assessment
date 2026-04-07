import mongoose, { Schema, Document } from 'mongoose';

export interface IMemory extends Document {
  userId: string;
  summary: string;
  updatedAt: Date;
}

const memorySchema: Schema = new Schema({
  userId: { type: String, required: true, unique: true },
  summary: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

export const Memory = mongoose.model<IMemory>('Memory', memorySchema);
