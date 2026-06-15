/**
 * Format student_photo from SDMS (MySQL) for API / UI display.
 */
export const formatSqlStudentPhoto = (raw) => {
  if (raw == null || raw === '') return null;

  let value = raw;
  if (Buffer.isBuffer(raw)) {
    value = raw.toString('utf8');
  } else if (typeof raw === 'object' && raw.type === 'Buffer' && Array.isArray(raw.data)) {
    value = Buffer.from(raw.data).toString('utf8');
  } else {
    value = String(raw).trim();
  }

  if (!value) return null;
  if (value.startsWith('data:image')) return value;
  if (value.length > 100) return `data:image/jpeg;base64,${value}`;
  return value;
};

/**
 * Prefer SDMS photo; fall back to legacy Mongo/S3 URL when SDMS has none.
 */
export const resolveStudentPhotoDisplay = (sqlPhoto, mongoPhoto) =>
  formatSqlStudentPhoto(sqlPhoto) || mongoPhoto || null;

/**
 * Normalize photo for admit cards / PDF export (data URL or fetch remote URL).
 */
export const photoToBase64ForExport = async (photo, fetchRemote) => {
  if (!photo) return null;
  if (photo.startsWith('data:image')) return photo;
  if (typeof fetchRemote === 'function') {
    return fetchRemote(photo);
  }
  return null;
};
