// packages/infrastructure/src/email/templates/_shared.ts
//
// Helpers shared by the Persian RTL email templates.
//
// Email HTML is constructed via plain template strings (see master
// contract D3 — no mjml/react-email dep). Any user-controlled value
// interpolated into HTML must pass through `escapeHtml` to prevent
// HTML injection. Subject lines and plaintext bodies do NOT need
// escaping (they are not rendered as HTML).

/**
 * Escape a user-controlled string for safe interpolation inside an
 * HTML body. Escapes the five characters that are special in HTML
 * attribute and element text contexts: & < > " '
 *
 * Example:
 *   escapeHtml('A & "B"') === 'A &amp; &quot;B&quot;'
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Outer HTML wrapper used by every Persian RTL email template.
 *
 * Why a single wrapper:
 *   • Email clients (Gmail / Outlook / Yahoo) render HTML
 *     inconsistently. Table-based layout + inline styles is the
 *     defensive lowest-common-denominator that survives most clients.
 *   • `dir="rtl"` on the outermost <div> forces right-to-left layout
 *     even when the email client strips <html lang>.
 *   • `font-family` falls back through Tahoma / Vazirmatn /
 *     sans-serif to render Persian glyphs gracefully across
 *     desktop + mobile clients.
 */
export function wrapHtmlBody(innerHtml: string): string {
  return `<div dir="rtl" lang="fa" style="font-family:Tahoma,Vazirmatn,sans-serif;background:#f8fafc;padding:24px 12px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="background:#ffffff;border-radius:12px;padding:32px 24px;border:1px solid #e2e8f0;">
${innerHtml}
      </td>
    </tr>
  </table>
</div>`;
}
