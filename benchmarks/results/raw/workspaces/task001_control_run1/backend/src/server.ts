import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import 'express-async-errors'; // async error handling
import prisma from './prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ---------- Types ----------
interface AuthPayload { userId: string; }

// ---------- Middleware ----------
const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) throw new Error('User not found');
    (req as any).user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (allowed: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as any;
    const membership = await prisma.householdMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
    });
    if (!membership || !allowed.includes(membership.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    (req as any).membership = membership;
    next();
  };
};

// ---------- Auth Routes ----------
app.post('/auth/register', async (req, res) => {
  const { email, password, name, phone } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'User exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash: hash, name, phone },
  });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.json({ token, userId: user.id });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  res.json({ token, userId: user.id });
});

// ---------- Import Routers ----------
import householdRouter from './routes/household';
import budgetRouter from './routes/budget';
import accountRouter from './routes/account';
import transactionRouter from './routes/transaction';
import reviewRouter from './routes/review';
import alertRouter from './routes/alert';
import settingsRouter from './routes/settings';

app.use('/households', authenticate, householdRouter);
app.use('/budgets', authenticate, budgetRouter);
app.use('/accounts', authenticate, accountRouter);
app.use('/transactions', authenticate, transactionRouter);
app.use('/reviews', authenticate, reviewRouter);
app.use('/alerts', authenticate, alertRouter);
app.use('/settings', authenticate, settingsRouter);

// ---------- Error handling ----------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
