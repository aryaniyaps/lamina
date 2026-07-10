import { db } from "@/lib/db";
import type { NotificationType } from "@prisma/client";

export async function createNotification({
  userId,
  type,
  title,
  body,
  link,
  sendEmail = false,
}: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  sendEmail?: boolean;
}) {
  return db.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      link,
      emailSent: sendEmail,
    },
  });
}

export async function getUnreadCount(userId: string) {
  return db.notification.count({
    where: { userId, isRead: false },
  });
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  return db.notification.updateMany({
    where: {
      userId,
      ...(ids ? { id: { in: ids } } : { isRead: false }),
    },
    data: { isRead: true },
  });
}
