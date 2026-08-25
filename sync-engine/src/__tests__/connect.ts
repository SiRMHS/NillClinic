/**
 * Live connection test for Jordan CRM API.
 *
 * Run: npx tsx sync-engine/src/__tests__/connect.ts
 *
 * Tests authentication and fetches sample data from each endpoint.
 * Uses credentials from env (JORDAN_API_BASE_URL, JORDAN_API_USERNAME, JORDAN_API_PASSWORD).
 */
import { JordanApiClient } from "../jordan-api.client.js";

const BASE_URL = process.env.JORDAN_API_BASE_URL ?? "http://217.114.46.158";
const USERNAME = process.env.JORDAN_API_USERNAME ?? "api";
const PASSWORD = process.env.JORDAN_API_PASSWORD ?? "jordan";
const COMPANY = process.env.JORDAN_API_COMPANY ?? "Jordan";

async function main() {
  console.log("=".repeat(60));
  console.log("Jordan API Connection Test");
  console.log("=".repeat(60));
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Username: ${USERNAME}`);
  console.log(`  Company:  ${COMPANY}`);
  console.log();

  const client = new JordanApiClient({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD, company: COMPANY });

  // ── Test 1: Authentication ──
  console.log("─".repeat(60));
  console.log("Test 1: Authentication");
  console.log("─".repeat(60));
  try {
    const token = await client.authenticate();
    console.log(`  ✓ Token received: ${token.slice(0, 40)}...`);
  } catch (err) {
    console.error(`  ✗ Auth failed:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // ── Test 2: GetServices ──
  console.log();
  console.log("─".repeat(60));
  console.log("Test 2: GetServices (endpoint ignores pagination)");
  console.log("─".repeat(60));
  try {
    // GetServices takes no paging args: the CRM returns the full catalogue
    // regardless, and page 500 is byte-identical to page 1.
    const services = await client.getServices();
    console.log(`  ✓ Received ${services.length} services`);
    if (services.length > 0) {
      console.log(`  Sample:`, JSON.stringify(services[0], null, 2));
    }
  } catch (err) {
    console.error(`  ✗ GetServices failed:`, err instanceof Error ? err.message : err);
  }

  // ── Test 3: GetPatients ──
  console.log();
  console.log("─".repeat(60));
  console.log("Test 3: GetPatients (with pagination)");
  console.log("─".repeat(60));
  try {
    const patients = await client.getPatients({ page: 1, pageSize: 10 });
    console.log(`  ✓ Received ${patients.length} patients`);
    if (patients.length > 0) {
      console.log(`  Sample:`, JSON.stringify(patients[0], null, 2));
    }
  } catch (err) {
    console.error(`  ✗ GetPatients failed:`, err instanceof Error ? err.message : err);
  }

  // ── Test 4: GetReserves ──
  console.log();
  console.log("─".repeat(60));
  console.log("Test 4: GetReserves (with pagination)");
  console.log("─".repeat(60));
  try {
    const reserves = await client.getReserves({ page: 1, pageSize: 10 });
    console.log(`  ✓ Received ${reserves.length} reserves`);
    if (reserves.length > 0) {
      console.log(`  Sample:`, JSON.stringify(reserves[0], null, 2));
    }
  } catch (err) {
    console.error(`  ✗ GetReserves failed:`, err instanceof Error ? err.message : err);
  }

  // ── Test 5: GetTreatments ──
  console.log();
  console.log("─".repeat(60));
  console.log("Test 5: GetTreatments (with pagination)");
  console.log("─".repeat(60));
  try {
    const treatments = await client.getTreatments({ page: 1, pageSize: 10 });
    console.log(`  ✓ Received ${treatments.length} treatments`);
    if (treatments.length > 0) {
      console.log(`  Sample:`, JSON.stringify(treatments[0], null, 2));
    }
  } catch (err) {
    console.error(`  ✗ GetTreatments failed:`, err instanceof Error ? err.message : err);
  }

  // ── Test 6: Multi-page ──
  console.log();
  console.log("─".repeat(60));
  console.log("Test 6: Multi-page pagination (2 pages of patients)");
  console.log("─".repeat(60));
  try {
    const page1 = await client.getPatients({ page: 1, pageSize: 50 });
    const page2 = await client.getPatients({ page: 2, pageSize: 50 });
    console.log(`  ✓ Page 1: ${page1.length}, Page 2: ${page2.length}`);
    if (page1.length > 0 && page2.length > 0 && page1[0] && page2[0]) {
      const codes1 = (page1 as Array<Record<string, unknown>>).map((p: Record<string, unknown>) => p.patientCode);
      const codes2 = (page2 as Array<Record<string, unknown>>).map((p: Record<string, unknown>) => p.patientCode);
      const overlap = codes1.filter((c: unknown) => codes2.includes(c));
      console.log(`  Overlap between pages: ${overlap.length} (should be 0 for true pagination)`);
    }
  } catch (err) {
    console.error(`  ✗ Multi-page failed:`, err instanceof Error ? err.message : err);
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Connection test complete.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
