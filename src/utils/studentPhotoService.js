/**
 * Format student_photo from SDMS (MySQL) for API / UI display.
 */
export const formatSqlStudentPhoto = (raw) => {
  if (raw == null || raw === '') return null;

  // Binary BLOB (JPEG/PNG bytes) from MySQL
  if (Buffer.isBuffer(raw) || (typeof raw === 'object' && raw.type === 'Buffer' && Array.isArray(raw.data))) {
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.data);
    if (buffer.length === 0) return null;

    // Already stored as text (data URL or base64) inside a Buffer
    const asUtf8 = buffer.toString('utf8').trim();
    if (asUtf8.startsWith('data:image')) return asUtf8;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(asUtf8.slice(0, 200)) && asUtf8.length > 100) {
      return `data:image/jpeg;base64,${asUtf8.replace(/\s/g, '')}`;
    }

    // Raw image bytes
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const mime = isPng ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  let value = String(raw).trim();
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
