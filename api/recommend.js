import OpenAI from "openai";

// ✅ Exported API route for Vercel
export default async function handler(req, res) {
  // ✅ Allow CORS (for your frontend)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Handle preflight
  }

  // ✅ Restrict to POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: "No input provided" });
    }

    // 🔑 Initialize OpenAI client
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 🧠 Create a clear structured prompt
    const prompt = `
    Recommend 5 ${input.includes("song") ? "songs" : input.includes("tv") ? "TV shows" : "movies"}
    based on: "${input}".
    Respond as a simple list, one title per line, without numbering.
    `;

    // 💬 Send request to GPT model
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });

    const text = response.choices[0].message.content?.trim() || "";

    // 🧩 Convert GPT's text into array format
    const recommendations = text
      .split(/\n|,/)
      .map(line => line.replace(/^[0-9\.\-\•\s]+/, "").trim()) // remove numbering/bullets
      .filter(line => line.length > 0);

    // ✅ Respond in the frontend’s expected format
    res.status(200).json({ recommendations });
  } catch (err) {
    console.error("🚨 Error in /api/recommend:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
}
