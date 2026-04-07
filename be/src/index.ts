import 'dotenv/config'; // Automatically loads .env file
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db';
import routes from './routes';
import { logger } from './utils/logger';
import './workers/memoryWorker'; // Initializes the BullMQ memory worker

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', routes);

// Generic error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  } catch (error: any) {
    logger.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
