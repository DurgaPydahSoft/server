import mongoose from 'mongoose';

const pollSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  options: [{
    text: {
      type: String,
      required: true,
      trim: true
    },
    votes: {
      type: Number,
      default: 0
    }
  }],
  endTime: {
    type: Date,
    required: true
  },
  scheduledTime: {
    type: Date,
    default: null
  },
  isScheduled: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'ended', 'scheduled'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  voters: [{
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    votedOption: Number,
    votedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Method to check if a student has voted
pollSchema.methods.hasVoted = function(studentId) {
  return this.voters.some(voter => voter.student.toString() === studentId.toString());
};

// Method to get total votes
pollSchema.methods.getTotalVotes = function() {
  return this.options.reduce((total, option) => total + option.votes, 0);
};

// Method to get poll results
pollSchema.methods.getResults = function() {
  return this.options.map(option => ({
    text: option.text,
    votes: option.votes,
    percentage: this.getTotalVotes() > 0 
      ? ((option.votes / this.getTotalVotes()) * 100).toFixed(1)
      : 0
  }));
};

// Create indexes
pollSchema.index({ status: 1, endTime: 1 });
pollSchema.index({ createdBy: 1 });
pollSchema.index({ 'voters.student': 1 });

const Poll = mongoose.model('Poll', pollSchema);

export default Poll; 