/** @type {import('./_venera_.js')} */
class MH18 extends ComicSource {
  // Note: The fields which are marked as [Optional] should be removed if not used

  // name of the source
  name = "18漫画"

  // unique id of the source
  key = "mh18"

  version = "1.0.1"

  minAppVersion = "1.4.0"

  // update url
  url = "https://cdn.jsdelivr.net/gh/maplessovo/venera-configs@main/mh18.js"

  settings = {
    domains: {
      title: "域名",
      type: "input",
      default: "18mh.org"
    }
  }

  get baseUrl() {
    const domain = String(this.loadSetting("domains") || "18mh.org").trim()
      .replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `https://${domain}`;
  }

  get headers() {
    // Venera supplies the browser UA and reuses the UA associated with cf_clearance.
    return {
      "Referer": `${this.baseUrl}/`
    };
  }

  isCloudflareChallenge(response) {
    const headers = response.headers || {};
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "cf-mitigated" &&
        String(headers[name]).trim().toLowerCase() === "challenge") return true;
    }
    const body = typeof response.body === "string" ? response.body : "";
    if (/window\._cf_chl_opt|cf-browser-verification|id\s*=\s*["']challenge-form["']/i.test(body)) {
      return true;
    }
    if (/<title[^>]*>\s*Just a moment(?:\.{3}|…)?\s*<\/title>/i.test(body)) return true;
    return (response.status === 403 || response.status === 503) &&
      /\/cdn-cgi\/challenge-platform\/|__cf_chl_/i.test(body);
  }

  async request(url) {
    // Preserve native CloudflareException errors thrown by Network.get.
    const response = await Network.get(url, this.headers);
    if (this.isCloudflareChallenge(response)) {
      // Verify a full page on the challenged host, rather than an AJAX endpoint.
      // Venera recognizes this marker, syncs WebView cookies/UA, then retries.
      const origin = String(url).match(/^https?:\/\/[^/?#]+/i)?.[0] || this.baseUrl;
      throw `CloudflareException: ${origin}/`;
    }
    if (response.status !== 200) {
      throw `请求失败：HTTP ${response.status}`;
    }
    return response;
  }

  parseComics(doc) {
    console.warn(doc)
    const result = [];
    for (let item of doc.querySelectorAll(".pb-2")) {
      result.push(new Comic({
        id: item.querySelector("a").attributes["href"],
        title: item.querySelector("h3").text,
        cover: item.querySelector("img").attributes["src"]
      }))
    }
    return result;
  }

  // explore page list
  explore = [
    {
      // title of the page.
      // title is used to identify the page, it should be unique
      title: this.name,

      /// multiPartPage or multiPageComicList or mixed
      type: "multiPartPage",

      load: async () => {
        const res = await this.request(this.baseUrl);
        const document = new HtmlDocument(res.body);
        const result = [{ title: "近期更新", comics: [], viewMore: null }];
        for (let item of document.querySelector(".pb-unit-md").querySelectorAll(".slicarda")) {
          result[0].comics.push(new Comic({
            id: item.attributes["href"],
            title: item.querySelector("h3").text,
            cover: item.querySelector("img").attributes["src"]
          }))
        }
        const cardlists = document.querySelectorAll(".cardlist");
        const hometitles = document.querySelectorAll(".hometitle");
        for (let i = 0; i < hometitles.length; i++) {
          result.push({
            title: hometitles[i].querySelector("h2").text,
            comics: this.parseComics(cardlists[i]),
            viewMore: {
              page: "category",
              attributes: {
                category: hometitles[i].querySelector("h2").text,
                param: hometitles[i].attributes["href"]
              },
            }
          });
        }
        return result;
      }
    }
  ]

  // categories
  category = {
    /// title of the category page, used to identify the page, it should be unique
    title: this.name,
    parts: [
      {
        name: "类型",
        type: "fixed",
        categories: [
          "全部",
          "韓漫",
          "真人寫真",
          "日漫",
          "AI寫真",
          "熱門漫畫"
        ],
        itemType: "category",
        categoryParams: [
          "/manga",
          "/manga-genre/hanman",
          "/manga-genre/zhenrenxiezhen",
          "/manga-genre/riman",
          "/manga-genre/aixiezhen",
          "/manga-genre/hots"
        ],
      },
      {
        name: "标签",
        type: "fixed",
        categories: [
          "多人",
          "慾望",
          "正妹",
          "同居",
          "女學生",
          "劇情",
          "偷情",
          "校园",
          "逆襲",
          "办公室",
          "誘惑",
          "反转",
          "熟女",
          "人妻",
          "初戀",
          "少妇",
          "刺激",
          "女大学生",
          "治疗",
          "超能力",
          "浪漫校园",
          "戏剧",
          "学姐",
          "大学生",
          "泳衣",
          "暧昧",
          "写真",
          "女神",
          "大尺度",
          "纯情警察"
        ],
        itemType: "category",
        categoryParams: [
          "/manga-tag/duoren",
          "/manga-tag/yuwang",
          "/manga-tag/zhengmei",
          "/manga-tag/tongju",
          "/manga-tag/nxuesheng",
          "/manga-tag/juqing",
          "/manga-tag/touqing",
          "/manga-tag/xiaoyuan",
          "/manga-tag/nixi",
          "/manga-tag/bangongshi",
          "/manga-tag/youhuo",
          "/manga-tag/fanzhuan",
          "/manga-tag/shun",
          "/manga-tag/renqi",
          "/manga-tag/chulian",
          "/manga-tag/shaofu",
          "/manga-tag/ciji",
          "/manga-tag/ndaxuesheng",
          "/manga-tag/zhiliao",
          "/manga-tag/chaonengli",
          "/manga-tag/langmanxiaoyuan",
          "/manga-tag/xiju",
          "/manga-tag/xuejie",
          "/manga-tag/daxuesheng",
          "/manga-tag/yongyi",
          "/manga-tag/aimei",
          "/manga-tag/xiezhen",
          "/manga-tag/nshen",
          "/manga-tag/dachidu",
          "/manga-tag/chunqingjingcha"
        ],
      }
    ],
    // enable ranking page
    enableRankingPage: false,
  }

  /// category comic loading related
  categoryComics = {
    load: async (category, params, options, page) => {
      const res = await this.request(`${this.baseUrl}${params}/page/${page}`);
      const document = new HtmlDocument(res.body);
      let maxPage = null;
      try {
        maxPage = parseInt(document.querySelectorAll("button.text-small").pop().text.replaceAll("\n", "").replaceAll(" ", ""));
      } catch (_) {
        maxPage = 1;
      }
      return {
        comics: this.parseComics(document),
        maxPage: maxPage
      };
    }
  }

  /// search related
  search = {
    load: async (keyword, options, page) => {
      const res = await this.request(`${this.baseUrl}/s/${encodeURIComponent(keyword)}?page=${page}`);
      const document = new HtmlDocument(res.body);
      let maxPage = null;
      try {
        maxPage = parseInt(document.querySelectorAll("button.text-small").pop().text.replaceAll("\n", "").replaceAll(" ", ""));
      } catch (_) {
        maxPage = 1;
      }
      return {
        comics: this.parseComics(document),
        maxPage: maxPage
      };
    },
    // enable tags suggestions
    enableTagsSuggestions: false,
  }

  /// single comic related
  comic = {
    onImageLoad: (url) => {
      return { headers: this.headers };
    },
    onThumbnailLoad: (url) => {
      return {
        headers: this.headers
      }
    },
    loadInfo: async (id) => {
      if (!id.startsWith("http")) {
        id = this.baseUrl + id;
      }
      const res = await this.request(id);
      const document = new HtmlDocument(res.body);
      const title = document.querySelector(".text-xl").text.trim().split("   ")[0]
      const cover = document.querySelector(".object-cover").attributes["src"];
      const description = document.querySelector("p.text-medium").text;
      const infos = document.querySelectorAll("div.py-1");
      const tags = { "作者": [], "类型": [], "标签": [] };
      for (let author of infos[0].querySelectorAll("a > span")) {
        let author_name = author.text.trim();
        if (author_name.endsWith(",")) {
          author_name = author_name.slice(0, -1).trim();
        }
        tags["作者"].push(author_name);
      }
      for (let category of infos[1].querySelectorAll("a > span")) {
        let category_name = category.text.trim();
        if (category_name.endsWith(",")) {
          category_name = category_name.slice(0, -1).trim();
        }
        tags["类型"].push(category_name);
      }
      for (let tag of infos[2].querySelectorAll("a")) {
        tags["标签"].push(tag.text.replace("\n", "").replaceAll(" ", "").replace("#", ""));
      }
      const mangaId = document.querySelector("#mangachapters").attributes["data-mid"];
      const chapterRes = await this.request(`${this.baseUrl}/manga/get?mid=${mangaId}&mode=all&t=${Date.now()}`);
      const chapterDoc = new HtmlDocument(chapterRes.body);
      const chapters = {};
      for (let ch of chapterDoc.querySelectorAll(".chapteritem")) {
        const info = ch.querySelector("a");
        chapters[`${info.attributes["data-ms"]}@${info.attributes["data-cs"]}`] = ch.querySelector(".chaptertitle").text;
      }
      const recommend = [];
      for (let item of document.querySelectorAll("div.cardlist > div.pb-2")) {
        recommend.push(new Comic({
          id: item.querySelector("a").attributes["href"],
          title: item.querySelector("h3").text,
          cover: item.querySelector("img").attributes["src"]
        }));
      }
      return new ComicDetails({
        title: title,
        cover: cover,
        description: description,
        tags: tags,
        chapters: chapters,
        recommend: recommend,
      });
    },

    loadEp: async (comicId, epId) => {
      const ids = epId.split("@");
      const res = await this.request(`${this.baseUrl}/chapter/getcontent?m=${ids[0]}&c=${ids[1]}`);
      const document = new HtmlDocument(res.body);
      const images = [];
      for (let i of document.querySelector("#chapcontent").querySelectorAll("img")) {
        images.push(i.attributes["data-src"] ? i.attributes["data-src"] : i.attributes["src"]);
      }
      return { images };
    },

    // enable tags translate
    enableTagsTranslate: false,
  }
}