import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

// تعریف کانفیگ در یک متغیر برای رفع اخطار ESLint
const config = [
  // 🛡️ قرنطینه کردن پوشه‌های اتوماتیک و بیلد شده
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "eslint.config.mjs"
    ]
  },
  ...compat.extends("next/core-web-vitals"),
];

export default config;