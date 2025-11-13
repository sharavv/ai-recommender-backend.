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

// === AI INTERPRETER — returns real genre names ===
async function interpretInput(userInput) {
  const prompt = `
Interpret the user's request STRICTLY as GENRES or MOODS.
Return JSON only:

{
  "type": "movie" | "tv" | "song",
  "genres": ["genre1", "genre2"]
}

Translate slang into proper genres:
- funny → comedy
- sad → drama / emotional / melancholy
- creepy → horror
- action-packed → action
- sci-fi → science fiction
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

// TMDB Genre ID Maps
const MOVIE_GENRES = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  "science fiction": 878,
  thriller: 53,
  war: 10752,
  western: 37
};

const TV_GENRES = {
  action: 10759,
  adventure: 10759,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  kids: 10762,
  mystery: 9648,
  news: 10763,
  reality: 10764,
  "sci-fi": 10765,
  fantasy: 10765,
  war: 10768,
  western: 37
};

// Convert names → ID numbers
function convertGenresToIds(type, genres) {
  const lookup = type === "tv" ? TV_GENRES : MOVIE_GENRES;

  return genres
    .map((g) => lookup[g.toLowerCase()])
    .filter(Boolean);
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { input } = req.body;
    const forcedType = req.headers["x-type"]; // movie / tv / song

    if (!input) return res.status(400).json({ error: "No input provided" });

    // AI interprets genres
    const interpretation = await interpretInput(input);
    const type = forcedType || interpretation.type || "movie";
    const genres = interpretation.genres || [];

    //----------------------------------------------------
    // SONGS (Spotify)
    //----------------------------------------------------
    if (type === "song") {
      const token = await getSpotifyToken();
      const q = encodeURIComponent(genres.join(" "));

      const sp = await axios.get(
        `https://api.spotify.com/v1/search?q=${q}&type=track&limit=10`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      return res.status(200).json({
        type,
        genres,
        recommendations: sp.data.tracks.items.map((t) => ({
          title: t.name,
          artists: t.artists.map((a) => a.name).join(", "),
          album_image: t.album.images?.[0]?.url,
          preview_url: t.preview_url,
          spotify_url: t.external_urls.spotify
        }))
      });
    }

    //----------------------------------------------------
    // MOVIE / TV GENRE FILTERING (THE FIX!)
    //----------------------------------------------------
    const tmdbApiKey = process.env.TMDB_API_KEY;

    const genreIds = convertGenresToIds(type, genres);

    const discoverURL =
      type === "movie"
        ? `https://api.themoviedb.org/3/discover/movie?api_key=${tmdbApiKey}&with_genres=${genreIds.join(",")}`
        : `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbApiKey}&with_genres=${genreIds.join(",")}`;

    const tmdb = await safeGet(discoverURL);

    return res.status(200).json({
      type,
      genres,
      recommendations: (tmdb?.data?.results || []).slice(0, 12).map((item) => ({
        id: item.id,
        title: item.title || item.name,
        overview: item.overview,
        poster_path: item.poster_path,
        release_date: item.release_date || item.first_air_date,
        rating: item.vote_average
      }))
    });
  } catch (err) {
    console.error("🚨 Error:", err);
    res.status(500).json({ error: err.message });
  }
}
