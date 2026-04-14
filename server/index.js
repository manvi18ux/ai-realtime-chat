const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Message = require('./models/Message');

// Gemini Setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

// Cloudinary Setup
const cloudinaryConfig = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
};

// Log status on startup (showing only first 3 chars for safety)
if (!cloudinaryConfig.cloud_name || !cloudinaryConfig.api_key || !cloudinaryConfig.api_secret) {
  console.warn("⚠️ [Cloudinary] Warning: Missing credentials. Uploads will fail.");
} else {
  console.log(`✅ [Cloudinary] Credentials loaded | Name: ${cloudinaryConfig.cloud_name.substring(0, 3)}... | Key: ${cloudinaryConfig.api_key.substring(0, 3)}... | Secret: ${cloudinaryConfig.api_secret.substring(0, 3)}...`);
}

cloudinary.config(cloudinaryConfig);

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'nexus_chat_uploads',
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf'],
    resource_type: 'auto', // Allows non-image files like PDFs
  },
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = [
  'https://ai-realtime-chat-manvi-sinhas-projects.vercel.app',
  'https://ai-realtime-chat-git-main-manvi-sinhas-projects.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow if origin is in the list or is a Vercel project subdomain
      if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.includes('manvi-sinhas-projects.vercel.app')) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Rejected origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.includes('manvi-sinhas-projects.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Health Check
app.get('/', (req, res) => res.send('Nexus Chat API is Online'));

// File Upload Route
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error("❌ [Upload] Multer Error:", err.message);
      return res.status(500).json({ error: "File upload failed", details: err.message });
    }

    if (!req.file) {
      console.warn("⚠️ [Upload] No file provided in request");
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      // Determine file type category from Cloudinary metadata
      let fileType = 'other';
      const format = req.file.format || '';
      const isImage = ['jpg', 'png', 'jpeg', 'webp'].some(f => format.toLowerCase().includes(f));
      
      if (isImage) fileType = 'image';
      else if (format.toLowerCase() === 'pdf') fileType = 'pdf';

      console.log(`✅ [Upload] Success: ${req.file.originalname} -> ${req.file.path}`);

      res.json({
        fileUrl: req.file.path, // Cloudinary secure URL
        fileType: fileType,
        fileName: req.file.originalname
      });
    } catch (processErr) {
      console.error("❌ [Upload] Processing Error:", processErr);
      res.status(500).json({ error: "Failed to process upload metadata" });
    }
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
const MONGO_URI = process.env.MONGO_URI;

// Global Mongoose Configuration
mongoose.set('bufferCommands', false); // Disable buffering globally

// Heartbeat Logger (Helps identify current deployment)
setInterval(() => {
  console.log(`[HEARTBEAT] V3_ACTIVE | Time: ${new Date().toLocaleTimeString()}`);
}, 30000);

if (!MONGO_URI) {
  console.error('❌ [Database] CRITICAL: MONGO_URI is not defined in environment variables!');
} else {
  console.log(`⏳ [Database] Attempting to connect with URI prefix: ${MONGO_URI.substring(0, 15)}...`);
  mongoose
    .connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, 
      socketTimeoutMS: 45000,
      bufferCommands: false, // CRITICAL: Stop the "buffering timed out" hang
    })
    .then(() => console.log('✅ [Database] Successfully connected to MongoDB'))
    .catch((err) => {
      console.error('❌ [Database] Connection Failed!');
      console.error(`   Error Message: ${err.message}`);
      
      if (err.message.includes('ETIMEDOUT') || err.message.includes('selection timeout')) {
        console.error('👉 ACTION REQUIRED: Your IP is likely blocked. Go to MongoDB Atlas > Network Access > Add 0.0.0.0/0');
      } else if (err.message.includes('auth failed') || err.message.includes('Authentication failed')) {
        console.error('👉 ACTION REQUIRED: Your Username or Password in MONGO_URI is wrong. Check your Database User in Atlas.');
      } else {
        console.error('👉 ACTION REQUIRED: Double-check that your MONGO_URI is copied correctly from Atlas (Node.js Driver string).');
      }
    });
}

// Summarization Route
app.post('/api/summarize', async (req, res) => {
  const { roomId } = req.body;

  try {
    const messages = await Message.find({ roomId }).sort({ timestamp: -1 }).limit(50);
    
    if (!messages || messages.length === 0) {
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
    console.error('❌ Summarization error (Likely DB offline):', err.message);
    res.json({ summary: "AI Summarization is currently unavailable (Database Offline)." });
  }
});

// AI Suggested Replies Route
app.post('/api/suggest-replies', async (req, res) => {
  const { roomId } = req.body;

  try {
    const messages = await Message.find({ roomId }).sort({ timestamp: -1 }).limit(10);

    if (!messages || messages.length === 0) {
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
    console.error('❌ Suggestion error (Likely DB offline):', err.message);
    res.json({ suggestions: [] });
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
      console.log(`📜 Sent ${history.length} messages to ${socket.id}`);
      socket.emit('room_history', history);
    } catch (err) {
      console.error('❌ Error fetching history:', err);
      // Even on error, send an empty array so skeleton loaders disappear
      socket.emit('room_history', []);
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
    
    // 1. Prepare the message object
    const newMessage = {
      roomId,
      sender,
      content,
      fileUrl,
      fileType,
      timestamp: new Date()
    };

    // 2. Broadcast to room INSTANTLY (Real-time fallback)
    // This allows chat to work even if MongoDB is currently buffering/offline.
    io.to(roomId).emit('receive_message', newMessage);

    // 3. Try to save to Database in the background
    try {
      const messageToSave = new Message(newMessage);
      await messageToSave.save();
      console.log(`💾 [Database] Message saved for room ${roomId}`);
    } catch (err) {
      console.error('❌ [Database] Failed to save message history:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`👋 User Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Socket server running on port ${PORT}`);
});
