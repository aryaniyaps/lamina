# LaminaBench implementation capture
Captured 15 source file(s): backend/prisma/schema.prisma, backend/src/app.ts, backend/src/index.ts, backend/src/middleware/auth.ts, backend/src/permissions.ts, backend/src/prisma.ts, backend/src/routes/account.ts, backend/src/routes/alert.ts, backend/src/routes/auth.ts, backend/src/routes/budget.ts, …

## backend/prisma/schema.prisma
```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Household {
  id                String   @id @default(uuid())
  name              String
  primaryBudgeterId String
  primaryBudgeter   User     @relation("PrimaryBudgeter", fields: [primaryBudgeterId], references: [id])
  users             User[]   @relation("HouseholdMembers")
  budgets           Budget[]
  accounts          Account[]
  categories        Category[]
  alerts            Alert[]
  inviteTokens      InviteToken[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model User {
  id           String   @id @default(uuid())
  householdId  String?
  household    Household? @relation("HouseholdMembers", fields: [householdId], references: [id])
  role         Role
  email        String   @unique
  name         String?
  passwordHash String
  createdAt    DateTime @default(now())
  notificationPreferences NotificationPreference[]
  // relation for primary budgeter link
  primaryHousehold Household? @relation("PrimaryBudgeter", fields: [], references: [])
}

enum Role {
  primary_budgeter
  partner
  occasional_viewer
}

model Budget {
  id           String   @id @default(uuid())
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  periodStart  DateTime
  periodEnd    DateTime
  totalIncome  Decimal   @default(0)
  totalExpense Decimal   @default(0)
  active       Boolean   @default(true)
  @@unique([householdId, active], map: "one_active_budget_per_household")
}

model Account {
  id          String   @id @default(uuid())
  householdId String
  household   Household @relation(fields: [householdId], references: [id])
  provider    String
  externalId  String
  balance     Decimal   @default(0)
  lastSync    DateTime?
  transactions Transaction[]
  @@unique([householdId, externalId])
}

enum SyncStatus {
  pending
  synced
  duplicate
}

model Category {
  id          String   @id @default(uuid())
  householdId String
  household   Household @relation(fields: [householdId], references: [id])
  name        String
  isShared    Boolean   @default(true)
  budgetedAmount Decimal @default(0)
  transactions Transaction[]
}

model Transaction {
  id          String   @id @default(uuid())
  accountId   String
  account     Account @relation(fields: [accountId], references: [id])
  categoryId  String?
  category    Category? @relation(fields: [categoryId], references: [id])
  amount      Decimal
  date        DateTime
  description String?
  isPersonal  Boolean @default(false)
  syncStatus  SyncStatus @default(pending)
}

model Alert {
  id           String   @id @default(uuid())
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  type         AlertType
  threshold    Decimal
  enabled      Boolean @default(true)
}

enum AlertType {
  budget_overrun
  category_overrun
  sync_failure
}

model NotificationPreference {
  userId   String @id
  user     User   @relation(fields: [userId], references: [id])
  channel  NotificationChannel
  enabled  Boolean @default(true)
}

enum NotificationChannel {
  email
  push
  sms
}

model InviteToken {
  id          String   @id @default(uuid())
  householdId String
  household   Household @relation(fields: [householdId], references: [id])
  token       String   @unique
  expiresAt   DateTime
}

```

## backend/src/app.ts
```
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

```

## backend/src/index.ts
```
import 'express-async-errors';
import dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

```

## backend/src/middleware/auth.ts
```
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    householdId?: string;
  };
}

export const authenticateJwt = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = {
      id: user.id,
      role: user.role,
      householdId: user.householdId ?? undefined,
    };
    next();
  } catch (err) {
    console.error('JWT auth error', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

```

## backend/src/permissions.ts
```
import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './middleware/auth';

// Define allowed actions per role per resource
const permissionMap: Record<string, Record<string, string[]>> = {
  primary_budgeter: {
    household: ['create', 'read', 'update', 'delete'],
    budget: ['create', 'read', 'update', 'delete'],
    category: ['create', 'read', 'update', 'delete'],
    transaction: ['create', 'read', 'update', 'delete'],
    alert: ['create', 'read', 'update', 'delete'],
    notification_preference: ['create', 'read', 'update', 'delete'],
    partner: ['read'],
    settings: ['read', 'update'],
  },
  partner: {
    household: ['read'],
    budget: ['read'],
    category: ['read', 'update'], // can update personal categories
    transaction: ['create', 'read', 'update', 'delete'], // personal only
    alert: ['read'],
    notification_preference: ['read', 'update'],
    settings: ['read', 'update'],
  },
  occasional_viewer: {
    household: ['read'],
    budget: ['read'],
    category: ['read'],
    transaction: ['read'],
    alert: ['read'],
    settings: ['read'],
  },
};

export const authorize = (resource: string, action: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role) {
      return res.status(403).json({ error: 'Role not found' });
    }
    const allowed = permissionMap[role]?.[resource]?.includes(action);
    if (!allowed) {
      return res.status(403).json({ error: `Role ${role} not allowed to ${action} ${resource}` });
    }
    next();
  };
};

```

