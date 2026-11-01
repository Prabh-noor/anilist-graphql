"use strict";

const path = require("node:path");
const express = require("express");
const axios = require("axios");

const PORT = Number(process.env.PORT) || 3000;
const ANILIST_URL = "https://graphql.anilist.co";
const PUBLIC_DIR = path.join(__dirname, "public");

const PAGE_SIZE = 15;
const MAX_PER_PAGE = 50;
const MAX_SEARCH_LENGTH = 100;

// Shared between the list and detail queries so cards always get the fields
// they render.
const ANIME_FIELDS = `
  id
  title {
    romaji
    english
    native
  }
  coverImage {
    large
    extraLarge
  }
  averageScore
  episodes
  format
  seasonYear
  genres
`;

// One GraphQL document, one upstream request: aliased Page fields return both
// home page rows.
const HOME_QUERY = `
  query HomeAnime($page: Int, $perPage: Int) {
    trending: Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: TRENDING_DESC) {
        ${ANIME_FIELDS}
        trending
      }
    }
    popular: Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: POPULARITY_DESC) {
        ${ANIME_FIELDS}
        popularity
      }
    }
  }
`;

const SEARCH_QUERY = `
  query SearchAnime($search: String, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        currentPage
        hasNextPage
      }
      media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
        ${ANIME_FIELDS}
      }
    }
  }
`;

// fetch nested api data
const DETAIL_QUERY = `
  query AnimeDetail($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title {
        romaji
        english
        native
      }
      description(asHtml: true)
      bannerImage
      coverImage {
        extraLarge
        large
        color
      }
      format
      status
      season
      seasonYear
      episodes
      duration
      startDate { year month day }
      endDate { year month day }
      source
      countryOfOrigin
      averageScore
      meanScore
      popularity
      favourites
      genres
      studios(isMain: true) {
        nodes { name }
      }
      characters(sort: [ROLE, RELEVANCE, ID], perPage: 12) {
        edges {
          role
          node {
            id
            name { full }
            image { large }
          }
          voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
            id
            name { full }
            image { large }
          }
        }
      }
      stats {
        scoreDistribution { score amount }
      }
    }
  }
`;

const anilist = axios.create({
  baseURL: ANILIST_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json"
  }
});

const app = express();

/**
 * POST a GraphQL document to AniList and return its `data` payload.
 * AniList reports useful problems (unknown id, bad variable types) as GraphQL
 * errors in the response body, even with 4xx statuses, so those are translated
 * into errors the route handlers can map to client-friendly responses.
 */
async function queryAniList(query, variables = {}) {
  let response;

  try {
    response = await anilist.post("/", { query, variables });
  } catch (cause) {
    const upstream = cause.response;
    const messages = upstream?.data?.errors
      ?.map(entry => entry.message)
      .filter(Boolean);

    const error = new Error(
      messages?.length ? messages.join("; ") : "AniList is unavailable right now."
    );
    error.status = upstream?.status === 404 ? 404 : 502;
    throw error;
  }

  if (response.data?.errors?.length) {
    const error = new Error(
      response.data.errors.map(entry => entry.message).filter(Boolean).join("; ")
    );
    error.status = 502;
    throw error;
  }

  return response.data?.data ?? {};
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// validate pagination values
function parsePagination(query) {
  return {
    page: parsePositiveInt(query.page, 1),
    perPage: Math.min(MAX_PER_PAGE, parsePositiveInt(query.perPage, PAGE_SIZE))
  };
}

function sendUpstreamError(res, error, message) {
  console.error(`[AniList] ${error.message}`);
  res.status(error.status || 502).json({ error: message });
}

app.get("/api/home", async (req, res) => {
  const { page, perPage } = parsePagination(req.query);

  try {
    const data = await queryAniList(HOME_QUERY, { page, perPage });
    res.json({
      trending: data.trending?.media ?? [], // handle missing data
      popular: data.popular?.media ?? []
    });
  } catch (error) {
    sendUpstreamError(res, error, "Couldn't load anime from AniList. Please try again.");
  }
});

app.get("/api/search", async (req, res) => {
  const term = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!term) {
    return res.status(400).json({ error: "A search term is required." });
  }

  if (term.length > MAX_SEARCH_LENGTH) {
    return res.status(400).json({
      error: `Search terms must be ${MAX_SEARCH_LENGTH} characters or fewer.`
    });
  }

  const { page, perPage } = parsePagination(req.query);

  try {
    const data = await queryAniList(SEARCH_QUERY, {
      search: term,
      page,
      perPage
    });

    res.json({
      media: data.Page?.media ?? [],
      pageInfo: data.Page?.pageInfo ?? {
        currentPage: page,
        hasNextPage: false
      }
    });
  } catch (error) {
    sendUpstreamError(res, error, "Couldn't search AniList. Please try again.");
  }
});

app.get("/api/anime/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "A valid anime id is required." });
  }

  try {
    const data = await queryAniList(DETAIL_QUERY, { id });

    if (!data.Media) {
      return res.status(404).json({ error: "That anime could not be found." });
    }

    res.json({ media: data.Media });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ error: "That anime could not be found." });
    }

    sendUpstreamError(res, error, "Couldn't load this anime. Please try again.");
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

// `extensions` keeps the existing extensionless URLs (/search?q=..., /anime?id=...).
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`Enjoy AniList running at http://localhost:${PORT}`);
});
