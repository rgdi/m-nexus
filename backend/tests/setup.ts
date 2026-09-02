// Setup de tests: activa TODOS los mocks.
// Por defecto: AUTH_REQUIRED=true para que los tests prueben el flujo de auth.
// Tests individuales pueden sobreescribirlo (api.test.ts pone false).
process.env.MOCK_WHISPER = "1";
process.env.MOCK_OLLAMA = "1";
process.env.MOCK_OPENROUTER = "1";
process.env.MOCK_TESSERACT = "1";
process.env.AUTH_REQUIRED = "true";
process.env.JWT_SECRET = "test-secret";
process.env.LOG_LEVEL = "silent";
