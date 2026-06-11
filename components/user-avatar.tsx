import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UserAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-7", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name ?? ""} /> : null}
      <AvatarFallback className="bg-primary/20 text-[10px] font-medium text-primary">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
