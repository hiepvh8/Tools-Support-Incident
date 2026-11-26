import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePath = process.argv[2];
const databasePath = process.env.NOC_DB_PATH || path.join(root, 'data', 'noc.db');

if (!sourcePath || !existsSync(sourcePath)) {
  console.error('Cung cấp đường dẫn đến tệp văn bản danh bạ. Ví dụ: npm run import-contacts -- /path/to/file.txt');
  process.exit(1);
}
if (!existsSync(databasePath)) {
  console.error('Chưa có cơ sở dữ liệu. Hãy khởi động ứng dụng một lần trước khi nhập danh bạ.');
  process.exit(1);
}
const source = readFileSync(sourcePath, 'utf8');
const serviceStart = source.indexOf('A. DANH SÁCH 90 DỊCH VỤ');
const marketStart = source.indexOf('B. DANH SÁCH CONTACT THEO THỊ TRƯỜNG');
const marketEnd = source.indexOf('C. CÁC FROM BẢN TIN', marketStart);
if (serviceStart < 0 || marketStart <= serviceStart || marketEnd <= marketStart) {
  console.error('Không tìm thấy các mục dịch vụ và thị trường trong tệp.');
  process.exit(1);
}

const services = [];
for (const line of source.slice(serviceStart, marketStart).split(/\r?\n/)) {
  const match = line.match(/^\d+\. (.*?) \| Tier (\d) \| Oncall: (.*?)(?: \| Backup: (.*))?$/);
  if (match) services.push({ name: match[1], tier: Number(match[2]), primary_contact: match[3], backup_contact: match[4] || '' });
}
const marketNames = ['VN / Lào', 'Ấn Độ', 'Kazakhstan', 'Châu Âu (EU)', 'Philippines', 'Indonesia', 'Mỹ (US)', 'CIS'];
const marketAliases = ['VN, Việt Nam, Vietnam, Lào, Laos, LA', 'Ấn Độ, India, IN', 'Kazakhstan, KZ', 'Châu Âu, Europe, EU, NL, DK, Đan Mạch, Hà Lan', 'Philippines, PH', 'Indonesia, ID, IDN', 'Mỹ, US, USA', 'CIS'];
const roles = { PMO: 'pmo', DevOps: 'devops', TechOps: 'techops', NOC: 'noc', 'Escalation cố định': 'escalation' };
const markets = [];
for (const line of source.slice(marketStart, marketEnd).split(/\r?\n/)) {
  const heading = line.match(/\b([1-8])\. /);
  if (heading) {
    const index = Number(heading[1]) - 1;
    markets.push({ name: marketNames[index], aliases: marketAliases[index], pmo: '', devops: '', backup: '', techops: '', noc: '', escalation: '' });
    continue;
  }
  const contact = line.match(/^\* (PMO|DevOps|TechOps|NOC|Escalation cố định): (.*)$/);
  if (!contact || !markets.length) continue;
  let value = contact[2];
  if (contact[1] === 'DevOps' && value.includes(' | Backup: ')) {
    [value, markets.at(-1).backup] = value.split(' | Backup: ', 2);
  }
  markets.at(-1)[roles[contact[1]]] = value;
}
if (!services.length || !markets.length) {
  console.error('Không đọc được danh bạ từ tệp. Không có dữ liệu nào được thay đổi.');
  process.exit(1);
}

const db = new DatabaseSync(databasePath);
const findService = db.prepare('SELECT id FROM services WHERE name = ?');
const addService = db.prepare('INSERT INTO services (name, tier, primary_contact, backup_contact) VALUES (?, ?, ?, ?)');
const fillService = db.prepare(`UPDATE services SET
  primary_contact = CASE WHEN primary_contact IN ('', 'Đang cập nhật') THEN ? ELSE primary_contact END,
  backup_contact = CASE WHEN backup_contact = '' THEN ? ELSE backup_contact END WHERE id = ?`);
const findMarket = db.prepare('SELECT id FROM markets WHERE name = ?');
const addMarket = db.prepare('INSERT INTO markets (name, aliases, pmo, devops, backup, techops, noc, escalation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const fillMarket = db.prepare(`UPDATE markets SET
  pmo = CASE WHEN pmo = '' THEN ? ELSE pmo END,
  devops = CASE WHEN devops = '' THEN ? ELSE devops END,
  backup = CASE WHEN backup = '' THEN ? ELSE backup END,
  techops = CASE WHEN techops = '' THEN ? ELSE techops END,
  noc = CASE WHEN noc = '' THEN ? ELSE noc END,
  escalation = CASE WHEN escalation = '' THEN ? ELSE escalation END WHERE id = ?`);
db.exec('BEGIN');
try {
  for (const service of services) {
    const existing = findService.get(service.name);
    if (existing) fillService.run(service.primary_contact, service.backup_contact, existing.id);
    else addService.run(service.name, service.tier, service.primary_contact, service.backup_contact);
  }
  for (const market of markets) {
    const existing = findMarket.get(market.name);
    if (existing) fillMarket.run(market.pmo, market.devops, market.backup, market.techops, market.noc, market.escalation, existing.id);
    else addMarket.run(market.name, market.aliases, market.pmo, market.devops, market.backup, market.techops, market.noc, market.escalation);
  }
  db.exec('COMMIT');
  console.log(`Đã xử lý danh bạ của ${services.length} dịch vụ và ${markets.length} nhóm thị trường. Thông tin đã có được giữ nguyên.`);
} catch (error) {
  db.exec('ROLLBACK');
  console.error('Không thể nhập danh bạ:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
