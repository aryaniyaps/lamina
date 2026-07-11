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
