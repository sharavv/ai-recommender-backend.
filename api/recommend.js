// === /api/recommend.js ===
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { input, type } = req.body;
  console.log(`🎯 Request received: type=${type}, query=${input}`);

  if (!input) {
    return res.status(400).json({ error: "Missing input" });
  }

  try {
    let recommendations = [];

    // ==========================
    // 🎬 MOVIES
    // ==========================
    if (type === "movie") {
      const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(
        input
      )}`;
      const movieResp = await fetch(tmdbUrl);
      const movieData = await movieResp.json();

      recommendations = movieData.results
        ?.slice(0, 10)
        .map((m) => ({
          title: m.title,
          release_date: m.release_date,
          poster_path: m.poster_path,
        })) || [];
    }

    // ==========================
    // 📺 TV SHOWS
    // ==========================
    else if (type === "tv") {
      const tmdbUrl = `https://api.themoviedb.org/3/search/tv?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(
        input
      )}`;
      const tvResp = await fetch(tmdbUrl);
      const tvData = await tvResp.json();

      recommendations = tvData.results
        ?.slice(0, 10)
        .map((t) => ({
          name: t.name,
          first_air_date: t.first_air_date,
          poster_path: t.poster_path,
        })) || [];
    }

    // ==========================
    // 🎵 SONGS
    // ==========================
    else if (type === "song") {
      // Get Spotify Access Token
      const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      const tokenData = await tokenResp.json();
      const accessToken = tokenData.access_token;

      // Search songs on Spotify
      const spotifyUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        input
      )}&type=track&limit=10`;
      const spotifyResp = await fetch(spotifyUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const spotifyData = await spotifyResp.json();

      recommendations =
        spotifyData.tracks?.items.map((track) => ({
          title: track.name,
          artists: track.artists.map((a) => a.name).join(", "),
          album_image: track.album.images[0]?.url,
        })) || [];
    }

    // ==========================
    // ❓ DEFAULT
    // ==========================
    else {
      return res.status(400).json({ error: "Invalid type provided" });
    }

    // ==========================
    // ✅ Send results
    // ==========================
    console.log(`✅ ${recommendations.length} ${type}s found.`);
    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("❌ Error fetching recommendations:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
