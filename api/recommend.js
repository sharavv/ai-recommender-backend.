import axios from "axios";
import OpenAI from "openai";

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ✅ Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: "No input provided" });
    }

    // 🔑 Example: simple OpenAI test call
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `Recommend a movie for: ${input}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    res.status(200).json({
      recommendation: response.choices[0].message.content,
    });
  } catch (err) {
    console.error("🚨 Error in /api/recommend:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
