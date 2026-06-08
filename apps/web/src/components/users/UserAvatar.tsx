// apps/web/src/components/users/UserAvatar.tsx
//
// Pure presentational avatar for a user. Lives in shared territory
// (src/components/users/) so it can be imported by:
//   • CommentItem in features/board (card-detail)
//   • Future board member chips, assignee pickers, etc.
//
// Three sizes: xs (24px), sm (32px), md (40px).
// If avatarUrl is provided → <img> with loading="lazy".
// Otherwise → coloured circle with the first Persian grapheme of
// displayName, using a deterministic colour from the name hash
// (same display name always gets the same colour).
// Uses getFirstGrapheme from @/lib/persianGrapheme.

import { getFirstGrapheme } from "@/lib/persianGrapheme";

export type AvatarSize = "xs" | "sm" | "md";

interface Props {
  displayName?: string | null;
  avatarUrl?:   string | null;
  size?:        AvatarSize;
  className?:   string;
}

// Eight distinct bg/text pairs for the hash — saturated enough to be
// visible on the dark slate-800 background used in the card modal.
const COLOR_PAIRS: Array<{ bg: string; text: string }> = [
  { bg: "#3b82f6", text: "#fff" }, // blue-500
  { bg: "#8b5cf6", text: "#fff" }, // violet-500
  { bg: "#10b981", text: "#fff" }, // emerald-500
  { bg: "#f59e0b", text: "#1e293b" }, // amber-500 / dark text
  { bg: "#ef4444", text: "#fff" }, // red-500
  { bg: "#06b6d4", text: "#fff" }, // cyan-500
  { bg: "#ec4899", text: "#fff" }, // pink-500
  { bg: "#84cc16", text: "#1e293b" }, // lime-500 / dark text
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
};

const IMG_SIZE: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40 };

export function UserAvatar({
  displayName,
  avatarUrl,
  size = "sm",
  className = "",
}: Props) {
  const sizeClass = SIZE_CLASSES[size];
  const imgPx     = IMG_SIZE[size];
  const label     = displayName ?? "کاربر";

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={label}
        width={imgPx}
        height={imgPx}
        loading="lazy"
        className={`rounded-full object-cover flex-shrink-0 ${sizeClass} ${className}`}
      />
    );
  }

  const grapheme = getFirstGrapheme(displayName);
  const pair     = COLOR_PAIRS[hashName(label) % COLOR_PAIRS.length]!;

  return (
    <span
      aria-hidden="true"
      title={label}
      style={{ backgroundColor: pair.bg, color: pair.text }}
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold leading-none select-none ${sizeClass} ${className}`}
    >
      {grapheme}
    </span>
  );
}
