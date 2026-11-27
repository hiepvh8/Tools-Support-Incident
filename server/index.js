import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReply, matchAlerts, analyzeIncident } from './assistant.js';
import { importWorkbook } from './import-workbook.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databasePath = process.env.NOC_DB_PATH || path.join(root, 'data', 'noc.db');
mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier INTEGER NOT NULL, primary_contact TEXT NOT NULL DEFAULT '', backup_contact TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS markets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '', pmo TEXT NOT NULL DEFAULT '', devops TEXT NOT NULL DEFAULT '', backup TEXT NOT NULL DEFAULT '', techops TEXT NOT NULL DEFAULT '', noc TEXT NOT NULL DEFAULT '', escalation TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, pattern TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '', market_id INTEGER REFERENCES markets(id) ON DELETE RESTRICT, service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT, team TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', steps TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL, service_id INTEGER, service_name TEXT NOT NULL DEFAULT '', market_id INTEGER, market_name TEXT NOT NULL DEFAULT '', severity TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_bulletin_at TEXT);
  CREATE TABLE IF NOT EXISTS context_learning (signature TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (signature, field));
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', mode TEXT, created_at TEXT NOT NULL);
`);
for (const [table, column, definition] of [
  ['services', 'dba', "TEXT NOT NULL DEFAULT ''"],
  ['services', 'aliases', "TEXT NOT NULL DEFAULT ''"],
  ['incidents', 'analysis_text', "TEXT NOT NULL DEFAULT ''"],
  ['incidents', 'auto_context', "TEXT NOT NULL DEFAULT '{}'"],
  ['incidents', 'manual_fields', "TEXT NOT NULL DEFAULT '[]'"],
]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
const defaultSettings = {
  actions: ['Liên hệ Dev PIC, DevOps và PMO phù hợp; kích hoạt War Room nếu cần.', 'Hoàn thiện thông tin và đăng bản tin lên KEEP THE F LIGHTS ON.', 'Kiểm tra log, metrics, phạm vi ảnh hưởng và thống nhất thời điểm cập nhật.'],
  questions: ['Lỗi bắt đầu lúc nào?', 'Phạm vi và tỷ lệ ảnh hưởng là bao nhiêu?', 'Có thay đổi hoặc triển khai gần đây không?'],
};
const getSettings = () => {
  const saved = db.prepare("SELECT value FROM metadata WHERE key = 'coordination_settings'").get();
  return saved ? JSON.parse(saved.value) : defaultSettings;
};
if (!db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
  const privateSeed = path.join(root, 'server', 'seed.json');
  const seedPath = existsSync(privateSeed) ? privateSeed : path.join(root, 'server', 'seed.example.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  db.exec('BEGIN');
  try {
    const addService = db.prepare('INSERT INTO services (name, tier, primary_contact, backup_contact) VALUES (?, ?, ?, ?)');
    const addMarket = db.prepare('INSERT INTO markets (name, aliases, pmo, devops, backup, techops, noc, escalation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    seed.services.forEach(s => addService.run(s.name, s.tier, s.primary_contact, s.backup_contact));
    seed.markets.forEach(m => addMarket.run(m.name, m.aliases, m.pmo, m.devops, m.backup, m.techops, m.noc, m.escalation));
    db.prepare("INSERT INTO metadata (key, value) VALUES ('seeded', '1')").run();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const app = express();
app.use(express.json({ limit: '25mb' }));
const getServices = () => db.prepare('SELECT * FROM services ORDER BY name COLLATE NOCASE').all();
const getMarkets = () => db.prepare('SELECT * FROM markets ORDER BY name COLLATE NOCASE').all();
const alertSelect = `SELECT alerts.*, markets.name AS market_name, services.name AS service_name FROM alerts LEFT JOIN markets ON alerts.market_id = markets.id LEFT JOIN services ON alerts.service_id = services.id`;
const getAlerts = () => db.prepare(`${alertSelect} ORDER BY alerts.id DESC`).all();
const getIncidents = () => db.prepare('SELECT * FROM incidents ORDER BY updated_at DESC LIMIT 100').all();
const getIncident = id => db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
const getMessages = id => db.prepare('SELECT * FROM messages WHERE incident_id = ? ORDER BY rowid').all(id).map(message => ({ ...message, attachments: JSON.parse(message.attachments) }));
const text = value => typeof value === 'string' ? value.trim() : '';
const validId = value => value === null || value === undefined || value === '' ? null : Number(value);
function normalize(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function inferContext(content) {
  const normalized = ` ${normalize(content)} `;
  const services = getServices().filter(service => [service.name, ...(service.aliases || '').split('\n')].some(alias => normalize(alias).length >= 5 && normalized.includes(` ${normalize(alias)} `)));
  const distinctServices = services.filter(service => !services.some(other => other.id !== service.id && normalize(other.name).length > normalize(service.name).length && normalize(other.name).includes(normalize(service.name))));
  const markets = getMarkets().filter(market => market.aliases.split(',').some(alias => {
    const trimmed = alias.trim();
    if (trimmed.length <= 2) return new RegExp(`(^|[^A-Za-z0-9])${trimmed}([^A-Za-z0-9]|$)`).test(content);
    return normalized.includes(` ${normalize(trimmed)} `);
  }));
  return { service: distinctServices.length === 1 ? distinctServices[0] : null, market: markets.length === 1 ? markets[0] : null };
}
const bad = (res, message, code = 400) => res.status(code).json({ error: message });

app.get('/api/bootstrap', (_req, res) => res.json({ services: getServices(), markets: getMarkets(), alerts: getAlerts(), incidents: getIncidents(), settings: getSettings(), ai: { enabled: Boolean(process.env.OPENAI_API_KEY) } }));
app.put('/api/settings', (req, res) => {
  const clean = list => Array.isArray(list) ? list.map(text).filter(Boolean) : [];
  const actions = clean(req.body.actions), questions = clean(req.body.questions);
  if (actions.length !== 3 || !questions.length || [...actions, ...questions].some(item => item.length > 1000)) return bad(res, 'Nhập đúng 3 việc tiếp theo và ít nhất một câu hỏi điều phối.');
  const settings = { actions, questions };
  db.prepare("INSERT INTO metadata (key, value) VALUES ('coordination_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(settings));
  res.json({ settings });
});
app.put('/api/ai-key', (req, res) => {
  const address = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return bad(res, 'Chỉ có thể cấu hình AI từ máy đang chạy ứng dụng.', 403);
  const key = text(req.body.key);
  if (!key || key.length > 512 || /\s/.test(key)) return bad(res, 'Khóa AI không hợp lệ.');
  process.env.OPENAI_API_KEY = key;
  res.json({ enabled: true });
});
app.post('/api/import-workbook', async (req, res) => {
  const encoded = req.body.file;
  if (typeof encoded !== 'string' || encoded.length > 7_000_000 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return bad(res, 'Tệp Excel không hợp lệ hoặc lớn hơn 5 MB.');
  try { res.json(await importWorkbook(db, Buffer.from(encoded, 'base64'))); }
  catch (error) { console.error('Workbook import:', error.message); return bad(res, 'Không thể nhập tệp Excel. Hãy kiểm tra định dạng Phụ lục 01 và 02.'); }
});
app.get('/api/incidents/:id', (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) return bad(res, 'Không tìm thấy sự cố.', 404);
  res.json({ incident, messages: getMessages(incident.id) });
});
app.delete('/api/incidents/:id', (req, res) => {
  if (activeIncidents.has(req.params.id)) return bad(res, 'Đang xử lý yêu cầu cho sự cố này.', 409);
  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

const fields = {
  services: ['name', 'tier', 'primary_contact', 'backup_contact', 'dba', 'aliases'],
  markets: ['name', 'aliases', 'pmo', 'devops', 'backup', 'techops', 'noc', 'escalation'],
  alerts: ['title', 'pattern', 'keywords', 'market_id', 'service_id', 'team', 'contact', 'steps'],
};
function validateRecord(kind, body) {
  const record = {};
  for (const field of fields[kind]) record[field] = field.endsWith('_id') ? validId(body[field]) : field === 'tier' ? Number(body[field]) : text(body[field]);
  if (kind === 'services' && (!record.name || ![1, 2, 3].includes(record.tier))) return { error: 'Vui lòng nhập tên dịch vụ và chọn Tier.' };
  if (kind === 'markets' && !record.name) return { error: 'Vui lòng nhập tên thị trường.' };
  if (kind === 'alerts') {
    if (!record.title || !record.pattern || !record.steps) return { error: 'Vui lòng nhập tên alert, nội dung mẫu và hướng xử lý.' };
    if (record.market_id && !db.prepare('SELECT id FROM markets WHERE id = ?').get(record.market_id)) return { error: 'Thị trường không hợp lệ.' };
    if (record.service_id && !db.prepare('SELECT id FROM services WHERE id = ?').get(record.service_id)) return { error: 'Dịch vụ không hợp lệ.' };
  }
  if (Object.values(record).some(value => typeof value === 'number' && !Number.isFinite(value))) return { error: 'Dữ liệu không hợp lệ.' };
  return { record };
}
app.post(['/api/services', '/api/markets', '/api/alerts'], (req, res) => {
  const kind = req.path.split('/')[2];
  const { record, error } = validateRecord(kind, req.body);
  if (error) return bad(res, error);
  const keys = [...fields[kind]];
  const values = keys.map(key => record[key]);
  if (kind === 'alerts') { keys.push('created_at'); values.push(new Date().toISOString()); }
  const result = db.prepare(`INSERT INTO ${kind} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...values);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.put(['/api/services/:id', '/api/markets/:id', '/api/alerts/:id'], (req, res) => {
  const kind = req.path.split('/')[2];
  const { id } = req.params;
  if (!db.prepare(`SELECT id FROM ${kind} WHERE id = ?`).get(id)) return bad(res, 'Không tìm thấy dữ liệu.', 404);
  const { record, error } = validateRecord(kind, req.body);
  if (error) return bad(res, error);
  const keys = fields[kind];
  db.prepare(`UPDATE ${kind} SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(key => record[key]), id);
  res.json({ ok: true });
});
app.delete(['/api/services/:id', '/api/markets/:id', '/api/alerts/:id'], (req, res) => {
  const kind = req.path.split('/')[2];
  const { id } = req.params;
  if ((kind === 'services' || kind === 'markets') && db.prepare(`SELECT id FROM alerts WHERE ${kind === 'services' ? 'service_id' : 'market_id'} = ? LIMIT 1`).get(id)) {
    return bad(res, 'Dữ liệu đang được một alert sử dụng. Hãy cập nhật alert trước khi xóa.', 409);
  }
  if (kind === 'services' || kind === 'markets') {
    const column = kind === 'services' ? 'service_id' : 'market_id';
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE incidents SET ${column} = NULL WHERE ${column} = ?`).run(id);
      db.prepare('DELETE FROM context_learning WHERE field = ? AND value = ?').run(column, String(id));
      db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } else db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.post('/api/match-alert', async (req, res) => {
  const query = text(req.body.query);
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(validId(req.body.market_id));
  if (!query || !market) return bad(res, 'Vui lòng nhập alert và chọn thị trường.');
  const rules = db.prepare(`${alertSelect} WHERE alerts.market_id IS NULL OR alerts.market_id = ? ORDER BY alerts.id DESC`).all(market.id);
  res.json(await matchAlerts(query, market, rules));
});

const fieldsForContext = ['service_id', 'market_id', 'severity', 'scope'];
function learnedSignatures(content, matchText) {
  const exact = normalize(content || '');
  const phrase = normalize(matchText || '');
  const signatures = [];
  if (exact.length >= 8) signatures.push(`exact:${exact}`);
  if (phrase.length >= 8 && phrase.split(' ').length >= 2) signatures.push(`phrase:${phrase}`);
  return signatures;
}
function recordLearning(signatures, field, value, original) {
  signatures = signatures.filter(signature => field === 'service_id' || signature.startsWith('exact:'));
  if (!value || String(value) === String(original || '')) {
    const remove = db.prepare('DELETE FROM context_learning WHERE signature = ? AND field = ?');
    signatures.forEach(signature => remove.run(signature, field));
    return;
  }
  const put = db.prepare('INSERT INTO context_learning (signature, field, value) VALUES (?, ?, ?) ON CONFLICT(signature, field) DO UPDATE SET value = excluded.value');
  signatures.forEach(signature => put.run(signature, field, String(value)));
}
function isValidContext(field, value) {
  if (!value) return true;
  if (field === 'service_id') return Boolean(db.prepare('SELECT id FROM services WHERE id = ?').get(validId(value)));
  if (field === 'market_id') return Boolean(db.prepare('SELECT id FROM markets WHERE id = ?').get(validId(value)));
  if (field === 'severity') return ['P1', 'P2', 'P3', 'P4'].includes(value);
  return field === 'scope' && ['internal', 'external'].includes(value);
}
async function analyze(content, attachments) {
  const inferred = inferContext(content);
  const priorities = [...new Set((content.match(/\bP[1-4]\b/gi) || []).map(item => item.toUpperCase()))];
  const result = await analyzeIncident({ text: content, attachments, services: getServices(), markets: getMarkets() });
  const fields = { service_id: inferred.service?.id || null, market_id: inferred.market?.id || null, severity: priorities.length === 1 ? priorities[0] : null, scope: null, ...Object.fromEntries(Object.entries(result.fields).filter(([, value]) => value)) };
  const exact = learnedSignatures(content, '').find(signature => signature.startsWith('exact:'));
  const exactRows = exact ? db.prepare('SELECT field, value FROM context_learning WHERE signature = ?').all(exact) : [];
  const normalizedInput = ` ${normalize(`${content} ${result.match_text}`)} `;
  const candidates = db.prepare("SELECT signature, value FROM context_learning WHERE field = 'service_id' AND signature LIKE 'phrase:%'").all()
    .filter(row => normalizedInput.includes(` ${row.signature.slice(7)} `) && isValidContext('service_id', row.value));
  const candidateIds = [...new Set(candidates.map(row => row.value))];
  if (candidateIds.length === 1) fields.service_id = Number(candidateIds[0]);
  for (const row of exactRows) {
    if (fieldsForContext.includes(row.field) && isValidContext(row.field, row.value)) fields[row.field] = row.field.endsWith('_id') ? Number(row.value) : row.value;
  }
  return { ...result, fields };
}
function validImages(attachments) {
  return Array.isArray(attachments) && attachments.length <= 4 && attachments.every(image => typeof image.name === 'string' && typeof image.data === 'string' && image.data.length <= 5_600_000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image.data));
}
app.post('/api/analyze-incident', async (req, res) => {
  const content = text(req.body.text), attachments = req.body.attachments || [];
  if ((!content && !attachments.length) || !validImages(attachments)) return bad(res, 'Thông tin hoặc ảnh không hợp lệ.');
  res.json(await analyze(content, attachments));
});
app.patch('/api/incidents/:id/context', (req, res) => {
  const incident = getIncident(req.params.id);
  if (!incident) return bad(res, 'Không tìm thấy sự cố.', 404);
  if (incident.status === 'closed' || activeIncidents.has(incident.id)) return bad(res, 'Không thể thay đổi sự cố lúc này.', 409);
  const { field, value } = req.body;
  if (!fieldsForContext.includes(field) || !isValidContext(field, value)) return bad(res, 'Thông tin không hợp lệ.');
  const service = field === 'service_id' && value ? db.prepare('SELECT * FROM services WHERE id = ?').get(validId(value)) : null;
  const market = field === 'market_id' && value ? db.prepare('SELECT * FROM markets WHERE id = ?').get(validId(value)) : null;
  const updates = {
    service_id: field === 'service_id' ? (service?.id || null) : incident.service_id,
    service_name: field === 'service_id' ? (service?.name || '') : incident.service_name,
    market_id: field === 'market_id' ? (market?.id || null) : incident.market_id,
    market_name: field === 'market_id' ? (market?.name || '') : incident.market_name,
    severity: field === 'severity' ? (value || 'UNKNOWN') : incident.severity,
    scope: field === 'scope' ? (value || 'unknown') : incident.scope,
  };
  const manual = [...new Set([...JSON.parse(incident.manual_fields), field])];
  const firstMessage = db.prepare("SELECT content FROM messages WHERE incident_id = ? AND role = 'user' ORDER BY rowid LIMIT 1").get(incident.id);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE incidents SET service_id=?, service_name=?, market_id=?, market_name=?, severity=?, scope=?, manual_fields=?, updated_at=? WHERE id=?').run(updates.service_id, updates.service_name, updates.market_id, updates.market_name, updates.severity, updates.scope, JSON.stringify(manual), new Date().toISOString(), incident.id);
    recordLearning(learnedSignatures(firstMessage?.content, incident.analysis_text), field, value, JSON.parse(incident.auto_context)[field]);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ incident: getIncident(incident.id) });
});

