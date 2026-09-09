// test_rag_eval.ts: evaluación end-to-end del AI tutor con RAG.
//
// v0.48: ejecuta 8 preguntas médicas sobre el test_vault, las pasa al endpoint
// /api/v1/ai/tutor con el contexto de las notas, y evalúa:
//   - Presencia de keywords esperados (3-5 por pregunta)
//   - Atribución de fuente (sourceCount >= 1)
//   - Longitud de respuesta (>50 chars)
//   - Confidence >= 0.5
//
// Output: tabla markdown con success rate global.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface EvalCase {
  question: string;
  expectedKeywords: string[];
  context: string;
}

interface EvalResult {
  question: string;
  hasKeywords: boolean;
  missingKeywords: string[];
  sourceCount: number;
  responseLen: number;
  confidence: number;
  score: number; // 0..1
  pass: boolean;
}

const TEST_VAULT = join(__dirname, 'test_vault');

function loadVaultContext(): string {
  const folders = ['Anatomia', 'Fisiologia', 'Histologia'];
  const ctx: string[] = [];
  for (const folder of folders) {
    const dir = join(TEST_VAULT, folder);
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.md')) {
          const content = readFileSync(join(dir, f), 'utf-8');
          ctx.push(`[${folder}/${f}]\n${content.slice(0, 800)}`);
        }
      }
    } catch (e) {
      // ignore missing folder
    }
  }
  return ctx.join('\n\n---\n\n').slice(0, 4000);
}

const CASES: EvalCase[] = [
  {
    question: '¿Cuáles son las cavidades del corazón?',
    expectedKeywords: ['aurículas', 'ventrículos', 'cuatro', 'dos'],
    context: '',
  },
  {
    question: '¿Qué función cumple el diafragma?',
    expectedKeywords: ['respiración', 'músculo', 'torácica', 'abdominal'],
    context: '',
  },
  {
    question: '¿Dónde se almacena la glucosa?',
    expectedKeywords: ['glucógeno', 'hígado', 'músculo'],
    context: '',
  },
  {
    question: '¿Cuántas cavidades tiene el corazón?',
    expectedKeywords: ['cuatro', 'aurículas', 'ventrículos'],
    context: '',
  },
  {
    question: '¿Qué arteria lleva sangre oxigenada del corazón?',
    expectedKeywords: ['aorta'],
    context: '',
  },
  {
    question: '¿Cuáles son las funciones del riñón?',
    expectedKeywords: ['filtrar', 'orina', 'sangre', 'toxinas'],
    context: '',
  },
  {
    question: '¿Qué partes del cerebro se encargan del equilibrio?',
    expectedKeywords: ['cerebelo'],
    context: '',
  },
  {
    question: '¿Dónde se produce la bilis?',
    expectedKeywords: ['hígado', 'vesícula'],
    context: '',
  },
];

async function getToken(): Promise<string> {
  const r = await fetch('http://localhost:4100/api/v1/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'rag-eval-device',
      deviceName: 'rag-eval',
      platform: 'cli',
      pluginVersion: '0.48.4',
      protocolVersion: '1',
    }),
  });
  if (!r.ok) throw new Error(`register failed: ${r.status} ${await r.text()}`);
  const j = await r.json() as any;
  return j.accessToken || j.token;
}

async function askTutor(token: string, question: string, context: string): Promise<any> {
  const r = await fetch('http://localhost:4100/api/v1/ai/tutor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      question,
      context: context.slice(0, 4000),
      history: [],
      topK: 5,
    }),
  });
  if (!r.ok) throw new Error(`tutor failed: ${r.status} ${await r.text()}`);
  return r.json();
}

function scoreResult(c: EvalCase, response: any): EvalResult {
  const answer = String(response.answer || '').toLowerCase();
  const sources = response.sources || [];
  const confidence = Number(response.confidence || 0);

  const missing = c.expectedKeywords.filter(k => !answer.includes(k.toLowerCase()));
  const hasKeywords = missing.length === 0;
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const responseLen = answer.length;

  // Score: 0.4 keywords + 0.2 sources + 0.2 length + 0.2 confidence
  let score = 0;
  if (hasKeywords) score += 0.4;
  else score += 0.4 * (1 - missing.length / c.expectedKeywords.length);
  if (sourceCount >= 1) score += 0.2;
  if (responseLen > 50) score += 0.2;
  if (confidence >= 0.5) score += 0.2;

  return {
    question: c.question,
    hasKeywords,
    missingKeywords: missing,
    sourceCount,
    responseLen,
    confidence,
    score,
    pass: score >= 0.7,
  };
}

async function main() {
  console.log('=== RAG Evaluation — M-NEXUS v0.48 ===\n');
  console.log(`Test cases: ${CASES.length}\n`);

  const vaultContext = loadVaultContext();
  console.log(`Vault context loaded: ${vaultContext.length} chars\n`);

  const token = await getToken();
  console.log(`Token obtained: ${token.slice(0, 30)}...\n`);

  const results: EvalResult[] = [];
  for (const c of CASES) {
    try {
      const response = await askTutor(token, c.question, c.context || vaultContext);
      const result = scoreResult(c, response);
      results.push(result);
      const status = result.pass ? '✓' : '✗';
      console.log(`${status} ${c.question}`);
      console.log(`    Score: ${result.score.toFixed(2)} | Conf: ${result.confidence.toFixed(2)} | Sources: ${result.sourceCount} | Len: ${result.responseLen}`);
      if (result.missingKeywords.length > 0) {
        console.log(`    Missing: ${result.missingKeywords.join(', ')}`);
      }
    } catch (e: any) {
      console.log(`✗ ${c.question} — ERROR: ${e.message}`);
      results.push({
        question: c.question,
        hasKeywords: false,
        missingKeywords: c.expectedKeywords,
        sourceCount: 0,
        responseLen: 0,
        confidence: 0,
        score: 0,
        pass: false,
      });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const successRate = passed / results.length;

  console.log('\n=== MARKDOWN TABLE ===\n');
  console.log('| # | Question | Score | Conf | Sources | Missing | Pass |');
  console.log('|---|----------|-------|------|---------|---------|------|');
  results.forEach((r, i) => {
    const q = r.question.replace(/\|/g, '\\|').slice(0, 50);
    const missing = r.missingKeywords.join(', ') || '—';
    console.log(`| ${i + 1} | ${q} | ${r.score.toFixed(2)} | ${r.confidence.toFixed(2)} | ${r.sourceCount} | ${missing} | ${r.pass ? '✅' : '❌'} |`);
  });
  console.log(`\n**Success rate: ${passed}/${results.length} = ${(successRate * 100).toFixed(1)}%**\n`);

  if (successRate < 0.75) {
    console.log('\n⚠️  Success rate < 75%. Suggested improvements:');
    console.log('  - Increase topK (currently 5) to retrieve more context');
    console.log('  - Improve search ranking (better embeddings or BM25 hybrid)');
    console.log('  - Increase context window passed to LLM');
    console.log('  - Use a larger model (llama3.2:7b or qwen2.5:7b)');
    console.log('  - Filter for "exam_priority" topics first');
  } else {
    console.log('\n✅ Success rate >= 75%. No action needed.');
  }

  process.exit(successRate >= 0.75 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