## backend/src/prisma.ts
```
import { PrismaClient } from '@prisma/client';

// Export a single PrismaClient instance for the whole app
export const prisma = new PrismaClient();

```

## backend/src/routes/account.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';

const router = Router();

// Create linked account – any household member can add
router.post('/', authorize('account', 'create'), async (req: Request, res: Response) => {
  const { householdId, provider, externalId, balance } = req.body;
  if (!householdId || !provider || !externalId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const account = await prisma.account.create({
    data: { householdId, provider, externalId, balance: balance ?? 0 },
  });
  res.status(201).json(account);
});

// Trigger sync – placeholder endpoint
router.get('/:id/sync', authorize('account', 'read'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  // In real app, enqueue a sync job. Here we just update lastSync.
  await prisma.account.update({
    where: { id },
    data: { lastSync: new Date() },
  });
  res.json({ message: 'Sync triggered' });
});

export default router;

```

## backend/src/routes/alert.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Create an alert – primary_budgeter only (enforced by permission map)
router.post('/', authorize('alert', 'create'), async (req: AuthRequest, res: Response) => {
  const { householdId, type, threshold, enabled } = req.body;
  if (!householdId || !type || threshold === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const alert = await prisma.alert.create({
    data: {
      householdId,
      type,
      threshold: Number(threshold),
      enabled: enabled ?? true,
    },
  });
  res.status(201).json(alert);
});

// List alerts for household
router.get('/', authorize('alert', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const householdId = user.householdId!;
  const alerts = await prisma.alert.findMany({ where: { householdId } });
  res.json(alerts);
});

// Update alert (enable/disable, threshold)
router.patch('/:id', authorize('alert', 'update'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { threshold, enabled } = req.body;
  const user = req.user!;
  const alert = await prisma.alert.findUnique({ where: { id } });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (alert.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Alert not in your household' });
  }
  const updated = await prisma.alert.update({
    where: { id },
    data: {
      threshold: threshold !== undefined ? Number(threshold) : undefined,
      enabled: enabled !== undefined ? !!enabled : undefined,
    },
  });
  res.json(updated);
});

export default router;

```

## backend/src/routes/auth.ts
```
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

const router = Router();

// Register a new user (primary_budgeter role assumed for first user)
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, role, householdId } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role,
      householdId,
      passwordHash: hash,
    },
  });
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  res.status(201).json({ token, userId: user.id });
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  res.json({ token, userId: user.id });
});

export default router;

```

## backend/src/routes/budget.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';

const router = Router();

// Create a new budget – enforce single active budget per household
router.post('/', authorize('budget', 'create'), async (req: Request, res: Response) => {
  const { householdId, periodStart, periodEnd, totalIncome, totalExpense, active } = req.body;
  if (!householdId || !periodStart || !periodEnd) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // If active, deactivate any existing active budget first
  if (active) {
    await prisma.budget.updateMany({
      where: { householdId, active: true },
      data: { active: false },
    });
  }
  const budget = await prisma.budget.create({
    data: {
      householdId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      totalIncome: totalIncome ?? 0,
      totalExpense: totalExpense ?? 0,
      active: active ?? true,
    },
  });
  res.status(201).json(budget);
});

// Weekly review – aggregate transactions for the active budget
router.get('/:id/weekly-review', authorize('budget', 'read'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const budget = await prisma.budget.findUnique({ where: { id } });
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { householdId: budget.householdId },
      date: { gte: start, lte: new Date() },
    },
    include: { category: true },
  });
  const summary = transactions.reduce(
    (acc, tx) => {
      acc.total += Number(tx.amount);
      if (tx.category) {
        const catName = tx.category.name;
        acc.byCategory[catName] = (acc.byCategory[catName] || 0) + Number(tx.amount);
      }
      return acc;
    },
    { total: 0, byCategory: {} as Record<string, number> },
  );
  res.json({ budget, summary });
});

export default router;

