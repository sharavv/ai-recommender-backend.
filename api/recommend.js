import axios from "axios";
import OpenAI from "openai";

export default async function handler(req, res) {
  // ✅ CORS setup
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

    // ✅ Step 1: Interpret user query (movie, tv, or song)
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const interpretPrompt = `
      The user said: "${input}".
      Identify whether the user wants recommendations for movies, TV shows, or songs.
      Respond in JSON format:
      {"type": "movie"|"tv"|"song", "query": "<refined keywords>"}
    `;

    const interpretationResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: interpretPrompt }],
    });

    const interpretationText =
      interpretationResp.choices[0].message.content.trim();
    console.log("🧠 Interpretation:", interpretationText);

    let interpretation;
    try {
      interpretation = JSON.parse(interpretationText);
    } catch {
      interpretation = { type: "movie", query: input };
    }

    if (!["movie", "tv", "song"].includes(interpretation.type)) {
      interpretation.type = "movie";
    }

    let recommendations = [];

    // ✅ Step 2: Handle TMDB (Movies / TV separately)
    if (interpretation.type === "movie" || interpretation.type === "tv") {
      const tmdbGenreResp = await axios.get(
        `https://api.themoviedb.org/3/genre/${interpretation.type}/list?api_key=${process.env.TMDB_API_KEY}`
      );

      const genres = tmdbGenreResp.data.genres;
      const match = genres.find(
        (g) =>
          g.name.toLowerCase() === interpretation.query.toLowerCase() ||
          interpretation.query.toLowerCase().includes(g.name.toLowerCase())
      );

      let tmdbUrl;
      if (match) {
        tmdbUrl = `https://api.themoviedb.org/3/discover/${interpretation.type}?api_key=${process.env.TMDB_API_KEY}&with_genres=${match.id}&sort_by=popularity.desc`;
      } else {
        tmdbUrl = `https://api.themoviedb.org/3/search/${interpretation.type}?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(
          interpretation.query
        )}`;
      }

      console.log("🎬 TMDB URL:", tmdbUrl);

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
    }

    // ✅ Step 3: Spotify (Songs)
    else if (interpretation.type === "song") {
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
          interpretation.query
        )}&type=track&limit=8`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const tracks = spotifyResp.data?.tracks?.items || [];
      recommendations = tracks.map((t) => ({
        id: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        album: t.album.name,
        image: t.album.images?.[0]?.url || null,
        external_url: t.external_urls.spotify,
      }));
    }

    console.log("✅ Final Recommendations:", recommendations);
    if (recommendations.length === 0) {
      return res.status(200).json({ message: "No results found" });
    }

    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("🔥 Error in /api/recommend:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
}
