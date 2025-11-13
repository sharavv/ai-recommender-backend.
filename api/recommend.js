import axios from "axios";
import dotenv from "dotenv";
import https from "https";

dotenv.config();

// Spotify token caching
let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt - 60000) {
    return spotifyToken;
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify credentials missing");
  }

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

async function safeGet(url) {
  return await axios.get(url, {
    timeout: 10000,
    httpsAgent: new https.Agent({ keepAlive: true }),
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const type = req.headers["x-type"] || "movie"; // READ TYPE FROM FRONTEND
    const { input } = req.body;

    if (!input) return res.status(400).json({ error: "No input provided" });

    let recommendations = [];

    // SONGS → Spotify
    if (type === "song") {
      const token = await getSpotifyToken();
      const q = encodeURIComponent(input);

      const sp = await axios.get(
        `https://api.spotify.com/v1/search?q=${q}&type=track&limit=8`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      recommendations = sp.data.tracks.items.map((t) => ({
        title: t.name,
        artists: t.artists.map((a) => a.name).join(", "),
        album_image: t.album.images?.[0]?.url,
        spotify_url: t.external_urls.spotify,
        preview_url: t.preview_url
      }));
    }

    // MOVIE / TV → TMDB
    else {
      const tmdbApiKey = process.env.TMDB_API_KEY;
      const q = encodeURIComponent(input);

      const tmdbUrl =
        type === "tv"
          ? `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${q}`
          : `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${q}`;

      const tmdb = await safeGet(tmdbUrl);
      recommendations = (tmdb.data.results || []).slice(0, 8);
    }

    res.status(200).json({ type, recommendations });
  } catch (err) {
    console.error("🚨 Error:", err);
    res.status(500).json({ error: err.message });
  }
}
