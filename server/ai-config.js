let sessionConfig = null;

export function getAIConfig() {
  if (sessionConfig) return sessionConfig;
  if (process.env.OPENAI_API_KEY) return {
    provider: 'openai', key: process.env.OPENAI_API_KEY,
    base: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };
  if (process.env.GEMINI_API_KEY) return {
    provider: 'gemini', key: process.env.GEMINI_API_KEY,
    base: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  };
  return null;
}

export function configureAI(provider, key, model) {
  const isGemini = provider === 'gemini';
  sessionConfig = {
    provider, key,
    base: isGemini ? (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai') : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
    model: model || (isGemini ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash') : (process.env.OPENAI_MODEL || 'gpt-4o-mini')),
  };
}
