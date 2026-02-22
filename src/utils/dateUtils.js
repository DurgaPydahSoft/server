/**
 * Centralized utility for IST (India Standard Time) date manipulations.
 * IST is UTC+5:30.
 */

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

/**
 * Gets the start of the day in IST for a given date string (YYYY-MM-DD),
 * and returns it as a UTC Date object.
 */
export const getISTStartOfDay = (dateString) => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  // Create UTC date at midnight
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // Subtract offset to get the UTC time that corresponds to IST midnight
  return new Date(utcDate.getTime() - IST_OFFSET);
};

/**
 * Gets the end of the day in IST for a given date string (YYYY-MM-DD),
 * and returns it as a UTC Date object.
 */
export const getISTEndOfDay = (dateString) => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  // Create UTC date at 23:59:59.999
  const utcDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  // Subtract offset
  return new Date(utcDate.getTime() - IST_OFFSET);
};

/**
 * Gets the current time in IST.
 */
export const getISTNow = () => {
  return new Date(Date.now() + IST_OFFSET);
};

/**
 * Normalizes any date to the start of its day in IST, returned as UTC.
 */
export const normalizeToISTStartOfDay = (date) => {
  if (!date) return null;
  const d = new Date(date);
  const istDate = new Date(d.getTime() + IST_OFFSET);
  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const day = istDate.getUTCDate();
  
  const midnightIST = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  return new Date(midnightIST.getTime() - IST_OFFSET);
};

/**
 * Checks if a date is before today in IST.
 */
export const isISTDateBeforeToday = (dateToCheck) => {
  const todayStart = normalizeToISTStartOfDay(new Date());
  const checkStart = normalizeToISTStartOfDay(dateToCheck);
  return checkStart < todayStart;
};
