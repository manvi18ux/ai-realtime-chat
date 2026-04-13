const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
  },
  sender: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: false, // Changed to false as a message might only be a file
  },
  fileUrl: {
    type: String,
    required: false,
  },
  fileType: {
    type: String, // 'image', 'pdf', 'other'
    required: false,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Message', MessageSchema);
