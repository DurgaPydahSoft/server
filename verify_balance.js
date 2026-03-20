import dotenv from 'dotenv';
dotenv.config();
import { checkBalance } from './src/utils/smsService.js';

async function verify() {
  console.log('Testing BulkSMS balance check...');
  try {
    const balance = await checkBalance();
    console.log('Successfully fetched balance:', balance);
  } catch (error) {
    console.error('Failed to fetch balance:', error.message);
  }
}

verify();
