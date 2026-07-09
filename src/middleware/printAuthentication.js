import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { createError } from '../utils/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define allowed internal apps and their permitted templates in code.
// The API key for each app is resolved dynamically from the environment using the pattern:
//   PRINT_API_KEY_{APPNAME_UPPERCASE}
// e.g. for app "admissions" → process.env.PRINT_API_KEY_ADMISSIONS
// The calling app identifies itself via the X-Source-Application header (set to PRINT_APP_NAME on the caller).
const AUTHORIZED_APPS = {
  'admissions': {
    allowedTemplates: ['hostel-admit', 'transport-admit']
  }
};

/**
 * Resolve the expected API key for a given app name from the environment.
 * Pattern: PRINT_API_KEY_{APPNAME_UPPERCASE}
 * e.g. "admissions" → process.env.PRINT_API_KEY_ADMISSIONS
 */
function getAppApiKey(appName) {
  const envKey = `PRINT_API_KEY_${appName.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envKey] || null;
}

// Logging helper function
export const logPrintRequest = (details) => {
  try {
    const logDir = path.resolve(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'print.log');
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...details
    }) + '\n';
    
    fs.appendFileSync(logFile, logLine, 'utf8');
    console.log(`[PRINT LOG] ${logLine.trim()}`);
  } catch (error) {
    console.error('Failed to write print log:', error);
  }
};

export const authenticatePrint = async (req, res, next) => {
  const { template, data } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const errorDetails = {
      callingApp: 'unknown',
      templateName: template || 'unknown',
      requestedRecord: data ? JSON.stringify(data) : 'none',
      user: null,
      status: 'failed',
      reason: 'No Authorization header or invalid format'
    };
    logPrintRequest(errorDetails);
    return next(createError(401, 'Unauthorized: No token or invalid header format'));
  }

  const token = authHeader.split(' ')[1];

  // 1. Check if token matches an authorized app key
  let callingApp = null;
  for (const [appName, config] of Object.entries(AUTHORIZED_APPS)) {
    const expectedKey = getAppApiKey(appName);
    if (expectedKey && token === expectedKey) {
      callingApp = appName;
      break;
    }
  }

  if (callingApp) {
    const allowed = AUTHORIZED_APPS[callingApp].allowedTemplates.includes(template);
    if (!allowed) {
      const errorDetails = {
        callingApp,
        templateName: template,
        requestedRecord: data ? JSON.stringify(data) : 'none',
        user: null,
        status: 'failed',
        reason: `Forbidden: App does not have permission for template '${template}'`
      };
      logPrintRequest(errorDetails);
      return next(createError(403, `Forbidden: Application not authorized to print template '${template}'`));
    }
    
    req.callingApp = callingApp;
    req.printUser = null;
    return next();
  }

  // 2. Check if token is a user JWT token from our own frontend
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded._id || decoded.id || decoded.userId;

    if (!userId) {
      throw new Error('Invalid token structure');
    }

    // Try finding admin or student
    let user = await Admin.findById(userId).select('-password');
    let isAdmin = !!user;
    
    if (!user) {
      user = await User.findById(userId).select('-password');
    }

    if (!user) {
      const errorDetails = {
        callingApp: 'hms-frontend',
        templateName: template,
        requestedRecord: data ? JSON.stringify(data) : 'none',
        user: null,
        status: 'failed',
        reason: 'User not found'
      };
      logPrintRequest(errorDetails);
      return next(createError(401, 'Unauthorized: User session not found'));
    }

    // Admins (found in Admin collection) can print anything. Students can print their own records.
    if (!isAdmin && user.role !== 'student') {
      const errorDetails = {
        callingApp: 'hms-frontend',
        templateName: template,
        requestedRecord: data ? JSON.stringify(data) : 'none',
        user: user.email || user.username || user._id,
        status: 'failed',
        reason: `Invalid user role: ${user.role}`
      };
      logPrintRequest(errorDetails);
      return next(createError(403, 'Forbidden: Insufficient privileges'));
    }

    req.callingApp = 'hms-frontend';
    req.printUser = user;
    return next();
  } catch (err) {
    const errorDetails = {
      callingApp: 'unknown',
      templateName: template || 'unknown',
      requestedRecord: data ? JSON.stringify(data) : 'none',
      user: null,
      status: 'failed',
      reason: 'Token failed verification'
    };
    logPrintRequest(errorDetails);
    return next(createError(401, 'Unauthorized: Invalid token or API key'));
  }
};
