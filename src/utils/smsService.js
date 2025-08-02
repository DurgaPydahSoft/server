import axios from 'axios';
import { createError } from './error.js';

const BULKSMS_API_KEY = process.env.BULKSMS_API_KEY || "7c9c967a-4ce9-4748-9dc7-d2aaef847275";
const BULKSMS_SENDER_ID = process.env.BULKSMS_SENDER_ID || "PYDAHK";
// API URLs based on BulkSMS documentation
// For English SMS (regular)
const BULKSMS_ENGLISH_API_URL = process.env.BULKSMS_ENGLISH_API_URL || "https://www.bulksmsapps.com/api/apismsv2.aspx";
// For Unicode/Non-English SMS (Telugu)
const BULKSMS_UNICODE_API_URL = process.env.BULKSMS_UNICODE_API_URL || "https://www.bulksmsapps.com/api/apibulkv2.aspx";
const BULKSMS_DLT_TEMPLATE_ID = process.env.BULKSMS_DLT_TEMPLATE_ID || "1707175151835691501";
const BULKSMS_ENGLISH_DLT_TEMPLATE_ID = process.env.BULKSMS_ENGLISH_DLT_TEMPLATE_ID || "1707175151753778713";

// The template strings should match your DLT templates exactly
const HOSTEL_TELUGU_OTP_TEMPLATE = "ప్రియమైన తల్లిదండ్రులారా, మీ {#var#} {#var#} హాస్టల్ నుండి సెలవు కోరుతున్నారు. ఈ OTP {#var#} ని షేర్ చేయండి. మీరు అంగీకరిస్తేనే -Pydah Hostel";
const HOSTEL_ENGLISH_OTP_TEMPLATE = "Dear Parents, your child {#var#} is seeking leave from hostel. share this OTP {#var#}. Only if you would like to approve-Pydah Hostel";

// Admin credential template
const ADMIN_CREDENTIAL_TEMPLATE = "Welcome to PYDAH HOSTEL. Your Account is created with UserID: {#var#} Password: {#var#} login with link: {#var#} -Pydah";
const ADMIN_CREDENTIAL_TEMPLATE_ID = process.env.ADMIN_CREDENTIAL_TEMPLATE_ID || "1707175393810117693"; // Admin credential template ID

// Helper function to check if response is valid
const isValidSMSResponse = (responseData) => {
  if (!responseData || typeof responseData !== 'string') {
    return false;
  }
  
  // Check for valid message ID patterns (primary check)
  if (responseData.includes('MessageId-') || !isNaN(responseData.trim())) {
    return true;
  }
  
  // Even if it contains HTML, check if it has a MessageId in the HTML
  if (responseData.includes('<!DOCTYPE') || responseData.includes('<html') || responseData.includes('<body')) {
    // Extract MessageId from HTML response
    const messageIdMatch = responseData.match(/MessageId-(\d+)/);
    if (messageIdMatch) {
      return true;
    }
  }
  
  return false;
};

// Helper function to extract message ID
const extractMessageId = (responseData) => {
  // Try to extract MessageId using regex (works for both plain text and HTML)
  const messageIdMatch = responseData.match(/MessageId-(\d+)/);
  if (messageIdMatch) {
    return messageIdMatch[1];
  }
  
  // Fallback to old method
  if (responseData.includes('MessageId-')) {
    return responseData.split('MessageId-')[1].split('\n')[0].trim();
  }
  if (!isNaN(responseData.trim())) {
    return responseData.trim();
  }
  return null;
};

