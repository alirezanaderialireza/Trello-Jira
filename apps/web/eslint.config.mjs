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
  // 🛡️ Date Engine Boundary — prevents direct dayjs/jalaliday imports
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "dayjs", message: "✗ Import from '@/lib/date' instead." },
          { name: "jalaliday", message: "✗ Import from '@/lib/date' instead." },
          { name: "jalaliday/dayjs", message: "✗ Import from '@/lib/date' instead." },
          { name: "jalaliday/intl", message: "✗ Import from '@/lib/date' instead." },
        ],
        patterns: [
          { group: ["dayjs/plugin/*"], message: "✗ All plugins are registered in '@/lib/date'." },
        ],
      }],
    },
  },
  // Whitelist: only date.ts and date.test.ts may import dayjs
  {
    files: ["src/lib/date.ts", "src/lib/date.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;