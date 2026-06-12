import { cn } from "@/lib/utils";

/**
 * Dispatch brand mark — a geometric "D" (square with a rounded right
 * side) holding three dispatch lines, in electric blue. Works on dark
 * and light backgrounds.
 */
export function DispatchMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("size-8 shrink-0", className)}
    >
      <path
        d="M4 4 H16 A12 12 0 0 1 28 16 A12 12 0 0 1 16 28 H4 Z"
        fill="#2563eb"
      />
      <rect x="9" y="10.5" width="12" height="2.5" rx="1.25" fill="#f8f8ff" />
      <rect x="9" y="15" width="10" height="2.5" rx="1.25" fill="#f8f8ff" opacity="0.8" />
      <rect x="9" y="19.5" width="12" height="2.5" rx="1.25" fill="#f8f8ff" opacity="0.6" />
    </svg>
  );
}

export function DispatchLogo({
  variant = "full",
  size = "md",
  className,
}: {
  variant?: "full" | "icon" | "wordmark";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const markSize = { sm: "size-6", md: "size-8", lg: "size-12" }[size];
  const wordSize = { sm: "text-base", md: "text-lg", lg: "text-3xl" }[size];

  if (variant === "icon") return <DispatchMark className={cn(markSize, className)} />;

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {variant === "full" && <DispatchMark className={markSize} />}
      <span
        className={cn(
          "font-semibold tracking-tight text-foreground",
          wordSize
        )}
      >
        Dispatch
      </span>
    </span>
  );
}
