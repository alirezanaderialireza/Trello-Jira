 
export * from "./position";
 
export * from "./position.constants";
 
export * from "./position.errors";
 
export * from "./position.validators";
 
export * from "./position.comparator";
 
export * from "./position.midpoint";
 
export * from "./position.generator";
 
export * from "./position.rebalance";
 
// ============================================================================
// 🔁 Stable Public Alias
// ----------------------------------------------------------------------------
// `generatePosition` اسم داخلی موتور است.
// `getNewPosition` اسم public contract است که سرویس‌ها باید استفاده کنند.
// این alias باعث می‌شود اگر فردا موتور عوض شد، contract نشکند.
// ============================================================================
export { generatePosition as getNewPosition } from "./position.generator";