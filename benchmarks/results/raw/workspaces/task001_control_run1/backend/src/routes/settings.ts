import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { requireRole } from '../middleware';

const router = Router();

// Update notification preferences for current user
router.patch('/notifications', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const data = req.body;
  const pref = await prisma.notificationPreference.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  res.json(pref);
});

// Update household profile (name only, currency locked)
router.patch('/household/:householdId', requireRole(['OWNER']), async (req: Request, res: Response) => {
  const { householdId } = req.params;
  const { name, timezone } = req.body;
  const household = await prisma.household.update({
    where: { id: householdId },
    data: { name, /* timezone could be stored in a separate field if added */ },
  });
  res.json(household);
});

export default router;
