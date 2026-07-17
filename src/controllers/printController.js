import {
  generateFeeReceipt,
  generateHostelAdmit,
  generateStaffGuestAdmit,
  generateTransportAdmit,
  generateLiveOccupancyReport
} from '../services/printService.js';
import { logPrintRequest } from '../middleware/printAuthentication.js';

export const handlePrintRequest = async (req, res, next) => {
  const { template, data } = req.body;
  const callingApp = req.callingApp || 'unknown';
  const loggedInUser = req.printUser ? (req.printUser.email || req.printUser.username || req.printUser._id) : null;
  
  let recordId = 'N/A';
  if (data) {
    recordId = data.receiptId || data.paymentId || data.studentId || data.staffGuestId || data.id || 'N/A';
  }

  try {
    if (!template) {
      logPrintRequest({
        callingApp,
        templateName: 'none',
        requestedRecord: recordId,
        user: loggedInUser,
        status: 'failed',
        reason: 'Missing template parameter'
      });
      return res.status(400).json({
        success: false,
        message: 'Template parameter is required'
      });
    }

    let documentBuffer;
    let contentType = 'application/pdf';

    const extractId = (val) => {
      if (!val) return null;
      if (typeof val === 'object') {
        return val._id || val.id || null;
      }
      return val;
    };

    switch (template) {
      case 'fee-receipt': {
        const id = extractId(data?.receiptId || data?.paymentId);
        if (!id) {
          return res.status(400).json({ success: false, message: 'paymentId or receiptId is required in data' });
        }
        documentBuffer = await generateFeeReceipt(id);
        break;
      }
      
      case 'hostel-admit': {
        const id = extractId(data?.studentId);
        if (!id) {
          return res.status(400).json({ success: false, message: 'studentId is required in data' });
        }
        documentBuffer = await generateHostelAdmit(id);
        break;
      }

      case 'staff-guest-admit': {
        const id = extractId(data?.staffGuestId);
        if (!id) {
          return res.status(400).json({ success: false, message: 'staffGuestId is required in data' });
        }
        documentBuffer = await generateStaffGuestAdmit(id);
        break;
      }

      case 'transport-admit': {
        const id = extractId(data?.studentId);
        if (!id) {
          return res.status(400).json({ success: false, message: 'studentId is required in data' });
        }
        documentBuffer = await generateTransportAdmit(id);
        break;
      }

      case 'live-occupancy-report': {
        contentType = 'text/html';
        const students = data?.students || [];
        const filters = data?.filters || {};
        const isLiveMode = data?.isLiveMode !== undefined ? data?.isLiveMode : true;
        const includeSummary = data?.includeSummary !== undefined ? data?.includeSummary : true;
        const includeDetails = data?.includeDetails !== undefined ? data?.includeDetails : true;
        const detailedReportMode = data?.detailedReportMode || 'category-wise';
        const detailedReportType = data?.detailedReportType || 'room-wise';
        
        const htmlString = await generateLiveOccupancyReport(students, filters, isLiveMode, { 
          includeSummary, 
          includeDetails,
          detailedReportMode,
          detailedReportType
        });
        documentBuffer = Buffer.from(htmlString, 'utf8');
        break;
      }

      default:
        logPrintRequest({
          callingApp,
          templateName: template,
          requestedRecord: recordId,
          user: loggedInUser,
          status: 'failed',
          reason: `Invalid template: '${template}'`
        });
        return res.status(400).json({
          success: false,
          message: `Invalid template: '${template}'. Supported templates are: fee-receipt, hostel-admit, staff-guest-admit, transport-admit, live-occupancy-report`
        });
    }

    // Log success
    logPrintRequest({
      callingApp,
      templateName: template,
      requestedRecord: recordId,
      user: loggedInUser,
      status: 'success'
    });

    // Send headers and response
    res.setHeader('Content-Type', contentType);
    if (contentType === 'application/pdf') {
      res.setHeader('Content-Disposition', `attachment; filename="${template}_${Date.now()}.pdf"`);
    }
    return res.send(documentBuffer);

  } catch (error) {
    console.error('Error handling print request:', error);
    
    const isNotFound = error.message.includes('not found') || error.message.includes('Cast to ObjectId failed');
    const statusCode = isNotFound ? 404 : 500;

    logPrintRequest({
      callingApp,
      templateName: template,
      requestedRecord: recordId,
      user: loggedInUser,
      status: 'failed',
      reason: error.message
    });

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Internal server error while generating print document'
    });
  }
};
