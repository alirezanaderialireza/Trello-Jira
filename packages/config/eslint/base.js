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
      { type: "worker", pattern: "apps/worker/**" },
      { type: "api", pattern: "packages/api/**" },
      { type: "db", pattern: "packages/db/**" },
      { type: "domain", pattern: "packages/domain/**" },
      { type: "ui", pattern: "packages/ui/**" },
      { type: "validators", pattern: "packages/validators/**" },
      { type: "time-engine", pattern: "packages/time-engine/**" }
    ],
  },
  rules: {
    "boundaries/element-types": [2, {
      default: "disallow",
      rules: [
        { from: "app", allow: ["api", "domain", "ui", "validators", "time-engine"] },
        { from: "worker", allow: ["db", "domain", "api", "time-engine"] },
        { from: "api", allow: ["domain", "validators", "time-engine"] },
        { from: "domain", allow: ["time-engine", "validators"] },
        { from: "db", allow: ["validators"] }
      ]
    }],
    "no-restricted-imports": ["error", { patterns: ["../../../../*"] }]
  }
};