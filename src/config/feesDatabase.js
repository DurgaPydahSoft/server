import mongoose from 'mongoose';

let feesConnection = null;
let connectPromise = null;

/**
 * Secondary MongoDB connection for the external Fees database (studentfees, fee heads).
 */
export const connectFeesDatabase = async () => {
  const uri = process.env.FEES_MONGODB_URI;
  if (!uri) {
    return null;
  }

  if (feesConnection?.readyState === 1) {
    return feesConnection;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      feesConnection = mongoose.createConnection(uri);
      await feesConnection.asPromise();
      console.log('✅ Connected to Fees MongoDB');
      return feesConnection;
    } catch (error) {
      console.error('❌ Fees MongoDB connection error:', error.message);
      feesConnection = null;
      throw error;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
};

export const getFeesConnection = () => feesConnection;

export const isFeesDbConfigured = () => Boolean(process.env.FEES_MONGODB_URI?.trim());
