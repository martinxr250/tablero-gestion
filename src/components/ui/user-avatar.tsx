"use client";

import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";

const TONES = [
  "bg-indigo-100 text-indigo-700", "bg-pink-100 text-pink-700", "bg-teal-100 text-teal-700", "bg-amber-100 text-amber-800",
  "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700", "bg-emerald-100 text-emerald-700", "bg-rose-100 text-rose-700",
];

function tone(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** Avatar de usuario sobre el Avatar de shadcn: foto si tiene, iniciales si no. */
export function Avatar({ user, size = 28, className }: { user: { userId?: string; id?: string; name: string; hasAvatar?: boolean }; size?: number; className?: string }) {
  const id = user.userId ?? user.id ?? user.name;
  return (
    <UiAvatar title={user.name} style={{ width: size, height: size }} className={cn("ring-2 ring-card after:hidden", className)}>
      {user.hasAvatar && <AvatarImage src={`/api/v1/users/${id}/avatar`} alt={user.name} />}
      <AvatarFallback className={cn("font-semibold", tone(id))} style={{ fontSize: Math.max(10, size * 0.38) }}>
        {initials(user.name)}
      </AvatarFallback>
    </UiAvatar>
  );
}

export function AvatarStack({ users, max = 4, size = 26 }: { users: { userId: string; name: string; hasAvatar?: boolean }[]; max?: number; size?: number }) {
  return (
    <div className="flex -space-x-2">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.userId} user={u} size={size} />
      ))}
      {users.length > max && (
        <span style={{ width: size, height: size }} className="inline-flex items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
          +{users.length - max}
        </span>
      )}
    </div>
  );
}
