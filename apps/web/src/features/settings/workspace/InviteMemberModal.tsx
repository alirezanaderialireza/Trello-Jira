"use client";

// apps/web/src/features/settings/workspace/InviteMemberModal.tsx
//
// "+ دعوت عضو" CTA at the top of the members tab. Opens a simple
// inline dialog (no Radix dep — see F4 D4) with:
//   • email input         (type=\"email\", required)
//   • role radio          (ADMIN or MEMBER; OWNER not assignable
//                          via invitation — would need an existing
//                          membership + transferOwnership)
//   • submit button       (disabled while the action is in flight)
//
// Submits the bound `onInvite` Server Action. On success:
//   • toast.success
//   • close dialog + clear inputs
//   • router.refresh() so the pending-invitations list below the
//     members table re-renders with the new row
//
// Duplicate-invitation handling (D9): the procedure throws CONFLICT
// with a Persian message ("این ایمیل دعوت معلق دارد") which we
// surface verbatim via toast.error.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

export type InvitationRole = "ADMIN" | "MEMBER";

export type InviteToWorkspaceAction = (input: {
  workspaceId: string;
  email: string;
  role: InvitationRole;
}) => Promise<{
  ok: boolean;
  invitationId?: string;
  expiresAt?: string;
  error?: string;
}>;

interface Props {
  workspaceId: string;
  onInvite: InviteToWorkspaceAction;
}

const ROLE_LABELS: Record<InvitationRole, string> = {
  ADMIN: "مدیر",
  MEMBER: "عضو",
};

const ROLE_DESCRIPTIONS: Record<InvitationRole, string> = {
  ADMIN: "می‌تواند اعضا را مدیریت کند و تنظیمات را ویرایش کند.",
  MEMBER: "به بوردهای فضای کاری دسترسی دارد بدون اختیار مدیریتی.",
};

export function InviteMemberModal({ workspaceId, onInvite }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("MEMBER");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the email input when the dialog opens.
  useEffect(() => {
    if (open) {
      // queueMicrotask ensures the input is mounted before we call focus.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleClose = () => {
    if (isPending) return;
    setOpen(false);
    setEmail("");
    setRole("MEMBER");
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail.length === 0) return;

    startTransition(async () => {
      const result = await onInvite({
        workspaceId,
        email: trimmedEmail,
        role,
      });
      if (result.ok) {
        toast.success(`دعوت برای ${trimmedEmail} ارسال شد.`);
        setEmail("");
        setRole("MEMBER");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "خطا در ارسال دعوت.");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        دعوت عضو
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-member-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3
                id="invite-member-title"
                className="text-lg font-bold text-slate-900"
              >
                دعوت عضو جدید
              </h3>
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                aria-label="بستن"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="invite-email"
                  className="mb-1.5 block text-sm font-medium text-slate-900"
                >
                  ایمیل
                </label>
                <input
                  id="invite-email"
                  ref={inputRef}
                  type="email"
                  dir="ltr"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isPending}
                  placeholder="user@example.com"
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
                <p className="mt-1 text-xs text-slate-400">
                  لینک دعوت به این آدرس ارسال خواهد شد.
                </p>
              </div>

              <fieldset disabled={isPending}>
                <legend className="mb-1.5 block text-sm font-medium text-slate-900">
                  نقش پیشنهادی
                </legend>
                <div className="space-y-2">
                  {(["MEMBER", "ADMIN"] as const).map((r) => (
                    <label
                      key={r}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                        role === r
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="invite-role"
                        value={r}
                        checked={role === r}
                        onChange={() => setRole(r)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {ROLE_LABELS[r]}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {ROLE_DESCRIPTIONS[r]}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isPending}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  لغو
                </button>
                <button
                  type="submit"
                  disabled={isPending || email.trim().length === 0}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? "در حال ارسال..." : "ارسال دعوت"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
