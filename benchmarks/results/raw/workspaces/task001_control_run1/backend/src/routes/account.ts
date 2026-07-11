import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Link a new financial account (placeholder for Plaid exchange)
router.post('/link', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { householdId, name, type, mask, institutionId } = req.body;
  // In a real app we would exchange a Plaid public_token for an access_token.
  const account = await prisma.account.create({
    data: {
      householdId,
      name,
      type,
      mask,
      externalAccountId: uuidv4(), // placeholder unique id
      institutionId,
      status: 'ACTIVE',
    },
  });
  res.json(account);
});

// List all accounts for a household
router.get('/:householdId', requireRole(['OWNER', 'PARTNER', 'VIEWER']), async (req: Request, res: Response) => {
  const { householdId } = req.params;
  const accounts = await prisma.account.findMany({ where: { householdId } });
  res.json(accounts);
});

// Unlink (delete) an account – optionally keep transactions
router.delete('/:accountId', requireRole(['OWNER', 'PARTNER']), async (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { keepTransactions } = req.body; // boolean
  if (!keepTransactions) {
    // cascade delete transactions
    await prisma.transaction.deleteMany({ where: { accountId } });
  }
  await prisma.account.delete({ where: { id: accountId } });
  res.json({ success: true });
});

export default router;
