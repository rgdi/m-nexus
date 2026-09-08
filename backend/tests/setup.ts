// Setup MINIMO de tests.
// v0.46: NO activa MOCKs globalmente. Cada test que quiera MOCKear un
// servicio externo debe hacerlo explícitamente en su `beforeEach`.
// Esto evita que tests "pasen" probando stubs sin saberlo.

process.env.AUTH_REQUIRED = "true";
// v0.47.12: tests usan un secret >= 32 chars (config.ts ahora fail-fast en secretos débiles).
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-32chars-min";
process.env.LOG_LEVEL = "silent";
// Defaults conservadores: forzar MOCKs solo si el test no los desactiva
process.env.MOCK_WHISPER = process.env.MOCK_WHISPER ?? "1";  // default ON (cambiar si querés probar real)
process.env.MOCK_OLLAMA = process.env.MOCK_OLLAMA ?? "1";
process.env.MOCK_OPENROUTER = process.env.MOCK_OPENROUTER ?? "1";
process.env.MOCK_TESSERACT = process.env.MOCK_TESSERACT ?? "1";
