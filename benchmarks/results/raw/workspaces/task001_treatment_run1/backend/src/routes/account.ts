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
