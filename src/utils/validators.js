/**
 * Validates a phone number
 * @param {string} phone - The phone number to validate
 * @returns {boolean} - Whether the phone number is valid
 */
export const validatePhoneNumber = (phone) => {
  if (!phone) return true; // Phone is optional
  return /^[0-9]{10}$/.test(phone);
};

/**
 * Validates an email address
 * @param {string} email - The email to validate
 * @returns {boolean} - Whether the email is valid
 */
export const validateEmail = (email) => {
  if (!email) return false;
  return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
}; 