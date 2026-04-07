import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface IConversation extends Document {
  userId: string;
  messages: IMessage[];
  updatedAt: Date;
}

const messageSchema: Schema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema: Schema = new Schema({
  userId: { type: String, required: true, unique: true },
  messages: [messageSchema],
  updatedAt: { type: Date, default: Date.now },
});

export const Conversation = mongoose.model<IConversation>('Conversation', conversationSchema);
