require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    // There isn't a direct listModels in the simple SDK, but we can try a sample call
    console.log("Checking gemini-1.5-flash...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("test");
    console.log("Success with gemini-1.5-flash");
  } catch (err) {
    console.error("Error with gemini-1.5-flash:", err.message);
    
    try {
        console.log("Checking gemini-pro...");
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent("test");
        console.log("Success with gemini-pro");
    } catch (err2) {
        console.error("Error with gemini-pro:", err2.message);
    }
  }
}

listModels();
