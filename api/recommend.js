// === /api/recommend.js ===
import axios from "axios";
import OpenAI from "openai";

export default async function handler(req, res) {
  // ✅ Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: "Missing input" });

    console.log(`🎯 Input received: ${input}`);

    // ✅ Step 1: Interpret user intent (movie, tv, or song)
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const interpretPrompt = `
      The user said: "${input}".
      Determine if they want recommendations for movies, TV shows, or songs.
      Then output only JSON like this:
      {"type": "movie"|"tv"|"song", "query": "<refined search keywords>"}
    `;

    const aiResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: interpretPrompt }],
    });

    let interpretation;
    try {
      interpretation = JSON.parse(aiResp.choices[0].message.content.trim());
    } catch (err) {
      console.warn("⚠️ Could not parse AI response, using fallback.");
      interpretation = { type: "movie", query: input };
    }

    console.log("🧠 AI Interpretation:", interpretation);
    const { type, query } = interpretation;

    let recommendations = [];

    // ================================
    // 🎬 MOVIES & TV SHOWS via TMDB
    // ================================
    if (type === "movie" || type === "tv") {
      const tmdbUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${
        process.env.TMDB_API_KEY
      }&query=${encodeURIComponent(query)}`;

      const tmdbResp = await axios.get(tmdbUrl);
      const results = tmdbResp.data.results || [];

      recommendations = results.slice(0, 8).map((item) => ({
        id: item.id,
        title: item.title || item.name,
        overview: item.overview || "",
        poster: item.poster_path
          ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
          : null,
        release_date: item.release_date || item.first_air_date || "N/A",
        rating: item.vote_average || null,
      }));
    }

    // ================================
    // 🎵 SONGS via Spotify
    // ================================
    else if (type === "song") {
      // Get Spotify access token
      const tokenResp = await axios.post(
        "https://accounts.spotify.com/api/token",
        new URLSearchParams({ grant_type: "client_credentials" }),
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const token = tokenResp.data.access_token;
      const spotifyResp = await axios.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(
          query
        )}&type=track&limit=8`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const tracks = spotifyResp.data.tracks.items || [];
      recommendations = tracks.map((t) => ({
        id: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        album: t.album.name,
        image: t.album.images?.[0]?.url || null,
        spotify_url: t.external_urls.spotify,
      }));
    }

    // ================================
    // ✅ Response
    // ================================
    if (recommendations.length === 0) {
      return res.status(200).json({ message: "No results found" });
    }

    console.log(`✅ ${recommendations.length} ${type}s found`);
    return res.status(200).json({ type, query, recommendations });
  } catch (err) {
    console.error("🔥 Error in /api/recommend:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
}
