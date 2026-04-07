import { Router } from 'express';
import { handleChat, getHistory } from '../controllers/chatController';

const router = Router();

// Chat endpoints
router.post('/chat', handleChat);
router.get('/history/:userId', getHistory);

export default router;
