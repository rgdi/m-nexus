import { SearchService } from "./src/services/searchService.js";

async function test() {
  console.log("Creating SearchService...");
  const svc = new SearchService();
  console.log("Created. Searching 'corazón'...");
  try {
    const r = await svc.search("corazón", { limit: 5 });
    console.log("Results:", r);
  } catch (e) {
    console.error("Error:", e.message);
    console.error("Stack:", e.stack);
  }
}

test().catch(console.error);
