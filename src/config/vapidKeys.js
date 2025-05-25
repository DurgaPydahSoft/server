import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const getVapidKeys = () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    console.error('VAPID keys not found in environment variables');
    console.error('Please ensure VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set in your .env file');
    throw new Error('VAPID keys not configured');
  }

  return {
    publicKey,
    privateKey
  };
};

export { getVapidKeys };

export const vapidKeys = getVapidKeys();

export const webPushConfig = {
  subject: process.env.VAPID_SUBJECT || 'mailto:durgaprasad@pydahsoft.in',
  publicKey: vapidKeys.publicKey,
  privateKey: vapidKeys.privateKey
};

// Log configuration (without private key)
console.log('VAPID Configuration:', {
  subject: webPushConfig.subject,
  publicKey: webPushConfig.publicKey ? 'Set' : 'Not Set',
  privateKey: webPushConfig.privateKey ? 'Set' : 'Not Set'
}); 