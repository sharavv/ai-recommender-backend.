import OpenAI from "openai";
import fetch from "node-fetch";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { mood, genre, activity } = req.body;

    // ✅ Load all three keys
    const openaiKey = process.env.OPENAI_API_KEY;
    const spotifyKey = process.env.SPOTIFY_API_KEY;
    const youtubeKey = process.env.YOUTUBE_API_KEY;

    if (!openaiKey || !spotifyKey || !youtubeKey) {
      return res.status(500).json({ error: "Missing one or more API keys" });
    }

    // 1️⃣ Use OpenAI for mood-based recommendations
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful AI music recommender." },
        {
          role: "user",
          content: `Suggest 5 songs for a person in a ${mood} mood who likes ${genre} and is ${activity}.`,
        },
      ],
    });

    const recommendations = aiResponse.choices[0].message.content;

    // 2️⃣ Optional Spotify Example
    const spotifyData = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        mood
      )}&type=track&limit=3`,
      { headers: { Authorization: `Bearer ${spotifyKey}` } }
    ).then((r) => r.json());

    // 3️⃣ Optional YouTube Example
    const youtubeData = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
        mood + " music"
      )}&key=${youtubeKey}&maxResults=3&type=video`
    ).then((r) => r.json());

    // ✅ Send combined response
    res.status(200).json({
      success: true,
      from_openai: recommendations,
      from_spotify: spotifyData.tracks?.items || [],
      from_youtube: youtubeData.items || [],
    });
  } catch (err) {
    console.error("Error in /api/recommend:", err);
    res.status(500).json({ error: err.message });
  }
}
