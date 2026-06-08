---
inclusion: always
---

# Attachments — Phase 1.2 (F1.2.8) Conventions

---

## Decision Points (D1..D14)

| # | Decision | Resolution |
|---|---|---|
| D1 | Storage backend | Cloudflare R2 (prod), MinIO (dev via docker-compose) |
| D2 | Upload flow | Pre-signed PUT: requestUpload → browser PUT → confirmUpload |
| D3 | Link attachment | Direct URL storage, no upload. type="link", object_key=NULL |
| D4 | Limits | 10 attachments per card, 25 MB per file |
| D5 | Schema | Dedicated `attachments` table (not JSONB). Soft-delete. |
| D6 | Cover from image | { type: "image", id: attachmentId, url } — extends BackgroundData |
| D7 | Idempotency | confirmUpload + addLink + remove all use idempotencyKey |
| D8 | Migration | 0011_phase1.2_attachments.sql |
| D9 | API surface | v1.public.attachment.{requestUpload, confirmUpload, addLink, remove, list} |
| D10 | Env vars | R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL, STORAGE_ENDPOINT (MinIO), STORAGE_FORCE_PATH_STYLE |
| D11 | Infrastructure | StorageService in packages/infrastructure — dynamic require for @aws-sdk |
| D12 | AttachmentDto.type | "file" \| "link" |
| D13 | Hydration | Lazy (list fetched on card-detail open, not at board init) |
| D14 | AttachmentCountBadge | Shared component — reads cards.attachmentCount from store |

---

## Storage: Cloudflare R2 / MinIO

```
requestUpload → presigned PUT URL (5 min expiry, 25 MB max)
browser PUT → R2/MinIO directly (no server buffer)
confirmUpload → DB row + outbox event
```

ObjectKey format: `{tenantId}/{cardId}/{uuid}{.ext}`

Dev: MinIO via docker-compose on ports 9000 (API) / 9001 (Console).
Creds: `minioadmin` / `minioadmin123`.

SDK: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — dynamically
required at runtime (not in devDeps) so lint/typecheck pass without install.

---

## Schema (migration `0011_phase1.2_attachments.sql`)

```
attachments
  id           uuid PK
  tenant_id    uuid NOT NULL
  card_id      uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE
  board_id     uuid NOT NULL
  type         varchar(10) NOT NULL DEFAULT 'file'  -- "file" | "link"
  url          text NOT NULL                         -- CDN or external URL
  object_key   text                                  -- R2/MinIO key; NULL for link
  mime_type    varchar(128)
  file_name    varchar(255) NOT NULL
  size_bytes   integer
  title        varchar(255)                          -- optional display title for link
  uploaded_by  varchar(128) NOT NULL                 -- userId
  created_at   timestamptz NOT NULL DEFAULT now()
  deleted_at   timestamptz                           -- soft-delete only
```

`cards.attachment_count integer NOT NULL DEFAULT 0` — denormalised via
trigger `trg_attachment_count` on INSERT / UPDATE OF deleted_at.

**RLS:** tenant-only (no board_members EXISTS) — reachable only through cards.

---

## Domain (`packages/domain/src/attachments/`)

```ts
AttachmentEntity { id, tenantId, cardId, boardId, type, url, objectKey,
                   mimeType, fileName, sizeBytes, title, uploadedBy,
                   createdAt, deletedAt }
isImageAttachment(entity): boolean  // mimeType.startsWith("image/")
```

**Use-cases:**
- `addFileAttachment` — builds entity + AttachmentAddedEvent
- `addLinkAttachment` — same for link type; derives fileName from hostname if no title
- `removeAttachment` — builds AttachmentRemovedEvent

**Errors (5):** AttachmentNotFoundError, AttachmentCardMismatchError,
AttachmentUploaderOnlyError, AttachmentLimitError, AttachmentFileSizeError.

---

## API (`v1.public.attachment.*`)

```
requestUpload({ boardId, cardId, fileName, fileSize, mimeType, idempotencyKey })
  → { uploadUrl, objectKey, attachmentId }

confirmUpload({ boardId, cardId, attachmentId, objectKey, fileName,
                mimeType, fileSize, idempotencyKey })
  → AttachmentDto

addLink({ boardId, cardId, url, title?, idempotencyKey })
  → AttachmentDto

remove({ boardId, cardId, attachmentId, idempotencyKey })
  → { success }

list({ boardId, cardId })
  → { attachments: AttachmentDto[] }
```

Auth: uploader OR board ADMIN/OWNER for remove.
Storage cleanup: fire-and-forget after soft-delete (no failure propagation).
Cover cleanup: if removed attachment was the card cover → cover_data cleared.

---

## Web Client

### AttachmentDto

```ts
{ id, type, url, objectKey?, mimeType, fileName, sizeBytes, title?,
  uploadedBy, createdAt, isOptimistic? }
```

### Hooks

| Hook | Description |
|---|---|
| `useUploadAttachment` | 3-step: requestUpload → fetch PUT → confirmUpload |
| `useAddLinkAttachment` | Direct addLink call |
| `useRemoveAttachment` | Optimistic remove + boardApi.removeAttachment |
| `useSetCardCover` | Optimistic cover update; handles type="image" |

### UI Components

| Component | Location | Description |
|---|---|---|
| `AttachmentDropzone` | `card-detail/attachments/` | Drag-drop + click-to-upload |
| `AddLinkForm` | same | Toggle form for external URL |
| `AttachmentItem` | same | Row: thumbnail/icon, size, date, download, set-as-cover, delete |
| `CardAttachments` | `card-detail/` | Container: query + merge + render |
| `AttachmentCountBadge` | `components/cards/` | **shared** — Paperclip + count |

### CardItem cover strip

```tsx
{coverData ? (
  <div className="absolute inset-x-0 top-0 h-10 rounded-t-lg"
    style={coverData.type === "image" && coverData.url
      ? { backgroundImage: `url(${coverData.url})`, backgroundSize: "cover" }
      : undefined}
  />
) : null}
```

Card outer div gets `overflow-hidden` + `pt-12` when cover present.

---

## Cover from image attachment (D6)

When user clicks «تنظیم به عنوان پوشش» on an image attachment:

```ts
useSetCardCover().mutate({
  cardId, boardId,
  coverData: { type: "image", id: attachment.id, url: attachment.url },
  correlationId: crypto.randomUUID(),
})
```

This extends the `BackgroundData` shape from F1.2.7 with `type: "image"`.
The cover router (F1.2.7 PR #72) accepts this shape via
`z.enum(["color", "gradient", "image"])`.

When the attachment is deleted and it was the card cover:
- `remove` procedure checks `cards.cover_data.id === attachmentId`
- Sets `cover_data = null` (cleanup in router)

---

## Don't

- **Don't** buffer files through the server — only presigned PUT.
- **Don't** expose R2 credentials to the client.
- **Don't** hard-delete attachments — soft-delete only (`deleted_at`).
- **Don't** call `deleteObject` for link attachments (no `object_key`).
- **Don't** trust client `uploadedBy` — always `ctx.session.user.id`.
- **Don't** skip topology guard (cardRow.boardId === input.boardId).
- **Don't** let `attachment_count` go negative — `GREATEST(count-1, 0)` in trigger.

---

## Parked follow-ups

- Image lightbox/viewer → F1.3 polish.
- Virus scanning → enterprise tier.
- Thumbnail generation → future.
- Zip download all attachments → future.
- Storage quota per workspace → tier module.
- E2E spec → F1.4.
