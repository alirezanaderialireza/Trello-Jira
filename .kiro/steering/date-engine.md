# Date Engine Rules

## Golden Rule
**هیچ‌جا `dayjs` یا `jalaliday` مستقیم import نکن.**
تنها `@/lib/date` مجاز به import این پکیج‌ها است.
ESLint `no-restricted-imports` این قانون را enforce می‌کند.

## When to use which type

| Type | Use for | Example |
|------|---------|---------|
| `UTCDateTime` | Persisted timestamps, server events, audit logs | `createdAt`, `occurredAt`, `updatedAt` |
| `DateOnly` | Calendar dates without time | `dueDate`, `invoiceDate`, `birthDate` |

## Common patterns

```ts
import { utcFromServer, fromJalaliInput, toJalaliDisplay, isOverdue } from "@/lib/date";

// Server → Client
const created = utcFromServer(card.createdAt);

// User input (Jalali)
const result = fromJalaliInput("1404/01/10");
if (!result.ok) showError(result.error);

// Display
const display = toJalaliDisplay(card.dueDate, getUserTZ());

// Logic
if (isOverdue(card.dueDate)) showOverdueBadge();
```

## ⚠️ Known Traps
1. `jalaliday` silently rolls over invalid dates — always use round-trip validation
2. `.calendar('jalali')` resets utcOffset — use global toggle with try/finally
3. `DateOnly` must NEVER have timezone shift applied
4. `nowUIOnly()` is for display only — never persist it
