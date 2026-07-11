import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRouter from './routes/auth';
import householdRouter from './routes/household';
import accountRouter from './routes/account';
import budgetRouter from './routes/budget';
import transactionRouter from './routes/transaction';
import categoryRouter from './routes/category';
import alertRouter from './routes/alert';
import settingsRouter from './routes/settings';
import inviteRouter from './routes/invite';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Public routes
app.use('/auth', authRouter);

// Protected routes – JWT middleware
import { authenticateJwt } from './middleware/auth';
app.use(authenticateJwt);

app.use('/households', householdRouter);
app.use('/accounts', accountRouter);
app.use('/budgets', budgetRouter);
app.use('/transactions', transactionRouter);
app.use('/categories', categoryRouter);
app.use('/alerts', alertRouter);
app.use('/settings', settingsRouter);
app.use('/invite', inviteRouter);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ error: message });
});

export default app;
