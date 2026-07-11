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
