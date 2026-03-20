import { checkBalance } from '../utils/smsService.js';
import { createError } from '../utils/error.js';

export const getSMSBalance = async (req, res, next) => {
  try {
    const balance = await checkBalance();
    
    // BulkSMS API usually returns a string with the balance directly
    // If it's a number-like string, we'll return it as is or structured
    res.json({
      success: true,
      data: {
        balance: balance
      }
    });
  } catch (error) {
    console.error('Error in getSMSBalance controller:', error);
    next(error);
  }
};
