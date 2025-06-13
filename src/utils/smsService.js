import axios from 'axios';
import { createError } from './error.js';

const BULKSMS_API_KEY = process.env.BULKSMS_API_KEY || "7c9c967a-4ce9-4748-9dc7-d2aaef847275";
const BULKSMS_SENDER_ID = process.env.BULKSMS_SENDER_ID || "PYDAHK";
const BULKSMS_API_URL = process.env.BULKSMS_API_URL || "http://www.bulksmsapps.com/api/apismsv2.aspx";
const BULKSMS_DLT_TEMPLATE_ID = process.env.BULKSMS_DLT_TEMPLATE_ID || "1707171819046577560";

// The template string should match your DLT template exactly
const MBA_MCA_TEMPLATE = "Join MBA,MCA @ Pydah College of Engg (Autonomous).Best Opportunity for Employees,Aspiring Students. {#var#} youtu.be/bnLOLQrSC5g?si=7TNjgpGQ3lTIe-sf -PYDAH";

export const sendSMS = async (phoneNumber, message, templateParams = {}) => {
  try {
    if (!BULKSMS_API_KEY || !BULKSMS_SENDER_ID || !BULKSMS_API_URL) {
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
      // Replace {#var#} in the template with the OTP
      finalMessage = MBA_MCA_TEMPLATE.replace('{#var#}', templateParams.otp);
      params.templateid = BULKSMS_DLT_TEMPLATE_ID;
    }

    console.log('SMS API params:', params);

    const response = await axios.get(BULKSMS_API_URL, { 
      params,
      timeout: 10000, // 10 second timeout
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    console.log('SMS API response:', response.data);

    if (response.data && !isNaN(response.data)) {
      return {
        success: true,
        messageId: response.data
      };
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