import { requireAuth } from "@/lib/session";
import { updateProfileAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/db";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireAuth();
  const user = await db.user.findUnique({ where: { id: session.user.id } });

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Account</h1>
      <Card className="mt-8">
        <CardHeader title="Profile" description="Update your personal information" />
        <form action={updateProfileAction} className="space-y-4">
          <Input id="name" name="name" label="Full name" defaultValue={user?.name ?? ""} required />
          <Input id="phone" name="phone" label="Phone" type="tel" defaultValue={user?.phone ?? ""} />
          <Input id="email" name="email" label="Email" type="email" defaultValue={user?.email ?? ""} disabled />
          <Button type="submit">Save changes</Button>
        </form>
      </Card>
    </div>
  );
}
