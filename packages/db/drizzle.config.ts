import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// ============================================================================
// 🛡️ Environmental Guard (No TypeScript Bypasses)
// ============================================================================
if (!process.env.DATABASE_URL) {
  // 🌟 پرتاب خطای صریح برای CI/CD و جلوگیری از اجرای بدون دیتابیس
  throw new Error("❌ FATAL: DATABASE_URL environment variable is missing.");
}

// 🌟 لاگ امن در محیط توسعه
if (process.env.NODE_ENV === "development") {
  console.log("✅ Database URL is securely loaded.");
}

// ============================================================================
// ⚙️ Enterprise Drizzle Kit Configuration
// ============================================================================
export default defineConfig({
  // 🌟 مسیردهی دقیق برای فایل‌های TypeScript (جلوگیری از خواندن JS کامپایل شده)
  schema: "./src/schema/**/*.ts",

  // مسیر خروجی Migrationها
  out: "./migrations",

  // Dialect دیتابیس
  dialect: "postgresql",

  // 🔐 اطلاعات اتصال به دیتابیس
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },

  // ========================================================================
  // 🌟 Enterprise Safety Flags
  // ========================================================================
  strict: true,    // تاییدیه قبل از پاک کردن جدول/ستون
  verbose: true,   // چاپ کامل دستورات SQL برای Audit و بررسی قبل از اجرا
});