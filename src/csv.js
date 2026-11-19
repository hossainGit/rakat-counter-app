/** Rows of flat objects → CSV with a header from the first row's keys. */
export function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join(','), ...rows.map(r => keys.map(k => r[k]).join(','))].join('\n');
}
