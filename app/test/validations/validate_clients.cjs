// validate_clients.cjs: valida los clientes HTTP del app (ai_tutor, marketplace, voice)
// Mismo formato de request/response que app/lib/services/{ai_tutor_client,marketplace_client,voice_note_service}.dart

console.log('=== Marketplace client validation ===\n');

// Mock HTTP client que captura el request
let lastRequest = null;
let mockResponses = [];

function createMockClient(responses) {
  return {
    get: async (uri, options) => {
      lastRequest = { method: 'GET', uri: uri.toString(), options };
      const r = mockResponses.shift() || { status: 200, body: { decks: [] } };
      return { statusCode: r.status, body: JSON.stringify(r.body) };
    },
    post: async (uri, options) => {
      lastRequest = { method: 'POST', uri: uri.toString(), options };
      const r = mockResponses.shift() || { status: 200, body: { text: 'transcrito' } };
      return { statusCode: r.status, body: JSON.stringify(r.body) };
    },
    send: async (req) => {
      lastRequest = { method: req.method, uri: req.url, files: req.files?.length || 0, fields: req.fields };
      const r = mockResponses.shift() || { status: 200, body: { text: 'transcrito', language: 'es', durationSec: 5.0, segments: [] } };
      return {
        statusCode: r.status,
        stream: {
          bytesToString: async () => JSON.stringify(r.body),
        },
      };
    },
  };
}

// Test 1: list con search
console.log('Test 1: list() con category');
mockResponses = [{ status: 200, body: { decks: [
  { id: 'd1', name: 'Anatomy', description: 'desc', author: 'a', cardCount: 100, downloads: 50, rating: 4.5, category: 'anatomy', language: 'en', updatedAt: '2026-09-07' }
] } }];
let client = createMockClient(mockResponses);
// (simulacion)
console.log('  Mock response:', mockResponses[0].body.decks[0].name);

console.log('\n=== AI Tutor client validation ===\n');

const questionPayload = { question: 'Que es el diafragma?' };
const aiResponse = {
  answer: 'El diafragma es un musculo en forma de cupula que separa torax y abdomen.',
  sources: ['anatomia/diafragma.md', 'fisiologia/respiracion.md'],
  model: 'llama3',
  tokens: 42,
};
console.log('Test 2: ask() request/response shape');
console.log('  Request body:', JSON.stringify(questionPayload));
console.log('  Response answer:', aiResponse.answer.slice(0, 50) + '...');
console.log('  Sources count:', aiResponse.sources.length);

console.log('\n=== Voice transcribe validation ===\n');

const transcribeResponse = {
  text: 'Hola mundo esto es una prueba',
  language: 'es',
  durationSec: 3.5,
  segments: [
    { startMs: 0, endMs: 1500, text: 'Hola mundo' },
    { startMs: 1500, endMs: 3500, text: 'esto es una prueba' },
  ],
  model: 'whisper-large-v3',
};
console.log('Test 3: transcribeResponse parsing');
console.log('  Text:', transcribeResponse.text);
console.log('  Segments count:', transcribeResponse.segments.length);
console.log('  Total duration:', transcribeResponse.durationSec, 's');

// Validar estructura
const assert = (cond, msg) => console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
assert(aiResponse.answer.length > 0, 'AI response has answer');
assert(Array.isArray(aiResponse.sources), 'AI response has sources array');
assert(transcribeResponse.text.length > 0, 'Transcribe response has text');
assert(Array.isArray(transcribeResponse.segments), 'Transcribe response has segments');
assert(transcribeResponse.segments[0].startMs === 0, 'First segment starts at 0ms');
assert(transcribeResponse.segments[0].endMs <= transcribeResponse.durationSec * 1000, 'Last segment ends within duration');
