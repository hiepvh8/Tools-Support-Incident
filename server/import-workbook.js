import ExcelJS from 'exceljs';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const value = cell => {
  const text = String(cell.text ?? '').replace(/\u00a0/g, ' ').trim();
  return !text || /^[\\/\-\s]+$/.test(text) ? '' : text;
};
const marketNames = ['VN / Lào', 'Ấn Độ', 'Kazakhstan', 'Châu Âu (EU)', 'Philippines', 'Indonesia', 'Mỹ (US)', 'CIS'];

export async function importWorkbook(db, buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const serviceSheet = workbook.worksheets.find(sheet => /phụ lục 01/i.test(sheet.name));
  const marketSheet = workbook.worksheets.find(sheet => /phụ lục 02/i.test(sheet.name));
  if (!serviceSheet || !marketSheet) throw new Error('Không tìm thấy Phụ lục 01 và Phụ lục 02 trong tệp.');
  const serviceHeader = serviceSheet.getRow(8);
  if (!/service/i.test(value(serviceHeader.getCell(2))) || !/tier/i.test(value(serviceHeader.getCell(4)))) throw new Error('Không tìm thấy cột dịch vụ trong tệp.');
  const rows = [];
  serviceSheet.eachRow((row, index) => {
    if (index <= 8 || !/^\d+$/.test(value(row.getCell(1)))) return;
    const name = value(row.getCell(2));
    if (!name) return;
    const tier = Number(value(row.getCell(4)).match(/tier\s*([123])/i)?.[1]) || null;
    rows.push({ name, tier, aliases: value(row.getCell(5)), primary: value(row.getCell(6)), backup: value(row.getCell(7)), dba: value(row.getCell(8)) });
  });
  const markets = [];
  marketSheet.eachRow((row, index) => {
    if (index <= 3 || !value(row.getCell(2))) return;
    const rawName = normalize(value(row.getCell(2)));
    const market = marketNames.find(name => rawName === normalize(name) || rawName.startsWith(normalize(name) + ' '));
    if (!market) return;
    const devopsParts = value(row.getCell(5)).split(/\s*-?\s*Backup\s*:\s*/i);
    markets.push({ name: market, pmo: value(row.getCell(3)), techops: value(row.getCell(4)), devops: devopsParts[0].trim(), backup: devopsParts.slice(1).join(' ').trim(), noc: value(row.getCell(6)).length > 1 ? value(row.getCell(6)) : '', escalation: value(row.getCell(10)) });
  });
  if (!rows.length || !markets.length) throw new Error('Không tìm thấy dữ liệu dịch vụ và thị trường hợp lệ.');
  const existing = db.prepare('SELECT * FROM services').all();
  const existingMarkets = db.prepare('SELECT * FROM markets').all();
  const updateService = db.prepare('UPDATE services SET tier = ?, primary_contact = ?, backup_contact = ?, dba = ?, aliases = ? WHERE id = ?');
  const addService = db.prepare('INSERT INTO services (name, tier, primary_contact, backup_contact, dba, aliases) VALUES (?, ?, ?, ?, ?, ?)');
  const updateMarket = db.prepare('UPDATE markets SET pmo = ?, devops = ?, backup = ?, techops = ?, noc = ?, escalation = ? WHERE id = ?');
  let updatedServices = 0, newServices = 0, updatedMarkets = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      let matches = existing.filter(item => normalize(item.name) === normalize(row.name));
      if (!matches.length && row.name.includes(' / ')) {
        const parts = row.name.split(/\s+\/\s+/).map(normalize);
        matches = existing.filter(item => parts.includes(normalize(item.name)));
        if (matches.length !== parts.length) matches = [];
      }
      if (!matches.length) {
        if (!row.tier) { skipped++; continue; }
        const result = addService.run(row.name, row.tier, row.primary, row.backup, row.dba, row.aliases);
        existing.push({ id: Number(result.lastInsertRowid), name: row.name, tier: row.tier, primary_contact: row.primary, backup_contact: row.backup, dba: row.dba, aliases: row.aliases });
        newServices++;
      } else for (const item of matches) {
        const aliases = (item.aliases || '').split('\n').filter(Boolean);
        if (row.aliases && !aliases.some(alias => normalize(alias) === normalize(row.aliases))) aliases.push(row.aliases);
        updateService.run(row.tier || item.tier, row.primary || item.primary_contact, row.backup || item.backup_contact, row.dba || item.dba || '', aliases.join('\n'), item.id);
        item.aliases = aliases.join('\n');
        Object.assign(item, { tier: row.tier || item.tier, primary_contact: row.primary || item.primary_contact, backup_contact: row.backup || item.backup_contact, dba: row.dba || item.dba || '' });
        updatedServices++;
      }
    }
    for (const row of markets) {
      const item = existingMarkets.find(market => normalize(market.name) === normalize(row.name));
      if (!item) { skipped++; continue; }
      updateMarket.run(row.pmo || item.pmo, row.devops || item.devops, row.backup || item.backup, row.techops || item.techops, row.noc || item.noc, row.escalation || item.escalation, item.id);
      updatedMarkets++;
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { updatedServices, newServices, updatedMarkets, skipped };
}
