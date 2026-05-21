module.exports = {
  plugins: ["@typescript-eslint", "boundaries"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  settings: {
    "boundaries/elements": [
      { type: "app", pattern: "apps/**" },
      { type: "outbox-worker", pattern: "apps/outbox-worker/**" },
      { type: "api", pattern: "packages/api/**" },
      { type: "db", pattern: "packages/db/**" },
      { type: "domain", pattern: "packages/domain/**" },
      { type: "infrastructure", pattern: "packages/infrastructure/**" },
      { type: "auth", pattern: "packages/auth/**" }
    ],
  },
  rules: {
    "boundaries/element-types": [2, {
      default: "disallow",
      rules: [
        { from: "app", allow: ["api", "domain", "infrastructure", "auth", "db"] },
        { from: "outbox-worker", allow: ["db", "domain", "api", "infrastructure"] },
        { from: "api", allow: ["domain", "db", "auth", "infrastructure"] },
        { from: "domain", allow: [] },
        { from: "db", allow: ["domain"] },
        { from: "infrastructure", allow: ["domain", "auth"] },
        { from: "auth", allow: ["domain"] }
      ]
    }],
    "no-restricted-imports": ["error", { patterns: ["../../../../*"] }]
  }
};
