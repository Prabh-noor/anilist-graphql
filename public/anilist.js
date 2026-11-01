// Shared helpers for the Enjoy AniList frontend. Loaded as a classic script
// after the Axios browser build. All data comes from our Express API, which
// proxies the GraphQL calls to AniList.
(function () {
  const API_URL = "/api";
  const PAGE_SIZE = 15;

  const api = window.axios.create({
    baseURL: API_URL,
    timeout: 15000,
    headers: { "Accept": "application/json" }
  });

  function toApiError(error, fallbackMessage) {
    const status = error.response?.status;
    const message = error.response?.data?.error
      || (error.code === "ECONNABORTED"
        ? "The request timed out. Please try again."
        : fallbackMessage);

    const wrapped = new Error(message);
    wrapped.status = status;
    wrapped.cause = error;
    return wrapped;
  }

  async function request(path, { params, signal } = {}) {
    try {
      const response = await api.get(path, { params, signal });
      return response.data;
    } catch (error) {
      // Keep the AbortError name so callers can ignore cancelled requests.
      if (error.code === "ERR_CANCELED") {
        const aborted = new Error("Request aborted");
        aborted.name = "AbortError";
        throw aborted;
      }
      throw toApiError(error, "Couldn't reach the anime service. Please try again.");
    }
  }

  function getHomeSections({ page = 1, perPage = PAGE_SIZE, signal } = {}) {
    return request("/home", { params: { page, perPage }, signal });
  }

  function searchAnime({ q, page = 1, perPage = PAGE_SIZE, signal } = {}) {
    return request("/search", { params: { q, page, perPage }, signal });
  }

  function getAnime(id, { signal } = {}) {
    return request(`/anime/${encodeURIComponent(id)}`, { signal });
  }

  function getAnimeTitle(anime) {
    return anime.title?.english || anime.title?.romaji || anime.title?.native || "Untitled anime";
  }

  function formatLabel(format) {
    return ({
      TV: "TV",
      TV_SHORT: "Short",
      MOVIE: "Movie",
      OVA: "OVA",
      ONA: "ONA",
      SPECIAL: "Special",
      MUSIC: "Music"
    })[format] || format;
  }

  function createCard(anime) {
    const card = document.createElement("a");
    card.className = "card";
    card.href = `anime?id=${encodeURIComponent(anime.id)}`;
    card.setAttribute("aria-label", `View details for ${getAnimeTitle(anime)}`);

    const imageWrap = document.createElement("div");
    imageWrap.className = "card-image";

    const image = document.createElement("img");
    image.src = anime.coverImage?.extraLarge || anime.coverImage?.large || "";
    image.alt = `${getAnimeTitle(anime)} cover`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => {
      imageWrap.textContent = "Cover unavailable";
      imageWrap.style.display = "grid";
      imageWrap.style.placeItems = "center";
      imageWrap.style.color = "var(--muted)";
      imageWrap.style.fontSize = "0.8rem";
    }, { once: true });

    imageWrap.appendChild(image);

    const info = document.createElement("div");
    info.className = "card-info";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = getAnimeTitle(anime);
    title.title = getAnimeTitle(anime);

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const details = [];
    if (anime.seasonYear) details.push(anime.seasonYear);
    if (anime.format) details.push(formatLabel(anime.format));
    if (anime.episodes) details.push(`${anime.episodes} eps`);

    meta.textContent = details.join(" · ") || "Anime";

    info.append(title, meta);

    if (anime.averageScore) {
      const score = document.createElement("div");
      score.className = "card-meta score";
      score.textContent = `★ ${(anime.averageScore / 10).toFixed(1)}`;
      info.appendChild(score);
    }

    card.append(imageWrap, info);
    return card;
  }

  function renderCards(containerOrId, animeList, emptyMessage = "No anime found.") {
    const container = typeof containerOrId === "string"
      ? document.getElementById(containerOrId)
      : containerOrId;

    container.replaceChildren();

    if (!animeList.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    animeList.forEach(anime => fragment.appendChild(createCard(anime)));
    container.appendChild(fragment);
  }

  window.AniList = {
    PAGE_SIZE,
    getHomeSections,
    searchAnime,
    getAnime,
    getAnimeTitle,
    formatLabel,
    createCard,
    renderCards
  };
})();
