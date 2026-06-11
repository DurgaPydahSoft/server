/**
 * Batch is stored as admission start year (e.g. "2024"), matching the SQL students table.
 */

export const normalizeBatchToYear = (batch) => {
  if (batch === null || batch === undefined || batch === '') return '';
  const trimmed = String(batch).trim();
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{4}$/.test(trimmed)) return trimmed.split('-')[0];
  return trimmed;
};

export const getBatchStartYear = (batch) => {
  const year = normalizeBatchToYear(batch);
  if (!/^\d{4}$/.test(year)) return null;
  const startYear = parseInt(year, 10);
  return Number.isNaN(startYear) ? null : startYear;
};

/** End calendar year for graduation checks; supports legacy YYYY-YYYY values. */
export const getBatchEndYear = (batch, courseDuration = 4) => {
  if (!batch) return null;
  const trimmed = String(batch).trim();
  if (/^\d{4}-\d{4}$/.test(trimmed)) {
    return parseInt(trimmed.split('-')[1], 10);
  }
  const startYear = getBatchStartYear(batch);
  if (startYear) return startYear + courseDuration;
  return null;
};