// Helper function to send SMS using POST method
const sendSMSPost = async (params, isUnicode = false) => {
  // Use correct API URL based on language
  const apiUrl = isUnicode ? BULKSMS_UNICODE_API_URL : BULKSMS_ENGLISH_API_URL;
  
  console.log(`Using API URL for ${isUnicode ? 'Unicode' : 'English'} SMS:`, apiUrl);
  
  try {
    // Try POST method first (recommended for BulkSMS)
    const response = await axios.post(apiUrl, null, {
      params: params,
      timeout: 30000,
      headers: {
        'Accept': 'text/plain',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return response;
  } catch (error) {
    console.log('POST method failed, trying GET:', error.message);
    // Fallback to GET method
    const response = await axios.get(apiUrl, {
      params: params,
      timeout: 30000,
      headers: {
        'Accept': 'text/plain',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return response;
  }
};

// Function to send admin credentials via SMS
export const sendAdminCredentialsSMS = async (phoneNumber, username, password) => {
  try {
    if (!BULKSMS_API_KEY || !BULKSMS_SENDER_ID || !BULKSMS_ENGLISH_API_URL) {
      throw createError(500, 'SMS service configuration missing');
    }

    console.log('📱 Sending admin credentials via SMS to:', phoneNumber);
    
    // Replace template variables with actual values
    const message = ADMIN_CREDENTIAL_TEMPLATE
      .replace('{#var#}', username)
      .replace('{#var#}', password)
      .replace('{#var#}', 'hms.pydahsoft.in');
    
    const params = {
      apikey: BULKSMS_API_KEY,
      sender: BULKSMS_SENDER_ID,
      number: phoneNumber,
      message: message,
      templateid: ADMIN_CREDENTIAL_TEMPLATE_ID
    };
    
    console.log('📱 Admin credential SMS params:', {
      message: params.message,
      templateid: params.templateid,
      originalTemplate: ADMIN_CREDENTIAL_TEMPLATE,
      username: username,
      password: password
    });
    
    const response = await sendSMSPost(params, false); // isUnicode = false for English
    
    console.log('📱 Admin credential SMS response:', response.data);
    
    // Check if response is valid
    if (isValidSMSResponse(response.data)) {
      const messageId = extractMessageId(response.data);
      if (messageId) {
        console.log('✅ Admin credential SMS sent successfully with MessageId:', messageId);
        return {
          success: true,
          messageId: messageId,
          approach: 'Admin Credential Template',
          language: 'English'
        };
      }
    }
    
    throw new Error('Failed to send admin credential SMS');
  } catch (error) {
    console.error('📱 Error sending admin credential SMS:', error);
    throw error;
  }
};

export const sendSMS = async (phoneNumber, message, templateParams = {}) => {
  try {
    if (!BULKSMS_API_KEY || !BULKSMS_SENDER_ID || !BULKSMS_ENGLISH_API_URL || !BULKSMS_UNICODE_API_URL) {
      throw createError(500, 'SMS service configuration missing');
    }

    // For OTP messages, use the template
    let finalMessage = message;
    let params = {
      apikey: BULKSMS_API_KEY,
      sender: BULKSMS_SENDER_ID,
      number: phoneNumber,
      message: finalMessage,
    };

    if (templateParams.otp) {
      // Send both Telugu and English SMS for OTP messages
      const smsResults = [];
      
      // Send ONE Telugu SMS using DLT Template
      console.log('Sending Telugu SMS using DLT Template');
      
      // Replace template variables with actual values
      const teluguMessage = HOSTEL_TELUGU_OTP_TEMPLATE
        .replace('{#var#}', templateParams.gender || 'కొడుకు')
        .replace('{#var#}', templateParams.name || 'Student')
        .replace('{#var#}', templateParams.otp);
      
      const teluguParams = {
        apikey: BULKSMS_API_KEY,
        sender: BULKSMS_SENDER_ID,
        number: phoneNumber,
        message: teluguMessage,
        templateid: BULKSMS_DLT_TEMPLATE_ID,
        coding: '3' // Unicode parameter
      };
      
      console.log('Telugu DLT Template params:', {
        message: teluguParams.message,
        templateid: teluguParams.templateid,
        originalTemplate: HOSTEL_TELUGU_OTP_TEMPLATE,
        gender: templateParams.gender || 'కొుకు',
        name: templateParams.name || 'Student',
        otp: templateParams.otp
      });
      
      try {
        const teluguResponse = await sendSMSPost(teluguParams, true); // isUnicode = true
        
        console.log('Telugu SMS response:', teluguResponse.data);
        
        // Check if response is valid
        if (isValidSMSResponse(teluguResponse.data)) {
          const messageId = extractMessageId(teluguResponse.data);
          if (messageId) {
            console.log('✅ Telugu SMS sent successfully with MessageId:', messageId);
            smsResults.push({
              success: true,
              messageId: messageId,
              approach: 'DLT Template with Telugu',
              language: 'Telugu'
            });
            teluguSuccess = true;
          }
        } else {
          console.log('❌ Telugu SMS returned invalid response (HTML or error)');
        }
      } catch (error) {
        console.log('❌ Telugu SMS failed:', error.message);
      }
      
      // Send ONE English SMS using DLT Template
      console.log('Sending English SMS using DLT Template');
      
      // Replace template variables with actual values
      const englishMessage = HOSTEL_ENGLISH_OTP_TEMPLATE
        .replace('{#var#}', templateParams.name || 'Student')
        .replace('{#var#}', templateParams.otp);
      
      const englishParams = {
        apikey: BULKSMS_API_KEY,
        sender: BULKSMS_SENDER_ID,
        number: phoneNumber,
        message: englishMessage,
        templateid: BULKSMS_ENGLISH_DLT_TEMPLATE_ID
      };
      
      console.log('English DLT Template params:', {
        message: englishParams.message,
        templateid: englishParams.templateid,
        originalTemplate: HOSTEL_ENGLISH_OTP_TEMPLATE,
        name: templateParams.name || 'Student',
        otp: templateParams.otp
      });
      
      try {
        const englishResponse = await sendSMSPost(englishParams, false); // isUnicode = false
        
        console.log('English SMS response:', englishResponse.data);
        
        // Check if response is valid
        if (isValidSMSResponse(englishResponse.data)) {
          const messageId = extractMessageId(englishResponse.data);
          if (messageId) {
            console.log('✅ English SMS sent successfully with MessageId:', messageId);
            smsResults.push({
              success: true,
              messageId: messageId,
              approach: 'English DLT Template',
              language: 'English'
            });
            englishSuccess = true;
          }
        } else {
          console.log('❌ English SMS returned invalid response (HTML or error)');
        }
      } catch (error) {
        console.log('❌ English SMS failed:', error.message);
      }
      
      // Return results
      if (smsResults.length > 0) {
        console.log('SMS Results:', smsResults);
        return {
          success: true,
          results: smsResults,
          teluguSuccess,
          englishSuccess
        };
      }
      
      // If all approaches fail, throw error
      throw new Error('All SMS approaches failed');
    }

    console.log('SMS API params:', params);

    // Handle regular SMS (non-OTP) - assume English for regular messages
    const response = await sendSMSPost(params, false);
    
    console.log('SMS API response:', response.data);

    // Check if response is valid
    if (isValidSMSResponse(response.data)) {
      const messageId = extractMessageId(response.data);
      if (messageId) {
        return {
          success: true,
          messageId: messageId
        };
      }
    }

    throw createError(500, 'Failed to send SMS');
  } catch (error) {
    console.error('SMS sending error:', error);
    
    if (error.response) {
      console.error('SMS API error response:', error.response.data);
    }
    throw createError(500, 'Failed to send SMS');
  }
};

// Function to check SMS balance
export const checkBalance = async () => {
  try {
    if (!BULKSMS_API_KEY) {
      throw createError(500, 'SMS service configuration missing');
    }
    const response = await axios.get(`http://www.bulksmsapps.com/api/apicheckbalancev2.aspx?apikey=${BULKSMS_API_KEY}`);
    return response.data;
  } catch (error) {
    console.error('Error checking SMS balance:', error);
    throw createError(500, 'Failed to check SMS balance');
  }
};

// Function to check delivery status
export const checkDeliveryStatus = async (messageId) => {
  try {
    if (!BULKSMS_API_KEY) {
      throw createError(500, 'SMS service configuration missing');
    }
    const response = await axios.get(`http://www.bulksmsapps.com/api/apiDeliveryStatusv2.aspx?apikey=${BULKSMS_API_KEY}&messageid=${messageId}`);
    return response.data;
  } catch (error) {
    console.error('Error checking delivery status:', error);
    throw createError(500, 'Failed to check delivery status');
  }
}; 