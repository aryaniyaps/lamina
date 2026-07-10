import Link from "next/link";
import { signInAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";

type Props = {
  searchParams: Promise<{ redirect?: string; error?: string }>;
};

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: Props) {
  const { redirect, error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader title="Welcome back" description="Sign in to manage your trips and bookings" />
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Invalid email or password</p>
        )}
        <form action={signInAction} className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirect ?? "/"} />
          <Input id="email" name="email" type="email" label="Email" required autoComplete="email" />
          <Input id="password" name="password" type="password" label="Password" required autoComplete="current-password" />
          <Button type="submit" className="w-full">Sign in</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="font-medium text-teal-800 hover:underline">
            Create one
          </Link>
        </p>
      </Card>
    </div>
  );
}
