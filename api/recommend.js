import OpenAI from "openai";
import fetch from "node-fetch";

// === Unified AI Recommender API ===
export default async function handler(req, res) {
  // ✅ CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ✅ Allow only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: "No input provided" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const TMDB_KEY = process.env.TMDB_KEY;
    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

    // 🧠 Step 1: Interpret the input
    const prompt = `
    User input: "${input}"
    Determine:
    1) type: one of "movie", "tv", "song"
    2) up to two keywords/genres (array)
    Respond as JSON only. Example: {"type":"movie","keywords":["action","thriller"]}.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    });

    let parsed = {};
    try {
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch {
      parsed = { type: "movie", keywords: [input] };
    }

    const type = parsed.type || "movie";
    const keywords = parsed.keywords?.join(" ") || input;

    let recommendations = [];

    // === 🎬 MOVIE ===
    if (type === "movie") {
      const tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(keywords)}`
      );
      const data = await tmdbRes.json();

      recommendations = (data.results || []).slice(0, 8).map((m) => ({
        title: m.title,
        overview: m.overview,
        release_date: m.release_date,
        poster_path: m.poster_path
          ? `https://image.tmdb.org/t/p/w300${m.poster_path}`
          : null,
      }));
    }

    // === 📺 TV ===
    else if (type === "tv") {
      const tmdbRes = await fetch(
        `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(keywords)}`
      );
      const data = await tmdbRes.json();

      recommendations = (data.results || []).slice(0, 8).map((t) => ({
        title: t.name,
        overview: t.overview,
        release_date: t.first_air_date,
        poster_path: t.poster_path
          ? `https://image.tmdb.org/t/p/w300${t.poster_path}`
          : null,
      }));
    }

    // === 🎵 SONG ===
    else if (type === "song") {
      // 🎫 Get Spotify token
      const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const tokenData = await tokenResp.json();
      const token = tokenData.access_token;

      // 🎵 Fetch Spotify results
      const spRes = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(
          keywords
        )}&type=track&limit=8`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const spData = await spRes.json();

      recommendations = (spData.tracks?.items || []).map((s) => ({
        title: s.name,
        artists: s.artists.map((a) => a.name).join(", "),
        album_image: s.album.images?.[0]?.url || null,
        external_url: s.external_urls?.spotify || null,
      }));
    }

    // ✅ Return AI-processed data
    res.status(200).json({
      input,
      interpreted_as: type,
      keywords,
      recommendations,
    });
  } catch (err) {
    console.error("🚨 Error in /api/recommend:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
}
