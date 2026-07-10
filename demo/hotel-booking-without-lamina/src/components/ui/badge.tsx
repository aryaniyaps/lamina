import { cn } from "@/lib/utils";

const variants = {
  default: "bg-muted text-foreground",
  success: "bg-teal-100 text-teal-900",
  warning: "bg-amber-100 text-amber-900",
  destructive: "bg-red-100 text-red-800",
  outline: "border border-border bg-transparent",
};

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
