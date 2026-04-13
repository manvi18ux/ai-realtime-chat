const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const Message = require('./models/Message');

// Gemini Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

// AWS S3 Setup
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      cb(null, `uploads/${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*', // Secure origin for deployment
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));
app.use(express.json());

// File Upload Route
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Determine file type category
  let fileType = 'other';
  const mime = req.file.contentType || '';
  if (mime.startsWith('image/')) fileType = 'image';
  else if (mime === 'application/pdf') fileType = 'pdf';

  res.json({
    fileUrl: req.file.location,
    fileType: fileType,
    fileName: req.file.originalname
  });
});

// Helper for Gemini Retries
async function generateWithRetry(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      // 429 = Rate Limit, 503 = Overloaded
      if ((err.status === 503 || err.status === 429) && i < retries - 1) {
        const delay = 2000 * (i + 1);
        console.warn(`⚠️ Gemini busy/rate-limited (${err.status}), retrying in ${delay}ms... (${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chat_app';
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Summarization Route
app.post('/api/summarize', async (req, res) => {
  const { roomId } = req.body;

  try {
    const messages = await Message.find({ roomId }).sort({ timestamp: -1 }).limit(50);
    
    if (messages.length === 0) {
      return res.json({ summary: "No messages to summarize yet." });
    }

    const chatHistory = messages
      .reverse()
      .map(msg => `${msg.sender}: ${msg.content}`)
      .join('\n');

    const prompt = `Below is a chat history from a room. Provide a concise bulleted summary of the recent discussion:\n\n${chatHistory}`;

    const summary = await generateWithRetry(prompt);

    res.json({ summary });
  } catch (err) {
    console.error('❌ Summarization error:', err);
    res.status(500).json({ error: "Failed to generate summary." });
  }
});

// AI Suggested Replies Route
app.post('/api/suggest-replies', async (req, res) => {
  const { roomId } = req.body;

  try {
    const messages = await Message.find({ roomId }).sort({ timestamp: -1 }).limit(10);

    if (messages.length === 0) {
      return res.json({ suggestions: [] });
    }

    const context = messages
      .reverse()
      .map(msg => `${msg.sender}: ${msg.content}`)
      .join('\n');

    const prompt = `Based on this chat history, suggest 3 extremely short (1-3 words each) reply options for the current user.
    Return ONLY a raw JSON array of strings, e.g. ["Cool!", "On it.", "Thanks!"].
    
    History:
    ${context}`;

    const text = await generateWithRetry(prompt);

    // Improved JSON extraction: 
    // AI often returns ```json [ ... ] ``` or just [ ... ]
    let suggestions = [];
    try {
      const jsonStart = text.indexOf('[');
      const jsonEnd = text.lastIndexOf(']') + 1;
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = text.substring(jsonStart, jsonEnd);
        suggestions = JSON.parse(jsonStr);
      }
    } catch (parseErr) {
      console.error('❌ Failed to parse suggestions:', text);
    }

    res.json({ suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 3) : [] });
  } catch (err) {
    console.error('❌ Suggestion error:', err);
    res.status(500).json({ error: "Failed to generate suggestions." });
  }
});

// Socket.io Logic
io.on('connection', (socket) => {
  console.log(`👤 User Connected: ${socket.id}`);

  // Join a room
  socket.on('join_room', async (roomId) => {
    socket.join(roomId);
    console.log(`🏠 User ${socket.id} joined room: ${roomId}`);

    try {
      // Fetch history for the room
      const history = await Message.find({ roomId }).sort({ timestamp: 1 }).limit(50);
      socket.emit('room_history', history);
    } catch (err) {
      console.error('❌ Error fetching history:', err);
    }
  });

  // Handle typing indicator
  socket.on('typing', (data) => {
    socket.to(data.roomId).emit('user_typing', data);
  });

  socket.on('stop_typing', (data) => {
    socket.to(data.roomId).emit('user_stop_typing', data);
  });

  // Handle sending messages
  socket.on('send_message', async (data) => {
    const { roomId, sender, content, fileUrl, fileType } = data;

    try {
      // Create and save message to DB
      const newMessage = new Message({
        roomId,
        sender,
        content,
        fileUrl,
        fileType,
      });
      await newMessage.save();

      // Broadcast message to room
      io.to(roomId).emit('receive_message', newMessage);
      console.log(`📩 Message sent in room ${roomId} by ${sender}${fileUrl ? ' (with attachment)' : ''}`);
    } catch (err) {
      console.error('❌ Error saving message:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`👋 User Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Socket server running on port ${PORT}`);
});
