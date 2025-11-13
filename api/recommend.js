import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import https from "https";

dotenv.config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// --- Spotify token caching ---
let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt - 60000) {
    return spotifyToken;
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64"),
      },
    }
  );

  spotifyToken = resp.data.access_token;
  spotifyTokenExpiresAt = Date.now() + resp.data.expires_in * 1000;
  return spotifyToken;
}

// === AI INTERPRETER — genre-aware ===
async function interpretInput(userInput) {
  const prompt = `
Interpret the user's request STRICTLY as GENRES or MOODS.
Return JSON only:

{
  "type": "movie" | "tv" | "song",
  "genres": ["genre1", "genre2"]
}

NEVER return keywords from the title.
Examples:
- "action sci-fi movies" → ["action","science fiction"]
- "creepy horror stuff" → ["horror"]
- "sad songs" → ["sad","emotional"]
- "funny shows" → ["comedy"]
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt + "\nUser Input: " + userInput }],
    max_tokens: 150,
  });

  try {
    return JSON.parse(resp.choices[0].message.content.trim());
  } catch {
    return { type: "movie", genres: [userInput] };
  }
}

// Helper wrapper
async function safeGet(url) {
  return await axios.get(url, {
    timeout: 10000,
    httpsAgent: new https.Agent({ keepAlive: true }),
  });
}

// === MAIN API ROUTE ===
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { input } = req.body;
    const forcedType = req.headers["x-type"]; // movie / tv / song from frontend

    if (!input) return res.status(400).json({ error: "No input provided" });

    // AI interprets genre + best type
    const interpretation = await interpretInput(input);
    const type = forcedType || interpretation.type || "movie";

    const genres = interpretation.genres?.join(" ") || input;
    let recommendations = [];

    // === SONGS (Spotify) ===
    if (type === "song") {
      const token = await getSpotifyToken();
      const q = encodeURIComponent(genres);

      const sp = await axios.get(
        `https://api.spotify.com/v1/search?q=${q}&type=track&limit=10`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      recommendations = sp.data.tracks.items.map((t) => ({
        title: t.name,
        artists: t.artists.map((a) => a.name).join(", "),
        album_image: t.album.images?.[0]?.url,
        preview_url: t.preview_url,
        spotify_url: t.external_urls.spotify
      }));
    }

    // === MOVIES / TV — GENRE-BASED TMDB SEARCH ===
    else {
      const tmdbApiKey = process.env.TMDB_API_KEY;

      // Important: use DISCOVER endpoint for genre searching
      const tmdbUrl =
        type === "tv"
          ? `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${encodeURIComponent(
              genres
            )}`
          : `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(
              genres
            )}`;

      const tmdb = await safeGet(tmdbUrl);

      recommendations = (tmdb.data.results || []).slice(0, 12).map((item) => ({
        id: item.id,
        title: item.title || item.name,
        overview: item.overview,
        poster_path: item.poster_path,  // << FIXED so frontend displays images correctly
        release_date: item.release_date || item.first_air_date || "N/A",
        rating: item.vote_average
      }));
    }

    res.status(200).json({
      type,
      genres,
      recommendations
    });
  } catch (err) {
    console.error("🚨 Error:", err);
    res.status(500).json({ error: err.message });
  }
}
