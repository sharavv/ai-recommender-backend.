import axios from "axios";
import OpenAI from "openai";

export default async function handler(req, res) {
  // ✅ Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: "No input provided" });

    console.log("🎯 Input received:", input);

    // 1️⃣ Use OpenAI to classify input type & determine intent
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const interpretPrompt = `
    The user said: "${input}".
    Determine:
    - type: "movie", "tv", or "song"
    - mode: "genre" if they mentioned a genre/mood (like thriller, romance, horror)
            "title" if they mentioned a specific show or movie name
    - query: cleaned-up keyword(s) to use in API search
    Respond in strict JSON like this:
    {"type":"movie","mode":"genre","query":"thriller"}
    `;

    const interpretationResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: interpretPrompt }],
    });

    const text = interpretationResp.choices[0].message.content.trim();
    console.log("🧠 Interpretation:", text);

    let interpretation;
    try {
      interpretation = JSON.parse(text);
    } catch {
      interpretation = { type: "movie", mode: "title", query: input };
    }

    if (!["movie", "tv", "song"].includes(interpretation.type))
      interpretation.type = "movie";
    if (!["genre", "title"].includes(interpretation.mode))
      interpretation.mode = "title";

    let recommendations = [];

    // 2️⃣ TMDB Movies / TV
    if (interpretation.type === "movie" || interpretation.type === "tv") {
      const TMDB_KEY = process.env.TMDB_API_KEY;
      let tmdbUrl = "";

      if (interpretation.mode === "genre") {
        // Get genre list first
        const genreResp = await axios.get(
          `https://api.themoviedb.org/3/genre/${interpretation.type}/list?api_key=${TMDB_KEY}&language=en-US`
        );

        const genres = genreResp.data.genres || [];
        const match = genres.find((g) =>
          g.name.toLowerCase().includes(interpretation.query.toLowerCase())
        );

        if (match) {
          tmdbUrl = `https://api.themoviedb.org/3/discover/${interpretation.type}?api_key=${TMDB_KEY}&with_genres=${match.id}&sort_by=popularity.desc`;
        } else {
          // fallback to text search if genre not matched
          tmdbUrl = `https://api.themoviedb.org/3/search/${interpretation.type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(
            interpretation.query
          )}`;
        }
      } else {
        tmdbUrl = `https://api.themoviedb.org/3/search/${interpretation.type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(
          interpretation.query
        )}`;
      }

      console.log("🎬 TMDB URL:", tmdbUrl);

      try {
        const tmdbResp = await axios.get(tmdbUrl);
        const results = tmdbResp.data?.results || [];

        recommendations = results.slice(0, 8).map((r) => ({
          id: r.id,
          title: r.title || r.name,
          overview: r.overview || "",
          poster_path: r.poster_path
            ? `https://image.tmdb.org/t/p/w500${r.poster_path}`
            : null,
          tmdb_score: r.vote_average || null,
          release_date: r.release_date || r.first_air_date || null,
        }));
      } catch (err) {
        console.error("🚨 TMDB fetch error:", err.response?.data || err.message);
      }
    }

    // 3️⃣ Spotify Songs
    else if (interpretation.type === "song") {
      try {
        const spotifyTokenResp = await axios.post(
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

        const token = spotifyTokenResp.data.access_token;
        const spotifyResp = await axios.get(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(
            interpretation.query
          )}&type=track&limit=8`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        const results = spotifyResp.data?.tracks?.items || [];
        recommendations = results.map((t) => ({
          id: t.id,
          title: t.name,
          artist: t.artists.map((a) => a.name).join(", "),
          album: t.album.name,
          preview_url: t.preview_url,
          image: t.album.images?.[0]?.url || null,
          external_url: t.external_urls.spotify,
        }));
      } catch (err) {
        console.error("🚨 Spotify fetch error:", err.response?.data || err.message);
      }
    }

    console.log("✅ Final Recommendations:", recommendations);
    if (!recommendations.length)
      return res.status(200).json({ message: "No results found" });

    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("🔥 Error in /api/recommend:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
