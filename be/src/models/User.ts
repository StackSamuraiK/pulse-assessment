import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  userId: string;
  createdAt: Date;
}

const userSchema: Schema = new Schema({
  userId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model<IUser>('User', userSchema);
