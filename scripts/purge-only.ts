import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "../.env");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

async function main() {
  const { purgeCrmData } = await import("../sync-engine/dist/index.js");

  console.log("Purging all CRM data...");
  const counts = await purgeCrmData();
  console.log("Done:", counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