const activeIncidents = new Set();
app.post('/api/chat', async (req, res) => {
  const { action } = req.body;
  if (!['create', 'chat', 'update', 'close'].includes(action)) return bad(res, 'Thao tác không hợp lệ.');
  const content = text(req.body.text);
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
  if (!content && !attachments.length) return bad(res, 'Hãy nhập thông tin hoặc đính kèm ảnh.');
  if (!validImages(attachments)) return bad(res, 'Chỉ hỗ trợ tối đa 4 ảnh PNG, JPG, WEBP hoặc GIF, mỗi ảnh không quá 4 MB.');
  if (action === 'close' && !req.body.confirmed) return bad(res, 'Hãy xác nhận sự cố đã khôi phục trước khi đóng.');
  let incident = req.body.incident_id ? getIncident(req.body.incident_id) : null;
  if (req.body.incident_id && !incident) return bad(res, 'Không tìm thấy sự cố.', 404);
  if (!incident && action !== 'create') return bad(res, 'Hãy tạo sự cố trước.');
  if (incident && action === 'create') return bad(res, 'Phiên này đã được tạo. Hãy tiếp tục cập nhật hoặc mở sự cố mới.');
  if (incident?.status === 'closed') return bad(res, 'Sự cố đã đóng. Hãy mở sự cố mới.');
  const analysis = action === 'create' ? (req.body.analysis || await analyze(content, attachments)) : { fields: {}, match_text: '' };
  const locked = new Set(action === 'create' ? (Array.isArray(req.body.manual_fields) ? req.body.manual_fields : []) : JSON.parse(incident.manual_fields || '[]'));
  const mentionedPriorities = [...new Set((content.match(/\bP[1-4]\b/gi) || []).map(value => value.toUpperCase()))];
  const severity = locked.has('severity') && !req.body.severity ? 'UNKNOWN' : ['P1', 'P2', 'P3', 'P4'].includes(req.body.severity) ? req.body.severity : ['P1', 'P2', 'P3', 'P4'].includes(analysis.fields?.severity) ? analysis.fields.severity : mentionedPriorities.length === 1 ? mentionedPriorities[0] : 'UNKNOWN';
  const scope = locked.has('scope') && !req.body.scope ? 'unknown' : ['internal', 'external'].includes(req.body.scope) ? req.body.scope : ['internal', 'external'].includes(analysis.fields?.scope) ? analysis.fields.scope : 'unknown';
  const inferred = inferContext(content);
  const serviceId = locked.has('service_id') && !req.body.service_id ? null : validId(req.body.service_id) || (isValidContext('service_id', analysis.fields?.service_id) ? validId(analysis.fields?.service_id) : null) || inferred.service?.id || null;
  const marketId = locked.has('market_id') && !req.body.market_id ? null : validId(req.body.market_id) || (isValidContext('market_id', analysis.fields?.market_id) ? validId(analysis.fields?.market_id) : null) || inferred.market?.id || null;
  const service = serviceId ? db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId) : null;
  const market = marketId ? db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId) : null;
  if ((serviceId && !service) || (marketId && !market)) return bad(res, 'Dịch vụ hoặc thị trường không hợp lệ.');
  if (action === 'close' && (['P3', 'P4'].includes(severity) || ['P3', 'P4'].includes(incident?.severity)) && (!req.body.technical_confirmed || !req.body.business_confirmed)) return bad(res, 'Hãy xác nhận kiểm chứng kỹ thuật và nghiệp vụ trước khi đóng War Room.');
  const now = new Date().toISOString();
  if (!incident) {
    incident = { id: randomUUID(), title: content.slice(0, 90) || 'Sự cố từ hình ảnh', service_id: serviceId, service_name: service?.name || '', market_id: marketId, market_name: market?.name || '', severity, scope, status: 'open', created_at: now, updated_at: now, last_bulletin_at: null };
    db.prepare('INSERT INTO incidents (id, title, service_id, service_name, market_id, market_name, severity, scope, status, created_at, updated_at, last_bulletin_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(incident));
  }
  if (activeIncidents.has(incident.id)) return bad(res, 'Đang xử lý yêu cầu trước đó. Vui lòng chờ.', 409);
  activeIncidents.add(incident.id);
  try {
    const current = { ...incident, service_id: serviceId, service_name: service?.name || incident.service_name || '', market_id: marketId, market_name: market?.name || incident.market_name || '', severity, scope };
    const result = await generateReply({ action, text: content, attachments, incident: current, service, market, history: getMessages(incident.id), directory: { services: getServices(), markets: getMarkets() }, settings: getSettings() });
    const completed = new Date().toISOString();
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT INTO messages (id, incident_id, role, content, attachments, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      insert.run(randomUUID(), incident.id, 'user', content, JSON.stringify(attachments), action, now);
      insert.run(randomUUID(), incident.id, 'assistant', result.content, '[]', result.mode, completed);
      const manual = action === 'create' && Array.isArray(req.body.manual_fields) ? req.body.manual_fields.filter(field => fieldsForContext.includes(field)) : JSON.parse(incident.manual_fields || '[]');
      const autoContext = action === 'create' ? (analysis.fields || {}) : JSON.parse(incident.auto_context || '{}');
      const analysisText = action === 'create' ? String(analysis.match_text || '').slice(0, 160) : incident.analysis_text || '';
      db.prepare('UPDATE incidents SET service_id = ?, service_name = ?, market_id = ?, market_name = ?, severity = ?, scope = ?, status = ?, updated_at = ?, last_bulletin_at = ?, auto_context = ?, analysis_text = ?, manual_fields = ? WHERE id = ?').run(serviceId, current.service_name, marketId, current.market_name, severity, scope, action === 'close' ? 'closed' : 'open', completed, ['create', 'update', 'close'].includes(action) ? completed : incident.last_bulletin_at, JSON.stringify(autoContext), analysisText, JSON.stringify(manual), incident.id);
      if (action === 'create') for (const field of manual) recordLearning(learnedSignatures(content, analysisText), field, req.body[field], autoContext[field]);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ incident: getIncident(incident.id), messages: getMessages(incident.id), mode: result.mode, error: result.error });
  } finally { activeIncidents.delete(incident.id); }
});

if (existsSync(path.join(root, 'dist'))) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status === 413 ? 'Dữ liệu gửi lên quá lớn.' : 'Có lỗi xảy ra. Vui lòng thử lại.' });
});
const port = Number(process.env.PORT || 3001);
app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`NOC Workspace listening on port ${port}`));
