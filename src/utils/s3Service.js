import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const bucketName = process.env.AWS_S3_BUCKET;

export const uploadToS3 = async (file, folder = 'announcements') => {
  try {
    if (!file || !file.buffer) {
      throw new Error('Invalid file object');
    }

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;
    const key = `${folder}/${fileName}`;

    console.log(`📤 Uploading to S3: ${key}`);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Removed ACL since bucket doesn't support ACLs
    });

    await s3Client.send(command);
    
    const imageUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    console.log(`✅ Successfully uploaded to S3: ${imageUrl}`);
    
    return imageUrl;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

export const deleteFromS3 = async (imageUrl) => {
  try {
    if (!imageUrl) return;
    
    // Extract the key from the URL
    const key = imageUrl.split('.com/')[1];
    if (!key) {
      throw new Error('Invalid image URL format');
    }

    console.log(`🗑️ Attempting to delete from S3: ${key}`);

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (response.$metadata.httpStatusCode !== 204) {
      throw new Error('Failed to delete file from S3');
    }

    console.log(`✅ Successfully deleted image from S3: ${key}`);
  } catch (error) {
    console.error('❌ Error deleting from S3:', error);
    throw new Error(`Failed to delete file from S3: ${error.message}`);
  }
}; 