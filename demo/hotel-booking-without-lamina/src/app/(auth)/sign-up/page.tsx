import Link from "next/link";
import { signUpAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader title="Join HavenStay" description="Create an account to book and manage stays" />
        <form action={signUpAction} className="space-y-4">
          <Input id="name" name="name" label="Full name" required autoComplete="name" />
          <Input id="email" name="email" type="email" label="Email" required autoComplete="email" />
          <Input id="password" name="password" type="password" label="Password" required minLength={8} autoComplete="new-password" />
          <Select
            id="role"
            name="role"
            label="Account type"
            options={[
              { value: "GUEST", label: "Traveler" },
              { value: "HOTEL_OWNER", label: "Hotel partner" },
            ]}
          />
          <Button type="submit" variant="accent" className="w-full">Create account</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-teal-800 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
