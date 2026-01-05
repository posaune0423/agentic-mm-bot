import { config } from "dotenv";
import { resolve } from "path";
import { defineConfig } from "drizzle-kit";

// Load .env from project root
// When running via turbo, cwd is packages/db, so go up two levels
const envPath = resolve(process.cwd(), "../../.env");
config({ path: envPath });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
