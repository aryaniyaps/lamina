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
