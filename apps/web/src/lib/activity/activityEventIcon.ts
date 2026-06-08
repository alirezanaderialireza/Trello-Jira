// apps/web/src/lib/activity/activityEventIcon.ts
//
// Phase 1.2 (F1.2.6) — maps event type strings to Lucide icon components.
// Returns the icon constructor (not JSX) so callers can control size/class.

import {
  Activity,
  ArrowRight,
  Calendar,
  CheckSquare,
  Lock,
  MessageSquare,
  MessageSquareDot,
  MessageSquareX,
  Pencil,
  Plus,
  Tag,
  Trash2,
  Unlock,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

export function getActivityIcon(eventType: string): LucideIcon {
  switch (eventType) {
    case "card.created":           return Plus;
    case "card.updated":           return Pencil;
    case "card.moved":             return ArrowRight;
    case "card.deleted":           return Trash2;
    case "card.locked":            return Lock;
    case "card.unlocked":          return Unlock;
    case "card.due_date_updated":  return Calendar;
    case "card.label_added":       return Tag;
    case "card.label_removed":     return Tag;
    case "card.assignee_added":    return UserPlus;
    case "card.assignee_removed":  return UserMinus;
    case "comment.created":        return MessageSquare;
    case "comment.updated":        return MessageSquareDot;
    case "comment.deleted":        return MessageSquareX;
    default:
      if (eventType.startsWith("checklist.")) return CheckSquare;
      return Activity;
  }
}
