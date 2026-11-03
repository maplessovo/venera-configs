class ShonenJumpPlus extends ComicSource {
  name = "少年ジャンプ＋";
  key = "shonen_jump_plus";
  version = "1.2.0";
  minAppVersion = "1.2.1";
  url =
    "https://cdn.jsdelivr.net/gh/maplessovo/venera-configs@main/shonen_jump_plus.js";

  settings = {
    access_mode: {
      title: "阅读方式",
      type: "select",
      options: [
        {value: "web", text: "官方公开网页"},
        {value: "app", text: "原应用接口"},
      ],
      default: "web",
    },
  };

  get publicWebMode() {
    return this.loadSetting("access_mode") !== "app";
  }

  async publicGet(path) {
    if (!/^\/(?:episode\/\d+(?:[/?#]|$)|api\/viewer\/pagination_readable_products\?|search(?:\?|$)|$)/.test(path)) {
      throw new Error("无效的官方网页路径");
    }
    const response = await Network.get(`https://shonenjumpplus.com${path}`, {
      "Referer": "https://shonenjumpplus.com/",
      "Accept": "text/html,application/json",
    });
    if (response.status !== 200) {
      throw new Error(`少年ジャンプ＋公开网页请求失败（HTTP ${response.status}）`);
    }
    return response.body;
  }

  publicEpisodeId(value) {
    const match = String(value || "").match(/^(?:web:|(?:https:\/\/shonenjumpplus\.com)?\/episode\/)(\d+)(?:[/?#].*)?$/);
    return match ? match[1] : null;
  }

  publicCards(html) {
    const document = new HtmlDocument(html);
    try {
      const comics = [], seen = new Set();
      for (const link of document.querySelectorAll('a[href*="/episode/"]')) {
        const episodeId = this.publicEpisodeId(link.attributes.href);
        const image = link.querySelector("img.daily-series-thumb-square") || link.querySelector("img");
        const titleNode = link.querySelector(".daily-series-title, .series-list-title, .series-title, .search-series-title, h2, h3");
        const title = (titleNode?.text || image?.attributes.alt || link.text || "").trim();
        const cover = image?.attributes["data-src"] || image?.attributes.src || "";
        if (!episodeId || !title || !cover || seen.has(episodeId)) continue;
        seen.add(episodeId);
        comics.push(new Comic({id: `web:${episodeId}`, title, cover: this.replaceCoverUrl(cover)}));
      }
      return comics;
    } finally {
      document.dispose();
    }
  }

  publicProduct(html) {
    const document = new HtmlDocument(html);
    try {
      const value = document.querySelector("#episode-json")?.attributes["data-value"];
      if (!value) throw new Error("未找到官方公开阅读器数据");
      const product = JSON.parse(value).readableProduct;
      if (!product || !/^\d+$/.test(String(product.series?.id || ""))) {
        throw new Error("官方公开阅读器数据不完整");
      }
      return product;
    } finally {
      document.dispose();
    }
  }

  async publicInfo(id) {
    const episodeId = this.publicEpisodeId(id);
    if (!episodeId) throw new Error("无效的公开作品 ID");
    const product = this.publicProduct(await this.publicGet(`/episode/${episodeId}`));
    const chapters = new Map(), visited = new Set();
    // This is the same public, paginated chapter list used by the official web viewer.
    // It contains metadata only; locked pages are never purchased by this source path.
    for (let offset = 0; ; ) {
      if (offset >= 20000) throw new Error("公开章节列表超过安全上限，请稍后重试");
      const items = JSON.parse(await this.publicGet(
        `/api/viewer/pagination_readable_products?type=episode&aggregate_id=${product.series.id}&sort_order=desc&offset=${offset}`,
      ));
      if (!Array.isArray(items)) throw new Error("官方章节列表格式已变化");
      if (!items.length) break;
      let added = 0;
      for (const item of items) {
        const key = this.publicEpisodeId(item.viewer_uri) || (/^\d+$/.test(String(item.readable_product_id)) ? String(item.readable_product_id) : null);
        if (!key || visited.has(key)) continue;
        visited.add(key); added++;
        chapters.set(`web:${key}`, String(item.title || key));
      }
      if (!added) throw new Error("官方章节分页重复，请稍后重试");
      offset += items.length;
    }
    if (!chapters.has(`web:${episodeId}`)) chapters.set(`web:${episodeId}`, product.title || "当前章节");
    return new ComicDetails({
      title: product.series.title || product.title || "少年ジャンプ＋",
      cover: this.replaceCoverUrl(product.series.thumbnailUri),
      chapters: new Map([...chapters].reverse()),
      url: `https://shonenjumpplus.com/episode/${episodeId}`,
      description: "官方公开网页阅读。未公开或需要购买的章节不会自动购买；可在漫画源设置中选择原应用接口。",
    });
  }

  async publicPages(id) {
    const episodeId = this.publicEpisodeId(id);
    if (!episodeId) throw new Error("无效的公开章节 ID");
    const product = this.publicProduct(await this.publicGet(`/episode/${episodeId}`));
    const structure = product.pageStructure;
    if (!structure || !Array.isArray(structure.pages)) {
      throw new Error("此章节未向当前网页用户公开，可能需要购买、登录或使用官方 APP");
    }
    const images = structure.pages.filter(page => page.type === "main" && typeof page.src === "string" && /^https:\/\//.test(page.src))
      .map(page => structure.choJuGiga === "baku" ? `${page.src}#jump-baku` : page.src);
    if (!images.length) throw new Error("此章节没有可公开读取的图片");
    return {images};
  }

  publicImageConfig(url) {
    const scrambled = url.endsWith("#jump-baku");
    return {
      url: scrambled ? url.slice(0, -10) : url,
      headers: {"Referer": "https://shonenjumpplus.com/"},
      // GigaViewer's public 'baku' image format transposes a 4x4 grid, aligned to 8 pixels.
      // Format reference: keiyoushi/extensions-source, multisrc/gigaviewer/ImageInterceptor.kt.
      modifyImage: scrambled ? `let modifyImage = image => {
        const width = image.width, height = image.height;
        const w = Math.floor(width / 32) * 8, h = Math.floor(height / 32) * 8;
        if (!w || !h) return image;
        const result = Image.empty(width, height);
        result.fillImageAt(0, 0, image);
        for (let n = 0; n < 16; n++) {
          const x = n % 4, y = Math.floor(n / 4);
          result.fillImageRangeAt(y * w, x * h, image, x * w, y * h, w, h);
        }
        return result;
      }; modifyImage;` : null,
    };
  }

  parseJsonResponse(response, stage) {
    if (response.status !== 200) throw new Error(`少年ジャンプ＋${stage}请求失败（HTTP ${response.status}），可在漫画源设置切换为官方公开网页`);
    try { return JSON.parse(response.body); }
    catch (_) { throw new Error(`少年ジャンプ＋${stage}返回了非 JSON 页面，请使用官方公开网页或稍后重试`); }
  }

  deviceId = this.generateDeviceId();
  bearerToken = null;
  userAccountId = null;
  tokenExpiry = 0;
  latestVersion = "4.0.24";

  get headers() {
    return {
      "Origin": "https://shonenjumpplus.com",
      "Referer": "https://shonenjumpplus.com/",
      "X-Giga-Device-Id": this.deviceId,
      "User-Agent": `ShonenJumpPlus-Android/${this.latestVersion}`,
    };
  }

  apiBase = `https://shonenjumpplus.com/api/v1`;
  generateDeviceId() {
    let result = "";
    const chars = "0123456789abcdef";
    for (let i = 0; i < 16; i++) {
      result += chars[randomInt(0, chars.length - 1)];
    }
    return result;
  }

  async init() {
    if (this.publicWebMode) return;
    const url = "https://apps.apple.com/jp/app/id875750302";

    const resp = await Network.get(url);

    const match = resp.body.match(/whats-new__latest__version">[^<]*?([\d.]+)</);

    if (match && match[1]) {
      this.latestVersion = match[1];
    }
  }

  explore = [
    {
      title: "少年ジャンプ＋",
      type: "singlePageWithMultiPart",
      load: async () => {
        if (this.publicWebMode) return {"公开作品": this.publicCards(await this.publicGet("/"))};
        await this.ensureAuth();

        const response = await this.graphqlRequest("HomeCacheable", {});

        if (!response || !response.data || !response.data.homeSections) {
          throw "Cannot fetch home sections";
        }

        const sections = response.data.homeSections;
        const dailyRankingSection = sections.find((section) =>
          section.__typename === "DailyRankingSection"
        );

        if (!dailyRankingSection || !dailyRankingSection.dailyRankings) {
          throw "Cannot fetch daily ranking data";
        }

        const dailyRanking = dailyRankingSection.dailyRankings.find((ranking) =>
          ranking.ranking && ranking.ranking.__typename === "DailyRanking"
        );

        if (
          !dailyRanking || !dailyRanking.ranking ||
          !dailyRanking.ranking.items || !dailyRanking.ranking.items.edges
        ) {
          throw "Cannot fetch ranking data structure";
        }

        const rankingItems = dailyRanking.ranking.items.edges.map((edge) =>
          edge.node
        ).filter((node) =>
          node.__typename === "DailyRankingValidItem" && node.product
        );

        function parseComic(item) {
          const series = item.product.series;
          if (!series) return null;

          const cover = series.squareThumbnailUriTemplate ||
            series.horizontalThumbnailUriTemplate;

          return {
            id: series.databaseId,
            title: series.title || "",
            cover: cover
              ? cover.replace("{height}", "500").replace("{width}", "500")
              : "",
            tags: [],
            description: `Ranking: ${item.rank} · Views: ${
              item.viewCount || "Unknown"
            }`,
          };
        }

        const comics = rankingItems.map(parseComic).filter((comic) =>
          comic !== null
        );

        const result = {};
        result["Daily Ranking"] = comics;
        return result;
      },
    },
  ];

  search = {
    load: async (keyword, _, page) => {
      if (this.publicWebMode) {
        const comics = this.publicCards(await this.publicGet(`/search?q=${encodeURIComponent(keyword)}`));
        return {comics: (page || 1) === 1 ? comics : [], maxPage: 1};
      }
      if (!this.bearerToken || Date.now() > this.tokenExpiry) {
        await this.fetchBearerToken();
      }

      const operationName = "SearchResult";

      const response = await this.graphqlRequest(operationName, {
        keyword,
      });
      const edges = response?.data?.search?.edges || [];
      const pageInfo = response?.data?.search?.pageInfo || {};

      const comics = edges.map(({ node }) => {
        const authors = (node.author?.name || "").split(/\s*\/\s*/).filter(
          Boolean,
        );
        const cover = node.latestIssue?.thumbnailUriTemplate ||
          node.thumbnailUriTemplate;
        if (node.__typename === "Series") {
          return new Comic({
            id: node.databaseId,
            title: node.title || "",
            cover: this.replaceCoverUrl(cover),
            description: node.description || "",
            tags: authors,
          });
        }
        if (node.__typename === "MagazineLabel") {
          return new Comic({
            id: node.databaseId,
            title: node.title || "",
            cover: this.replaceCoverUrl(cover),
          });
        }
        return null;
      }).filter(Boolean);

      return {
        comics,
        maxPage: pageInfo.hasNextPage ? (page || 1) + 1 : (page || 1),
        endCursor: pageInfo.endCursor,
      };
    },
  };

  comic = {
    loadInfo: async (id) => {
      if (String(id).startsWith("web:")) return this.publicInfo(id);
      if (this.publicWebMode) throw new Error("此书架记录来自旧版源，请在公开网页模式搜索同名作品重新加入，或在源设置切换原应用接口");
      await this.ensureAuth();
      const seriesData = await this.fetchSeriesDetail(id);
      const episodes = await this.fetchEpisodes(id);

      const { chapters, latestPublishAt } = episodes.reduce(
        (acc, ep) => ({
          chapters: {
            ...acc.chapters,
            [ep.databaseId]: ep.title || "",
          },
          latestPublishAt:
            ep.publishedAt && ep.publishedAt > acc.latestPublishAt
              ? ep.publishedAt
              : acc.latestPublishAt,
        }),
        { chapters: {}, latestPublishAt: "" },
      );

      const maxDate = latestPublishAt > seriesData.openAt
        ? latestPublishAt
        : seriesData.openAt;
      const updateDate = new Date(new Date(maxDate) - 60 * 60 * 1000);
      const authors = (seriesData.author?.name || "").split(/\s*\/\s*/).filter(
        Boolean,
      );

      return new ComicDetails({
        title: seriesData.title || "",
        subtitle: authors.join(" / "),
        cover: this.replaceCoverUrl(seriesData.thumbnailUriTemplate),
        description: seriesData.description || "",
        tags: {
          "Author": authors,
          "Update": [updateDate.toISOString().slice(0, 10)],
        },
        url: `https://shonenjumpplus.com/app/episode/${seriesData.publisherId}`,
        chapters,
      });
    },

    loadEp: async (comicId, epId) => {
      if (String(epId).startsWith("web:")) return this.publicPages(epId);
      if (this.publicWebMode) throw new Error("此章节来自旧版源，请在公开网页模式搜索同名作品重新加入，或在源设置切换原应用接口");
      await this.ensureAuth();
      const episodeId = this.normalizeEpisodeId(epId);
      const episodeData = await this.fetchEpisodePages(episodeId);

      if (!this.isEpisodeAccessible(episodeData)) {
        await this.handleEpisodePurchase(episodeData);
        return this.comic.loadEp(comicId, epId);
      }

      return this.buildImageUrls(episodeData);
    },

    onImageLoad: (url) => {
      if (!url.includes("?token=")) return this.publicImageConfig(url);
      const [cleanUrl, token] = url.split("?token=");
      return {
        url: cleanUrl,
        headers: { "X-Giga-Page-Image-Auth": token },
      };
    },

    onClickTag: (namespace, tag) => {
      if (namespace === "Author") {
        return {
          action: "search",
          keyword: `${tag}`,
          param: null,
        };
      }
      throw "Unsupported tag namespace: " + namespace;
    },
  };

  async ensureAuth() {
    if (!this.bearerToken || Date.now() > this.tokenExpiry) {
      await this.fetchBearerToken();
    }
  }

  async graphqlRequest(operationName, variables) {
    const payload = {
      operationName,
      variables,
      query: GraphQLQueries[operationName],
    };
    const response = await Network.post(
      `${this.apiBase}/graphql?opname=${operationName}`,
      {
        ...this.headers,
        "Authorization": `Bearer ${this.bearerToken}`,
        "Accept": "application/json",
        "X-APOLLO-OPERATION-NAME": operationName,
        "Content-Type": "application/json",
      },
      JSON.stringify(payload),
    );

    return this.parseJsonResponse(response, "应用查询");
  }

  normalizeEpisodeId(epId) {
    if (typeof epId === "object") return epId.id;
    if (typeof epId === "string" && epId.includes("/")) {
      return epId.split("/").pop();
    }
    return epId;
  }

  replaceCoverUrl(url) {
    return (url || "").replace("{height}", "1500").replace(
      "{width}",
      "1500",
    ) || "";
  }

  async fetchBearerToken() {
    const response = await Network.post(
      `${this.apiBase}/user_account/access_token`,
      this.headers,
      "",
    );
    const { access_token, user_account_id } = this.parseJsonResponse(response, "应用认证");
    if (typeof access_token !== "string" || !access_token) throw new Error("少年ジャンプ＋应用认证没有返回有效令牌");
    this.bearerToken = access_token;
    this.userAccountId = user_account_id;
    this.tokenExpiry = Date.now() + 3600000;
  }

  async fetchSeriesDetail(id) {
    const response = await this.graphqlRequest("SeriesDetail", { id });
    return response?.data?.series || {};
  }

  async fetchEpisodes(id) {
    const response = await this.graphqlRequest(
      "SeriesDetailEpisodeList",
      { id, episodeOffset: 0, episodeFirst: 1500, episodeSort: "NUMBER_ASC" },
    );
    const episodes = (response?.data?.series?.episodes?.edges || []).map(
      (edge) => edge.node
    );
    return episodes;
  }

  async fetchEpisodePages(episodeId) {
    const response = await this.graphqlRequest(
      "EpisodeViewerConditionallyCacheable",
      { episodeID: episodeId },
    );
    return response?.data?.episode || {};
  }

  isEpisodeAccessible({ purchaseInfo }) {
    return purchaseInfo?.isFree || purchaseInfo?.hasPurchased ||
      purchaseInfo?.hasRented;
  }

  async handleEpisodePurchase(episodeData) {
    const { id, purchaseInfo } = episodeData;
    const { purchasableViaOnetimeFree, rentable, unitPrice } = purchaseInfo ||
      {};

    if (purchasableViaOnetimeFree) await this.consumeOnetimeFree(id);
    if (rentable) await this.rentChapter(id, unitPrice);
  }

  buildImageUrls({ pageImages, pageImageToken }) {
    const validImages = pageImages.edges.flatMap((edge) => edge.node?.src)
      .filter(Boolean);
    return {
      images: validImages.map((url) => `${url}?token=${pageImageToken}`),
    };
  }

  async consumeOnetimeFree(episodeId) {
    const response = await this.graphqlRequest("ConsumeOnetimeFree", {
      input: { id: episodeId },
    });
    return response?.data?.consumeOnetimeFree?.isSuccess;
  }

  async rentChapter(episodeId, unitPrice, retryCount = 0) {
    if (retryCount > 3) {
      throw "Failed to rent chapter after multiple attempts.";
    }
    const response = await this.graphqlRequest("Rent", {
      input: { id: episodeId, unitPrice },
    });

    if (response.errors?.[0]?.extensions?.code === "FAILED_TO_USE_POINT") {
      await this.refreshAccount();
      return this.rentChapter(episodeId, unitPrice, retryCount + 1);
    }

    this.userAccountId = response?.data?.rent?.userAccount?.databaseId;
    return true;
  }

  async refreshAccount() {
    this.deviceId = this.generateDeviceId();
    this.bearerToken = this.userAccountId = null;
    this.tokenExpiry = 0;
    await this.fetchBearerToken();
    await this.addUserDevice();
  }

  async addUserDevice() {
    await this.graphqlRequest("AddUserDevice", {
      input: {
        deviceName: `Android ${21 + Math.floor(Math.random() * 14)}`,
        modelName: `Device-${Math.random().toString(36).slice(2, 10)}`,
        osName: `Android ${9 + Math.floor(Math.random() * 6)}`,
      },
    });
    this.addUserDeviceCalled = true;
  }
}

const GraphQLQueries = {
  "SearchResult": `query SearchResult($after: String, $keyword: String!) {
        search(after: $after, first: 50, keyword: $keyword, types: [SERIES,MAGAZINE_LABEL]) {
            pageInfo { hasNextPage endCursor }
            edges {
                node {
                    __typename
                    ... on Series { id databaseId title thumbnailUriTemplate author { name } description }
                    ... on MagazineLabel { id databaseId title thumbnailUriTemplate latestIssue { thumbnailUriTemplate } }
                }
            }
        }
    }`,
  "SeriesDetail": `query SeriesDetail($id: String!) {
        series(databaseId: $id) {
            id databaseId title thumbnailUriTemplate
            author { name }
            description
            hashtags serialUpdateScheduleLabel
            openAt
            publisherId
        }
    }`,
  "SeriesDetailEpisodeList":
    `query SeriesDetailEpisodeList($id: String!, $episodeOffset: Int, $episodeFirst: Int, $episodeSort: ReadableProductSorting) {
        series(databaseId: $id) {
            episodes: readableProducts(types: [EPISODE], first: $episodeFirst, offset: $episodeOffset, sort: $episodeSort) {
                edges { node { databaseId title publishedAt } }
            }
        }
    }`,
  "EpisodeViewerConditionallyCacheable":
    `query EpisodeViewerConditionallyCacheable($episodeID: String!) {
        episode(databaseId: $episodeID) {
            id pageImages { edges { node { src } } } pageImageToken
            purchaseInfo {
                isFree hasPurchased hasRented
                purchasableViaOnetimeFree rentable unitPrice
            }
        }
    }`,
  "ConsumeOnetimeFree":
    `mutation ConsumeOnetimeFree($input: ConsumeOnetimeFreeInput!) {
        consumeOnetimeFree(input: $input) { isSuccess }
    }`,
  "Rent": `mutation Rent($input: RentInput!) {
        rent(input: $input) {
            userAccount { databaseId }
        }
    }`,
  "AddUserDevice": `mutation AddUserDevice($input: AddUserDeviceInput!) {
        addUserDevice(input: $input) { isSuccess }
    }`,
  "HomeCacheable": `query HomeCacheable {
    homeSections {
      __typename
      ...DailyRankingSection
    }
  }
  fragment DesignSectionImage on DesignSectionImage {
    imageUrl width height
  }
  fragment SerialInfoIcon on SerialInfo {
    isOriginal isIndies
  }
  fragment DailyRankingSeries on Series {
    id databaseId publisherId title
    horizontalThumbnailUriTemplate: subThumbnailUri(type: HORIZONTAL_WITH_LOGO)
    squareThumbnailUriTemplate: subThumbnailUri(type: SQUARE_WITHOUT_LOGO)
    isNewOngoing supportsOnetimeFree
    serialInfo {
      __typename ...SerialInfoIcon
      status isTrial
    }
    jamEpisodeWorkType
  }
  fragment DailyRankingItem on DailyRankingItem {
    __typename
    ... on DailyRankingValidItem {
      product {
        __typename
        ... on Episode {
          id databaseId publisherId commentCount
          series {
            __typename ...DailyRankingSeries
          }
        }
        ... on SpecialContent {
          publisherId linkUrl
          series {
            __typename ...DailyRankingSeries
          }
        }
      }
      badge { name label }
      label rank viewCount
    }
    ... on DailyRankingInvalidItem {
      publisherWorkId
    }
  }
  fragment DailyRanking on DailyRanking {
    date firstPositionSeriesId
    items {
      edges {
        node {
          __typename ...DailyRankingItem
        }
      }
    }
  }
  fragment DailyRankingSection on DailyRankingSection {
    title
    titleImage {
      __typename ...DesignSectionImage
    }
    dailyRankings {
      ranking {
        __typename ...DailyRanking
      }
    }
  }`,
};
