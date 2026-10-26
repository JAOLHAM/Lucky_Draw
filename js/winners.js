/** One table row per participant who has won at least one prize. No database migration. */
export function buildWinnerRows(people, prizes, draws) {
  const peopleById = new Map(people.map(person => [person.id, person]));
  const prizesById = new Map(prizes.map(prize => [prize.id, prize]));
  const grouped = new Map();

  for (const draw of draws) {
    const person = peopleById.get(draw.participant_id);
    if (!person) continue;
    let row = grouped.get(person.id);
    if (!row) {
      row = {
        id: person.id,
        staff_code: person.staff_code || '',
        first_name: person.first_name || '',
        last_name: person.last_name || '',
        department: person.department || '',
        prizes: [],
        count: 0,
        latest_at: ''
      };
      grouped.set(person.id, row);
    }
    row.prizes.push(prizesById.get(draw.prize_id)?.name || '(รางวัลที่ไม่พบข้อมูล)');
    row.count += 1;
    if (!row.latest_at || String(draw.created_at || '') > row.latest_at) {
      row.latest_at = String(draw.created_at || '');
    }
  }
  return [...grouped.values()].sort((a, b) => b.latest_at.localeCompare(a.latest_at));
}

// CSV values are always quoted, Thai UTF-8 BOM is added when downloading.
// Prefix strings beginning with spreadsheet formula symbols to prevent execution.
export function csvCell(value) {
  let str = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(str)) str = "'" + str;
  return '"' + str.replaceAll('"', '""') + '"';
}

export function winnersCsv(rows) {
  const data = [
    ['รหัสประจำตัว', 'ชื่อ', 'นามสกุล', 'แผนก', 'ของรางวัลที่ได้รับ', 'จำนวนรางวัล', 'ได้รับล่าสุด'],
    ...rows.map(row => [
      row.staff_code,
      row.first_name,
      row.last_name,
      row.department,
      row.prizes.join(', '),
      row.count,
      row.latest_at ? new Date(row.latest_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''
    ])
  ];
  return '\uFEFF' + data.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
