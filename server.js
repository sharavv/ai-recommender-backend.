import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import cors from "cors";
import https from "https";
import { initDb } from "./db.js";

dotenv.config(); // Load environment variables

// ✅ ENV CHECK
console.log("🧠 ENV CHECK:");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Loaded" : "❌ Missing");
console.log("SPOTIFY_CLIENT_ID:", process.env.SPOTIFY_CLIENT_ID ? "✅ Loaded" : "❌ Missing");
console.log("TMDB_API_KEY:", process.env.TMDB_API_KEY ? "✅ Loaded" : "❌ Missing");

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OpenAI + SQLite
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let dbPromise = initDb();

// 🎵 Spotify Token Cache
let spotifyToken = null;
let spotifyTokenExpiresAt = 0;

// 🎵 Get Spotify access token
async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiresAt - 60000) {
    return spotifyToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Spotify client id/secret not set");
  }

  const tokenResp = await axios({
    url: "https://accounts.spotify.com/api/token",
    method: "post",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    data: "grant_type=client_credentials",
  });

  spotifyToken = tokenResp.data.access_token;
  spotifyTokenExpiresAt = Date.now() + (tokenResp.data.expires_in || 3600) * 1000;
  return spotifyToken;
}

// 🧠 Interpret user input with OpenAI
async function interpretInput(userInput) {
  const prompt = `User input: "${userInput}"
Determine:
1) type: one of "movie", "tv", "song" (if unsure, pick movie)
2) up to two short keywords or genres that capture the user's request (as array).
Respond ONLY as a JSON object, e.g. {"type":"movie","keywords":["mystery","thriller"]}.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
  });

  const txt = resp.choices?.[0]?.message?.content?.trim();
  try {
    return JSON.parse(txt);
  } catch {
    return { type: "movie", keywords: [userInput] };
  }
}

// 🌐 Safe GET with retry for TMDB
async function safeGet(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        timeout: 10000,
        httpsAgent: new https.Agent({ keepAlive: true }),
      });
    } catch (err) {
      if (err.code === "ECONNRESET" && i < retries - 1) {
        console.warn(`⚠️ Connection reset — retrying (${i + 1}/${retries})...`);
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        throw err;
      }
    }
  }
}

// 🎬 Main recommendation route
app.post("/recommend", async (req, res) => {
  try {
    const userInput = req.body.input;
    if (!userInput) {
      return res.status(400).json({ error: "No input provided" });
    }

    const interpretation = await interpretInput(userInput);
    const type = interpretation.type || "movie";
    const keywords =
      (interpretation.keywords && interpretation.keywords.join(" ")) ||
      userInput;

    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) {
      return res.status(500).json({ error: "TMDB_API_KEY not set in .env" });
    }

    let recommendations = [];

    // 🎵 SONGS (Spotify)
    if (type === "song") {
      const token = await getSpotifyToken();
      const safeQuery = encodeURIComponent(keywords.split(" ").slice(0, 4).join(" "));
      const spResp = await axios.get(
        `https://api.spotify.com/v1/search?q=${safeQuery}&type=track&limit=8`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        }
      );
      const tracks = spResp.data?.tracks?.items || [];
      recommendations = tracks.map((t) => ({
        id: t.id,
        title: t.name,
        artists: t.artists.map((a) => a.name).join(", "),
        preview_url: t.preview_url,
        album_image: t.album.images?.[0]?.url || null,
        external_url: t.external_urls?.spotify || null,
      }));
    }

    // 🎬 MOVIES / TV SHOWS (TMDB)
    else {
      const safeKeywords = keywords.split(" ").slice(0, 4).join(" ");
      const tmdbUrl =
        type === "tv"
          ? `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${encodeURIComponent(safeKeywords)}&language=en-US&page=1`
          : `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(safeKeywords)}&language=en-US&page=1`;

      const tmdbResp = await safeGet(tmdbUrl);
      const results = tmdbResp.data?.results || [];

      recommendations = results.slice(0, 8).map((r) => ({
        id: r.id,
        title: r.title || r.name,
        overview: r.overview || "",
        poster_path: r.poster_path || null,
        tmdb_score: r.vote_average || null,
        release_date: r.release_date || r.first_air_date || null,
      }));
    }

    // 🗂️ Save history
    const db = await dbPromise;
    const ins = await db.run(
      "INSERT INTO history (type, query, picked_title, picked_id, picked_medium) VALUES (?,?,?,?,?)",
      [type, userInput, null, null, null]
    );

    res.json({ type, keywords, recommendations, history_id: ins.lastID });
  } catch (err) {
    console.error("🚨 Error /recommend:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// 💬 Save user feedback
app.post("/feedback", async (req, res) => {
  try {
    const { history_id, feedback, picked_id, picked_title, picked_medium } = req.body;
    if (!history_id || !feedback) {
      return res.status(400).json({ error: "history_id and feedback required" });
    }

    const db = await dbPromise;
    await db.run("INSERT INTO feedback (history_id, feedback) VALUES (?,?)", [
      history_id,
      feedback,
    ]);

    if (picked_id || picked_title) {
      await db.run(
        "UPDATE history SET picked_title = ?, picked_id = ?, picked_medium = ? WHERE id = ?",
        [picked_title || null, picked_id || null, picked_medium || null, history_id]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Error /feedback:", e);
    res.status(500).json({ error: "Could not save feedback" });
  }
});

// 📜 Fetch recent history
app.get("/history", async (req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all(
      "SELECT * FROM history ORDER BY timestamp DESC LIMIT 50"
    );
    res.json(rows);
  } catch (e) {
    console.error("Error /history:", e);
    res.status(500).json({ error: "Could not fetch history" });
  }
});

// ✅ Single app.listen
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