```

## backend/src/routes/category.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Create category – primary_budgeter can create shared, partners can create personal (isShared false)
router.post('/', authorize('category', 'create'), async (req: AuthRequest, res: Response) => {
  const { householdId, name, isShared, budgetedAmount } = req.body;
  if (!householdId || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const user = req.user!;
  // Partners cannot create shared categories
  if (user.role === 'partner' && isShared) {
    return res.status(403).json({ error: 'Partners may only create personal categories' });
  }
  const category = await prisma.category.create({
    data: {
      householdId,
      name,
      isShared: isShared ?? true,
      budgetedAmount: budgetedAmount ?? 0,
    },
  });
  res.status(201).json(category);
});

// List categories – primary_budgeter sees all, partner sees shared + their personal
router.get('/', authorize('category', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const householdId = user.householdId!;
  const where: any = { householdId };
  if (user.role === 'partner') {
    where.OR = [{ isShared: true }]; // personal categories are not visible to partners
  }
  const categories = await prisma.category.findMany({ where });
  res.json(categories);
});

// Update category – partners can only update their own personal categories
router.patch('/:id', authorize('category', 'update'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, isShared, budgetedAmount } = req.body;
  const user = req.user!;
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (category.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Category not in your household' });
  }
  if (user.role === 'partner' && category.isShared) {
    return res.status(403).json({ error: 'Partners cannot modify shared categories' });
  }
  const updated = await prisma.category.update({
    where: { id },
    data: {
      name: name ?? undefined,
      isShared: isShared !== undefined ? !!isShared : undefined,
      budgetedAmount: budgetedAmount !== undefined ? Number(budgetedAmount) : undefined,
    },
  });
  res.json(updated);
});

export default router;

```

## backend/src/routes/household.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Create a new household – only primary_budgeter can create
router.post('/', authorize('household', 'create'), async (req: Request, res: Response) => {
  const { name, primaryBudgeterId } = req.body;
  if (!name || !primaryBudgeterId) {
    return res.status(400).json({ error: 'Missing name or primaryBudgeterId' });
  }
  const household = await prisma.household.create({
    data: {
      name,
      primaryBudgeterId,
    },
  });
  res.status(201).json(household);
});

// Get household details – read permission
router.get('/:id', authorize('household', 'read'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const household = await prisma.household.findUnique({
    where: { id },
    include: { budgets: true, categories: true, accounts: true, alerts: true },
  });
  if (!household) return res.status(404).json({ error: 'Household not found' });
  res.json(household);
});

