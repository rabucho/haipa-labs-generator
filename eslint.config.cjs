// @ts-check
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["node_modules/**", ".next/**", ".data/**"],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [
      "src/**/*.ts",
      "src/**/*.tsx",
      "tests/**/*.ts",
      "tests/**/*.tsx",
    ],
  })),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
    },
  }
);