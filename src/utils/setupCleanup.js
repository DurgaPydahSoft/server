import { runMenuImageCleanup } from '../controllers/menuController.js';

// Set up automatic cleanup to run every 3 days
export const setupMenuImageCleanup = () => {
  // Run cleanup every 3 days instead of daily
  const CLEANUP_INTERVAL = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds
  
  const runCleanup = () => {
    const now = new Date();
    console.log(`🧹 Scheduled menu image cleanup running at ${now.toISOString()}`);
    runMenuImageCleanup();
  };
  
  // Run initial cleanup after 6 hours instead of 1 hour
  setTimeout(runCleanup, 6 * 60 * 60 * 1000);
  
  // Set up recurring cleanup every 3 days
  setInterval(runCleanup, CLEANUP_INTERVAL);
  
  console.log('🧹 Menu image cleanup scheduled to run every 3 days (10+ days old images)');
};

// Manual cleanup function for testing
export const manualCleanup = async () => {
  try {
    console.log('🧹 Running manual menu image cleanup...');
    await runMenuImageCleanup();
    console.log('🧹 Manual cleanup completed');
  } catch (error) {
    console.error('Error in manual cleanup:', error);
  }
}; 