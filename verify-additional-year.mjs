import { mapSQLBranchToMongoFormat } from './src/utils/courseBranchMapper.js';

const row = {
  id: 46,
  course_id: 12,
  name: 'Agriculture & Rural Development',
  code: 'AGRI',
  metadata: { additionalYear: 4, hasAdditionalYear: true, additionalYearSemesters: 2 },
  is_active: 1,
  created_at: new Date(),
  updated_at: new Date(),
  course_name: 'B.Sc',
  course_code: 'BSC',
  college_name: 'Test College',
  college_code: 'TC',
};

const mapped = mapSQLBranchToMongoFormat(row);
console.log(JSON.stringify(mapped, null, 2));
if (!mapped.additionalYears.includes('4')) process.exit(1);
