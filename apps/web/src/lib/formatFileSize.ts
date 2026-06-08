// apps/web/src/lib/formatFileSize.ts
//
// Persian-formatted file size. Numbers via fa-IR locale.

function fa(n: number, decimals = 0): string {
  return n.toLocaleString("fa-IR", { maximumFractionDigits: decimals });
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return "";
  if (bytes < 1024)       return `${fa(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${fa(bytes / 1024, 1)} کیلوبایت`;
  return `${fa(bytes / (1024 * 1024), 1)} مگابایت`;
}
