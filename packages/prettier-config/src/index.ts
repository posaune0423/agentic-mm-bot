import type { Config } from "prettier";

const config: Config = {
  printWidth: 120,
  arrowParens: "avoid",
  experimentalTernaries: true,
  plugins: ["prettier-plugin-organize-imports", "@prettier/plugin-oxc", "prettier-plugin-tailwindcss"],
};

export default config;
