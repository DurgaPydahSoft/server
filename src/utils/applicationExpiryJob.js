import { processDueApplicationExpiries } from './applicationExpiryService.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const TARGET_HOUR_IST = 2;

const getMsUntilNextRun = () => {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const next = new Date(istNow);
  next.setUTCHours(TARGET_HOUR_IST, 0, 0, 0);

  if (istNow.getTime() >= next.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  const nextUtc = new Date(next.getTime() - IST_OFFSET_MS);
  return Math.max(nextUtc.getTime() - now.getTime(), 0);
};

export const runApplicationExpiryJob = async () => {
  try {
    console.log('📅 Running application expiry job...');
    const result = await processDueApplicationExpiries();
    console.log(`📅 Application expiry job done: ${result.expired}/${result.processed} expired, ${result.nocDeactivated || 0} NOCs processed`);
    return result;
  } catch (error) {
    console.error('📅 Application expiry job failed:', error);
    throw error;
  }
};

export const scheduleApplicationExpiryProcessing = () => {
  const scheduleNext = () => {
    const delay = getMsUntilNextRun();
    setTimeout(async () => {
      await runApplicationExpiryJob();
      scheduleNext();
    }, delay);
  };

  scheduleNext();
  console.log('📅 Application expiry job scheduled (daily ~02:00 IST)');
};

export default {
  runApplicationExpiryJob,
  scheduleApplicationExpiryProcessing
};
