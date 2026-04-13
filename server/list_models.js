require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
     // The SDK might not have listModels in the main class, but let's check the rest client
     // Actually, we can try to hit the API directly via fetch to see what's up
     const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
     const data = await resp.json();
     console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error listing models:", err.message);
  }
}

listModels();