// Generate partner invite token – primary_budgeter only
router.post('/:id/invite', authorize('household', 'create'), async (req: Request, res: Response) => {
  const { id } = req.params;
  const household = await prisma.household.findUnique({ where: { id } });
  if (!household) return res.status(404).json({ error: 'Household not found' });
  const token = uuidv4();
  // For simplicity store token in a temporary table (inviteTokens) – create if not exists
  await prisma.inviteToken.upsert({
    where: { householdId: id },
    update: { token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    create: { householdId: id, token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  // In real product we would email/SMS the token; here we just return it.
  res.json({ token });
});

export default router;

```

## backend/src/routes/invite.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Accept an invite token – creates a partner user and links to household
router.post('/accept', async (req: Request, res: Response) => {
  const { token, email, password, name } = req.body;
  if (!token || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const invite = await prisma.inviteToken.findUnique({ where: { token } });
  if (!invite) return res.status(404).json({ error: 'Invalid invite token' });
  if (invite.expiresAt < new Date()) {
    return res.status(410).json({ error: 'Invite token expired' });
  }
  // Ensure email not already used
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'User already exists' });
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: 'partner',
      householdId: invite.householdId,
      passwordHash: hash,
    },
  });
  // Delete the token after use
  await prisma.inviteToken.delete({ where: { token } });
  const jwtToken = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
  res.status(201).json({ token: jwtToken, userId: user.id });
});

export default router;

```

## backend/src/routes/settings.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Get notification preferences for current user
router.get('/notifications', authorize('notification_preference', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const prefs = await prisma.notificationPreference.findMany({ where: { userId: user.id } });
  res.json(prefs);
});

// Update notification preference for a channel
router.patch('/notifications/:channel', authorize('notification_preference', 'update'), async (req: AuthRequest, res: Response) => {
  const { channel } = req.params;
  const { enabled } = req.body;
  const user = req.user!;
  const pref = await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    update: { enabled: !!enabled },
    create: { userId: user.id, channel: channel as any, enabled: !!enabled },
  });
  res.json(pref);
});

// Placeholder for sync settings (frequency, offline cache size)
router.get('/sync', authorize('settings', 'read'), async (req: AuthRequest, res: Response) => {
  // In a real app this would read from a user settings table.
  res.json({ syncOnForeground: true, backgroundSyncEnabled: false, cacheSizeMb: 50 });
});

router.patch('/sync', authorize('settings', 'update'), async (req: AuthRequest, res: Response) => {
  // Stub – accept any payload and echo back.
  const settings = req.body;
  res.json({ message: 'Sync settings updated (stub)', settings });
});

export default router;

```

## backend/src/routes/transaction.ts
```
import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { authorize } from '../permissions';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Helper to ensure the account belongs to the user's household
const verifyAccountHousehold = async (accountId: string, householdId: string) => {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  return account && account.householdId === householdId;
};

// Helper to verify category belongs to household (if provided)
const verifyCategoryHousehold = async (categoryId: string | null, householdId: string) => {
  if (!categoryId) return true;
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  return category && category.householdId === householdId;
};

// Create transaction – respects privacy and duplicate detection
router.post('/', authorize('transaction', 'create'), async (req: AuthRequest, res: Response) => {
  const { accountId, categoryId, amount, date, description, isPersonal } = req.body;
  if (!accountId || amount === undefined || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const user = req.user!;
  // Verify account belongs to user's household
  const householdId = user.householdId!;
  const accountOk = await verifyAccountHousehold(accountId, householdId);
  if (!accountOk) return res.status(400).json({ error: 'Account does not belong to your household' });
  // Verify category (if any) belongs to household
  const categoryOk = await verifyCategoryHousehold(categoryId ?? null, householdId);
  if (!categoryOk) return res.status(400).json({ error: 'Category does not belong to your household' });

  // Privacy rule: partners can only create personal transactions
  if (user.role === 'partner' && !isPersonal) {
    return res.status(403).json({ error: 'Partners may only create personal transactions' });
  }

  // Duplicate detection – naive match on amount, date, description, account
  const duplicate = await prisma.transaction.findFirst({
    where: {
      accountId,
      amount: Number(amount),
      date: new Date(date),
      description,
    },
  });
  if (duplicate) {
    // Mark as duplicate and return existing
    await prisma.transaction.update({
      where: { id: duplicate.id },
      data: { syncStatus: 'duplicate' },
    });
    return res.status(200).json({ message: 'Duplicate transaction detected', transaction: duplicate });
  }

  const tx = await prisma.transaction.create({
    data: {
      accountId,
      categoryId: categoryId ?? undefined,
      amount: Number(amount),
      date: new Date(date),
      description,
      isPersonal: !!isPersonal,
      syncStatus: 'pending',
    },
  });
  res.status(201).json(tx);
});

// List transactions – respects privacy
router.get('/', authorize('transaction', 'read'), async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const householdId = user.householdId!;
  const whereClause: any = {
    account: { householdId },
  };
  if (user.role === 'partner') {
    // Partners see only shared transactions and their own personal ones
    whereClause.OR = [
      { isPersonal: false },
      { isPersonal: true, account: { householdId } }, // personal belongs to same household (owner check later)
    ];
  }
  const transactions = await prisma.transaction.findMany({
    where: whereClause,
    include: { account: true, category: true },
  });
  // Filter personal transactions to owner only
  const filtered = transactions.filter((tx) => {
    if (user.role !== 'partner') return true;
    if (!tx.isPersonal) return true;
    // Owner is the user who created the transaction – we don't store owner, so assume partner cannot see any personal.
    // In a real app we would have a creatorId field. Here we block all personal for partner.
    return false;
  });
  res.json(filtered);
});

// Update transaction – only allowed for owner or primary_budgeter
router.put('/:id', authorize('transaction', 'update'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { amount, date, description, categoryId, isPersonal } = req.body;
  const user = req.user!;
  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  // Verify household ownership
  const account = await prisma.account.findUnique({ where: { id: tx.accountId } });
  if (!account || account.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Transaction not in your household' });
  }
  // Privacy: partners cannot modify non‑personal transactions
  if (user.role === 'partner' && !tx.isPersonal) {
    return res.status(403).json({ error: 'Partners cannot modify shared transactions' });
  }
  // If partner attempts to set isPersonal false, reject
  if (user.role === 'partner' && isPersonal === false) {
    return res.status(403).json({ error: 'Partners cannot change transaction to shared' });
  }
  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      amount: amount !== undefined ? Number(amount) : undefined,
      date: date ? new Date(date) : undefined,
      description: description ?? undefined,
      categoryId: categoryId ?? undefined,
      isPersonal: isPersonal !== undefined ? !!isPersonal : undefined,
    },
  });
  res.json(updated);
});

// Delete transaction – primary_budgeter can delete any; partner only own personal
router.delete('/:id', authorize('transaction', 'delete'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const tx = await prisma.transaction.findUnique({ where: { id } });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  const account = await prisma.account.findUnique({ where: { id: tx.accountId } });
  if (!account || account.householdId !== user.householdId) {
    return res.status(403).json({ error: 'Transaction not in your household' });
  }
  if (user.role === 'partner' && !tx.isPersonal) {
    return res.status(403).json({ error: 'Partners cannot delete shared transactions' });
  }
  await prisma.transaction.delete({ where: { id } });
  res.json({ message: 'Transaction deleted' });
});

export default router;

```

