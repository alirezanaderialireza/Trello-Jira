// Input sanitization — prevents XSS, bidi attacks, control characters.

export function sanitizeText(input: string): string {
  return input
    .replace(/[<>]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/  +/g, " ")
    .trim();
}

export function validateTitle(input: string, maxLength = 255) {
  if (!input) return { valid: false, sanitized: "", reason: "Required" };
  const sanitized = sanitizeText(input);
  if (!sanitized) return { valid: false, sanitized: "", reason: "Empty after sanitization" };
  if (sanitized.length > maxLength) return { valid: false, sanitized: sanitized.slice(0, maxLength), reason: "Too long" };
  return { valid: true, sanitized };
}

export function sanitizeBody(input: string, maxLength = 10000): string {
  if (!input) return "";
  return input.replace(/[<>]/g, "").replace(/[\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, maxLength).trim();
}
