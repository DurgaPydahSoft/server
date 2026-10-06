import { fetchBranchesFromSQL } from './src/utils/sqlService.js';

const result = await fetchBranchesFromSQL();
if (!result.success) {
  console.error(result.error);
  process.exit(1);
}

const rows = result.data.filter(row =>
  `${row.course_name || ''} ${row.name || ''}`.toLowerCase().includes('rural')
);

console.log(JSON.stringify(rows.map(row => ({
  id: row.id,
  course: row.course_name,
  branch: row.name,
  metadata: row.metadata,
})), null, 2));
