# AI Providers (v2.6.0)

M-NEXUS supports four AI providers. Pick what fits your privacy/cost tradeoff.

## Comparison

| Provider | Privacy | Cost | Speed | Quality | Setup |
|---|---|---|---|---|---|
| **Mock** | ✓ offline | free | instant | canned | none |
| **Ollama** (local) | ✓✓ private | free | depends on hardware | good | install Ollama + pull model |
| **OpenRouter** | ✗ data sent to OpenRouter | pay per token | fast | depends on model | API key |
| **OpenAI-compatible** | depends | depends | fast | depends | baseUrl + key |

## Configuration

Configured in setup wizard (slide 7) or via API:

```bash
# Read current config
curl -H "Authorization: Bearer $TOK" http://localhost:4100/api/v1/admin/ai

# Update config
curl -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"provider":"openrouter","apiKey":"sk-or-v1-...","model":"meta-llama/llama-3.1-8b-instruct:free"}' \
  http://localhost:4100/api/v1/admin/ai

# Test connection
curl -X POST -H "Authorization: Bearer $TOK" http://localhost:4100/api/v1/admin/ai/test
```

## Ollama (recommended for privacy)

Ollama runs LLMs locally — your notes never leave your machine.

### Install

```bash
# Linux/macOS
curl -fsSL https://ollama.com/install.sh | sh

# Verify
ollama --version

# Pull a model (4-8GB for 8B models)
ollama pull llama3.1:8b
# Or smaller/faster:
ollama pull phi3:mini
# Or larger/smarter:
ollama pull llama3.1:70b
```

### Configure M-NEXUS

In setup wizard (slide 7), choose **Ollama**:
- URL base: `http://localhost:11434` (default)
- Model: `llama3.1:8b` (or whatever you pulled)

Click **🔌 Probar conexión** — should respond "Provider ollama responded: ...".

### Recommended models

| Model | VRAM | Quality | Speed |
|---|---|---|---|
| `phi3:mini` | 3GB | OK | very fast |
| `llama3.1:8b` | 6GB | good | fast |
| `mistral:7b` | 6GB | good | fast |
| `llama3.1:70b` | 40GB | excellent | slow |
| `qwen2.5:14b` | 10GB | very good | medium |

For Apple Silicon Macs, Ollama uses Metal acceleration automatically.

## OpenRouter

OpenRouter aggregates many models behind one API. Pay per token.

### Setup

1. Sign up at https://openrouter.ai
2. Create API key at https://openrouter.ai/keys
3. Add credits (free tier gives $1 for testing)
4. Configure M-NEXUS:
   - Provider: OpenRouter
   - API Key: `sk-or-v1-...`
   - Model: any model slug from https://openrouter.ai/models

### Free models

OpenRouter has several free models (rate-limited):
- `meta-llama/llama-3.1-8b-instruct:free`
- `google/gemma-2-9b-it:free`
- `mistralai/mistral-7b-instruct:free`

These are good for development / testing without spending money.

### Privacy

⚠️ Your notes **are sent to OpenRouter's servers**, which then forward to the model provider. Don't use OpenRouter for highly sensitive notes.

## OpenAI-compatible (LM Studio, vLLM, etc.)

Any endpoint that speaks the OpenAI chat completions API.

### LM Studio (local, GUI)

1. Download from https://lmstudio.ai
2. Search and download a model
3. Start the local server (default port 1234)
4. Configure M-NEXUS:
   - Provider: OpenAI-compatible
   - URL base: `http://localhost:1234/v1`
   - API Key: `lm-studio` (any value)
   - Model: whatever you loaded

### vLLM (production-grade local)

```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-8B-Instruct \
  --port 8000
```

Then configure M-NEXUS with `http://localhost:8000/v1`.

### Cloud providers with OpenAI-compatible API

- **Together AI** — `https://api.together.xyz/v1`
- **Anyscale** — `https://api.endpoints.anyscale.com/v1`
- **Groq** — `https://api.groq.com/openai/v1` (very fast inference)
- **Fireworks AI** — `https://api.fireworks.ai/inference/v1`

All work with the same config format.

## Mock (skip)

No AI. Returns canned responses like `[mock AI] You asked: "...". Configure a real provider in Settings to get real answers.`

Useful for development without GPU/API costs.
