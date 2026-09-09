import { LLMService } from "./src/services/llm.js";
import { config } from "./src/config.js";

async function test() {
  console.log("=== Test 1: ollamaAvailable ===");
  const llm = new LLMService();
  console.log("Ollama available:", await llm.ollamaAvailable());

  console.log("\n=== Test 2: chat simple ===");
  try {
    const r = await llm.chat({
      messages: [
        { role: "user", content: "Di 'hola' en español" },
      ],
      model: "llama3.2:3b",
      maxTokens: 50,
    });
    console.log("Response:", r);
  } catch (e) {
    console.error("Error:", e.message);
    console.error("Stack:", e.stack);
  }
}

test().catch(console.error);
