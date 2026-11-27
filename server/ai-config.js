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

export function setAIModel(model) {
  const config = getAIConfig();
  if (!config) throw new Error('Chưa cấu hình AI.');
  sessionConfig = { ...config, model };
}

export async function listAIModels() {
  const config = getAIConfig();
  if (!config) throw new Error('Hãy lưu khóa AI trước khi tải danh sách mô hình.');
  const base = config.base.replace(/\/$/, '');
  const gemini = config.provider === 'gemini';
  const url = `${gemini ? base.replace(/\/openai$/, '') : base}/models`;
  const headers = gemini ? { 'x-goog-api-key': config.key } : { Authorization: `Bearer ${config.key}` };
  const models = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const endpoint = new URL(url);
    if (gemini) {
      endpoint.searchParams.set('pageSize', '100');
      if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    }
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Không tải được danh sách mô hình (${config.provider}, HTTP ${response.status}).`);
    const result = await response.json();
    if (gemini) {
      for (const item of result.models || []) {
        const id = String(item.name || '').replace(/^models\//, '');
        if (item.supportedGenerationMethods?.includes('generateContent') && /^gemini-/i.test(id) && !/embedding|tts|audio|image|live|robotics|computer-use/i.test(id)) models.push({ id, name: item.displayName || id });
      }
      pageToken = result.nextPageToken || '';
    } else {
      for (const item of result.data || []) {
        const id = String(item.id || '');
        if (/^(gpt-4o|gpt-4\.1|gpt-5)/.test(id) && !/audio|realtime|search|transcribe|tts/i.test(id)) models.push({ id, name: id });
      }
      pageToken = '';
    }
    if (!pageToken) break;
  }
  const unique = [...new Map(models.filter(item => /^[a-zA-Z0-9._-]{1,100}$/.test(item.id)).map(item => [item.id, item])).values()];
  unique.sort((a, b) => Number(/flash/i.test(b.id)) - Number(/flash/i.test(a.id)) || a.id.localeCompare(b.id));
  return { provider: config.provider, models: unique };
}
