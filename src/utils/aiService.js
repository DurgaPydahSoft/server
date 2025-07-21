import Member from '../models/Member.js';
import AIConfig from '../models/AIConfig.js';
import notificationService from './notificationService.js';

class AIService {
  constructor() {
    console.log('🤖 AI Service initialized');
  }

  // Smart member selection based on expertise, efficiency, and workload
  async selectOptimalMember(complaintData) {
    try {
      console.log('🤖 Selecting optimal member for complaint:', complaintData._id);
      
      const { category, subCategory } = complaintData;
      const aiConfig = await AIConfig.getConfig();
      
      // Determine the target category for member selection
      let targetCategory = category;
      if (category === 'Maintenance' && subCategory) {
        // For maintenance complaints, try to find members with the specific sub-category first
        // If not found, fall back to 'Maintenance' category
        targetCategory = subCategory;
      }
      
      // Get all active members for this category
      let members = await Member.find({
        isActive: true,
        category: targetCategory
      });
      
      if (members.length === 0) {
        // For maintenance complaints, try to find members with 'Maintenance' category as fallback
        if (category === 'Maintenance' && subCategory && targetCategory !== 'Maintenance') {
          members = await Member.find({
            isActive: true,
            category: 'Maintenance'
          });
        }
        
        // If still no members, return null
        if (members.length === 0) {
          return null;
        }
      }
      
      // Update workload for all members
      await Promise.all(members.map(member => member.updateWorkload()));
      
      // Refresh members data after workload update
      members = await Member.find({
        isActive: true,
        category: targetCategory
      });
      
      // Calculate scores for each member
      const memberScores = await Promise.all(members.map(async (member) => {
        const score = await this.calculateMemberScore(member, complaintData, aiConfig);
        return { member, score };
      }));
      
      // Filter out members with too much workload
      const availableMembers = memberScores.filter(({ member }) => 
        member.currentWorkload < aiConfig.maxWorkload
      );
      
      if (availableMembers.length === 0) {
        return null;
      }
      
      // Sort by score and return the best match
      availableMembers.sort((a, b) => b.score - a.score);
      const selectedMember = availableMembers[0].member;
      
      return selectedMember;
      
    } catch (error) {
      console.error('Error selecting optimal member:', error);
      return null;
    }
  }
  
  // Calculate member score based on multiple factors
  async calculateMemberScore(member, complaintData, aiConfig) {
    let score = 0;
    
    // Expertise score (0-40 points)
    const expertiseScore = member.categoryExpertise[complaintData.category] || 0;
    score += (expertiseScore / 100) * 40;
    
    // Efficiency score (0-30 points)
    const efficiencyScore = member.efficiencyScore || 0;
    score += (efficiencyScore / 100) * 30;
    
    // Workload score (0-20 points) - less workload = higher score
    const maxWorkload = aiConfig.maxWorkload;
    const workloadPenalty = (member.currentWorkload / maxWorkload) * 20;
    score += Math.max(0, 20 - workloadPenalty);
    
    // Availability score (0-10 points)
    const lastActive = new Date(member.lastActive);
    const hoursSinceActive = (Date.now() - lastActive) / (1000 * 60 * 60);
    const availabilityScore = Math.max(0, 10 - (hoursSinceActive / 24) * 10);
    score += availabilityScore;
    

    
    return score;
  }
  
  // Process complaint with AI
  async processComplaint(complaintId) {
    const startTime = Date.now();
    
    try {

      
      const Complaint = (await import('../models/Complaint.js')).default;
      const complaint = await Complaint.findById(complaintId)
        .populate('student', 'name email');
      
      if (!complaint) {
        throw new Error('Complaint not found');
      }
      

      
      // Check if AI is enabled for this category
      const aiConfig = await AIConfig.getConfig();
      
      if (!aiConfig.isEnabled || !aiConfig.categories[complaint.category]?.aiEnabled) {
        return { success: false, message: 'AI not enabled for this category' };
      }
      
      // Select optimal member
      const optimalMember = await this.selectOptimalMember(complaint);
      
      if (!optimalMember) {
        return { success: false, message: 'No suitable member available' };
      }
      
      // Update complaint with AI assignment
      complaint.assignedTo = optimalMember._id;
      complaint.currentStatus = 'In Progress';
      complaint.aiProcessed = true;
      complaint.aiProcessingTime = Date.now() - startTime;
      complaint.aiAssignedMember = optimalMember._id;
      
      // Add to status history
      complaint.statusHistory.push({
        status: 'In Progress',
        timestamp: new Date(),
        note: `Complaint assigned to ${optimalMember.name} - ${optimalMember.category} department`
      });
      
      await complaint.save();
      
      // Update member workload
      await optimalMember.updateWorkload();
      
      // Send notification to student
      try {
        await notificationService.sendComplaintStatusUpdate(
          complaint.student._id,
          complaint,
          'In Progress',
          'AI System',
          null
        );
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
      }
      
      const processingTime = Date.now() - startTime;
      
      return {
        success: true,
        message: 'Complaint processed and assigned successfully',
        data: {
          complaint,
          assignedMember: optimalMember,
          processingTime
        }
      };
      
    } catch (error) {
      console.error('Error processing complaint with AI:', error);
      return {
        success: false,
        message: 'AI processing failed',
        error: error.message
      };
    }
  }
  
  // Update member efficiency metrics
  async updateMemberEfficiency(memberId) {
    try {
      const member = await Member.findById(memberId);
      if (!member) {
        throw new Error('Member not found');
      }
      
      await member.updateEfficiencyMetrics();
      console.log('🤖 Updated efficiency metrics for member:', member.name);
      
      return true;
    } catch (error) {
      console.error('🤖 Error updating member efficiency:', error);
      return false;
    }
  }
  
  // Get AI statistics
  async getAIStats() {
    try {
      const Complaint = (await import('../models/Complaint.js')).default;
      
      const totalProcessed = await Complaint.countDocuments({ aiProcessed: true });
      const totalComplaints = await Complaint.countDocuments();
      
      const aiProcessedComplaints = await Complaint.find({ aiProcessed: true })
        .select('aiProcessingTime createdAt')
        .sort({ createdAt: -1 })
        .limit(100);
      
      const averageProcessingTime = aiProcessedComplaints.length > 0 
        ? aiProcessedComplaints.reduce((sum, complaint) => sum + (complaint.aiProcessingTime || 0), 0) / aiProcessedComplaints.length
        : 0;
      
      const successRate = totalComplaints > 0 ? (totalProcessed / totalComplaints) * 100 : 0;
      
      return {
        totalProcessed,
        averageProcessingTime: Math.round(averageProcessingTime),
        successRate: Math.round(successRate * 100) / 100,
        totalComplaints
      };
    } catch (error) {
      console.error('🤖 Error getting AI stats:', error);
      return {
        totalProcessed: 0,
        averageProcessingTime: 0,
        successRate: 0,
        totalComplaints: 0
      };
    }
  }
}

const aiService = new AIService();

export default aiService; 