import posaune0423 from "@posaune0423/eslint-config";

export default posaune0423(
  {
    typescript: true,
    node: true,
  },
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ["eslint.config.ts", "tests/**"],
  },
  {
    rules: {
      "n/no-missing-import": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      // Bun runtime supports fetch natively
      "n/no-unsupported-features/node-builtins": [
        "error",
        {
          ignores: ["fetch"],
        },
      ],
    },
  },
);
