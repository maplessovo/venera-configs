/** @type {import('./_venera_.js')} */
class ManWaBa extends ComicSource {
  name = "漫蛙吧";
  key = "manwaba";
  version = "1.0.6";
  minAppVersion = "1.4.0";
  url = "https://cdn.jsdelivr.net/gh/maplessovo/venera-configs@main/manwaba.js";

  get baseUrl() {
    const domain = String(this.loadSetting("domain") || "manwaxu.cc")
      .trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `https://${domain}`;
  }

  get api() { return `${this.baseUrl}/api`; }

  get imageSource() {
    return String(this.loadSetting("imageSource") || "https://mwtuwu.cc").replace(/\/+$/, "");
  }

  get headers() {
    return {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Referer": `${this.baseUrl}/`,
      "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    };
  }

  async fetchJson(url, {method = "GET", params, headers, payload} = {}) {
    if (params) {
      const query = Object.keys(params)
        .filter(key => params[key] !== undefined && params[key] !== null)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
        .join("&");
      if (query) url += (url.includes("?") ? "&" : "?") + query;
    }
    const res = await Network.sendRequest(method, url, {...this.headers, ...headers}, payload);
    if (res.status !== 200) throw `漫蛙吧请求失败：HTTP ${res.status}，请检查网络或源设置中的站点域名`;
    let json;
    try { json = JSON.parse(res.body); }
    catch (_) { throw "漫蛙吧未返回有效数据，请检查站点域名或网站是否要求验证"; }
    if (!json || (json.code !== undefined && Number(json.code) !== 200)) {
      throw `漫蛙吧：${json && (json.msg || json.message) || "接口返回错误"}`;
    }
    // Original Venera cannot await thumbnail configs or their response callbacks.
    // Prepare the decoder before returning comics for the UI to render.
    await this._getImageKey();
    return json;
  }

  _tags(value) {
    return (Array.isArray(value) ? value : String(value || "").split(","))
      .map(tag => String(tag).trim()).filter(Boolean);
  }

  _comic(item) {
    if (!item) return null;
    const id = item.id ?? String(item.url || "").match(/\/comic\/(\d+)/)?.[1];
    if (id === undefined || id === null || id === "") return null;
    return new Comic({
      id: String(id), title: String(item.title || ""), subTitle: String(item.author || ""),
      cover: item.pic || item.cover || "", tags: this._tags(item.tags),
      description: item.intro || item.description || "",
    });
  }

  _comics(items) { return (Array.isArray(items) ? items : []).map(item => this._comic(item)).filter(Boolean); }

  async _getImageKey() {
    if (this._imageKeyDomain !== this.baseUrl) {
      this._imageKeyDomain = this.baseUrl;
      this._imageKeyPromise = null;
      this._imageKey = null;
    }
    if (!this._imageKeyPromise) {
      // Read the public image decoder's key as data; never execute the site's script.
      this._imageKeyPromise = (async () => {
        const res = await Network.get(`${this.baseUrl}/static/assets/js/base.js`, {
          ...this.headers, "Accept": "text/javascript,*/*;q=0.8",
        });
        const match = String(res.body || "").match(/AES_KEY\s*:\s*['"]([^'"]+)['"]/);
        if (res.status !== 200 || !match || match[1].length < 32) {
          throw "漫蛙吧：无法读取网站图片解码配置，请重试或检查站点域名";
        }
        const key = match[1].slice(0, 32);
        this.saveData("publicImageDecoder", {domain: this.baseUrl, key});
        this._imageKey = Convert.encodeUtf8(key);
        return this._imageKey;
      })().catch(error => { this._imageKeyPromise = null; throw error; });
    }
    return this._imageKeyPromise;
  }

  init() {
    // Warm up old history covers as well; saved public configuration is available
    // immediately while the current website configuration refreshes.
    this._getImageKey().catch(error => log("warning", this.name, String(error)));
  }

  _thumbnailImageKey() {
    if (this._imageKey && this._imageKeyDomain === this.baseUrl) return this._imageKey;
    const saved = this.loadData("publicImageDecoder");
    if (saved && saved.domain === this.baseUrl && typeof saved.key === "string" && saved.key.length === 32) {
      return Convert.encodeUtf8(saved.key);
    }
    throw "漫蛙吧：请先打开漫画源首页以准备封面解码配置，再重试封面";
  }

  _isImage(bytes) {
    return (bytes[0] === 0xff && bytes[1] === 0xd8) ||
      (bytes[0] === 0x89 && bytes[1] === 0x50) ||
      (bytes[0] === 0x47 && bytes[1] === 0x49) ||
      (bytes[0] === 0x52 && bytes[1] === 0x49);
  }

  _decodeImage(data, key) {
    const bytes = new Uint8Array(data);
    // Existing unencrypted images must pass through unchanged.
    if (this._isImage(bytes)) return data;
    if (bytes.length < 32 || (bytes.length - 16) % 16 !== 0) {
      throw "漫蛙吧：图片数据无效，请重试或切换章节图片线路";
    }
    const decrypted = Convert.decryptAesCbc(data.slice(16), key, data.slice(0, 16));
    const plain = new Uint8Array(decrypted);
    // Venera's AES bridge returns raw blocks; WebCrypto removes PKCS#7 padding.
    const padding = plain[plain.length - 1];
    if (!padding || padding > 16 || !this._isImage(plain)) throw "漫蛙吧：图片解码失败，请重新加载漫画源";
    for (let i = plain.length - padding; i < plain.length; i++) {
      if (plain[i] !== padding) throw "漫蛙吧：图片解码失败，请重新加载漫画源";
    }
    return decrypted.slice(0, plain.length - padding);
  }

  _imageConfig(url, referer) {
    return {
      url,
      headers: {...this.headers, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8", "Referer": referer},
      onResponse: data => this._isImage(new Uint8Array(data)) ? data
        : this._decodeImage(data, this._thumbnailImageKey()),
    };
  }

  explore = [{
    title: this.name,
    type: "multiPartPage",
    load: async () => {
      const res = await this.fetchJson(`${this.api}/home`, {
        params: {page: 1, pageSize: 6, type: "", flag: false},
      });
      const data = res.data || {};
      return [
        ["热门", "comicList", "全部", "", "3"], ["最新完整版", "gufengList", "完整版", "完整版", "1"],
        ["最新更新", "xuanhuanList", "全部", "", "0"], ["热门收藏", "xiaoyuanList", "全部", "", "4"],
      ].map(([title, key, category, param, sort]) => ({title, comics: this._comics(data[key]),
        viewMore: {page: "category", attributes: {category, param, options: ["2", "0", sort]}},
      }));
    },
  }];

  category = {
    title: this.name,
    parts: [{
      name: "类型", type: "fixed", itemType: "category",
      categories: ["全部", "热血", "玄幻", "恋爱", "冒险", "古风", "都市", "穿越", "奇幻", "其他", "搞笑", "少男", "战斗", "重生", "逆袭", "爆笑", "少年", "后宫", "系统", "BL", "韩漫", "完整版", "19r", "台版"],
      categoryParams: ["", "热血", "玄幻", "恋爱", "冒险", "古风", "都市", "穿越", "奇幻", "其他", "搞笑", "少男", "战斗", "重生", "逆袭", "爆笑", "少年", "后宫", "系统", "BL", "韩漫", "完整版", "19r", "台版"],
    }],
    enableRankingPage: false,
  };

  categoryComics = {
    load: async (category, param, options, page) => {
      const tag = param ?? (category === "全部" ? "" : category);
      const paths = {
        "热血": "/cate/hotblooded", "玄幻": "/cate/xuanhuan", "恋爱": "/cate/romance",
        "冒险": "/cate/adventure", "古风": "/cate/historical", "都市": "/cate/urban",
        "穿越": "/cate/transmigration", "奇幻": "/cate/fantasy", "搞笑": "/cate/comedy",
        "少男": "/cate/shounen", "战斗": "/cate/action", "重生": "/cate/rebirth",
        "逆袭": "/cate/counterattack", "爆笑": "/cate/hilarious", "少年": "/cate/youth",
        "后宫": "/cate/harem", "其他": "/cate/other",
        "系统": "/cate/system", "BL": "/cate/bl", "韩漫": "/cate/manhwa",
        "完整版": "/cate/fullversion", "19r": "/cate/19plus", "台版": "/cate/taiwanver",
      };
      const filters = options || [];
      const status = filters[0] === undefined || filters[0] === "2" ? -1 : Number(filters[0]);
      const pageSize = 20;
      const path = paths[tag] || (tag ? `/cate/${encodeURIComponent(tag)}` : "/cate");
      const res = await this.fetchJson(this.api + path, {
        method: "POST",
        payload: JSON.stringify({
          page: {page: page || 1, pageSize}, category: "comic", sort: Number(filters[2] || 0),
          comic: {status, day: Number(filters[1] || 0), tag: tag || ""},
          video: {year: 0, typeId: 0, typeId1: 0, area: "", lang: "", status: -1, day: 0},
          novel: {status: -1, day: 0, sortId: 0},
        }),
      });
      const data = res.data || {};
      return {comics: this._comics(data.list), maxPage: Math.max(1, Math.ceil(Number(data.total || 0) / pageSize))};
    },
    optionList: [
      {options: ["2-全部", "0-连载中", "1-已完结"]},
      {options: ["0-全部", "1-周一", "2-周二", "3-周三", "4-周四", "5-周五", "6-周六", "7-周日"]},
      {options: ["0-更新", "1-新作", "2-畅销", "3-热门", "4-收藏"]},
    ],
  };

  search = {
    load: async (keyword, options, page) => {
      const pageSize = 20;
      const res = await this.fetchJson(`${this.api}/search`, {
        params: {keyword, type: "mh", page: page || 1, pageSize},
      });
      const data = res.data || {};
      return {comics: this._comics(data.list), maxPage: Math.max(1, Math.ceil(Number(data.total || 0) / pageSize))};
    },
  };

  comic = {
    loadInfo: async id => {
      const res = await this.fetchJson(`${this.api}/comic/${encodeURIComponent(id)}`);
      const data = res.data;
      if (!data || data.id === undefined) throw "漫蛙吧：漫画不存在或暂时无法访问";
      const chapters = new Map();
      let total = null;
      for (let page = 1; page <= 1000; page++) {
        const result = await this.fetchJson(`${this.api}/comic/chapter`, {
          params: {comicId: data.id, page, pageSize: 200},
        });
        const list = Array.isArray(result.data) ? result.data : [];
        const pagination = result.pagination || {};
        if (pagination.total !== undefined) total = Number(pagination.total);
        const previous = chapters.size;
        for (const chapter of list) {
          if (chapter && chapter.id !== undefined) chapters.set(String(chapter.id), String(chapter.title || ""));
        }
        if (total !== null && chapters.size >= total) break;
        if (list.length === 0 || chapters.size === previous) {
          if (total !== null && chapters.size < total) throw "漫蛙吧：章节列表未加载完整，请重试";
          break;
        }
        if (total === null && list.length < Number(pagination.size || 200)) break;
        if (page === 1000) throw "漫蛙吧：章节列表过长，无法完整加载";
      }
      return new ComicDetails({
        title: String(data.title || ""), subTitle: String(data.author || ""), cover: data.cover || data.pic || "",
        tags: {"类型": this._tags(data.tags), "状态": [Number(data.status) === 0 ? "连载中" : "已完结"]},
        chapters, description: data.intro || "",
        updateTime: data.editTime ? new Date(Number(data.editTime) * 1000).toLocaleDateString() : "",
        url: `${this.baseUrl}/comic/${encodeURIComponent(id)}`,
      });
    },
    loadEp: async (comicId, epId) => {
      if (!epId) throw "漫蛙吧：缺少章节 ID";
      const images = [];
      const seen = new Set();
      let total = null;
      for (let page = 1; page <= 1000; page++) {
        const res = await this.fetchJson(`${this.api}/comic/image/${encodeURIComponent(epId)}`, {
          params: {page, page_size: 100, image_source: this.imageSource},
          headers: {"Referer": `${this.baseUrl}/comic/${encodeURIComponent(comicId)}/${encodeURIComponent(epId)}`},
        });
        const data = res.data || {};
        const pagination = data.pagination || {};
        if (pagination.total !== undefined) total = Number(pagination.total);
        const list = Array.isArray(data.images) ? data.images : [];
        const previous = images.length;
        for (const image of list) {
          const url = typeof image === "string" ? image : image && image.url;
          if (url && !seen.has(url)) { seen.add(url); images.push(url); }
        }
        if (total !== null && images.length >= total) break;
        if (!list.length || images.length === previous) {
          if (total !== null && images.length < total) throw "漫蛙吧：章节图片未加载完整，请重试";
          break;
        }
        if (total === null && list.length < Number(pagination.page_size || 100)) break;
        if (page === 1000) throw "漫蛙吧：章节图片过多，无法完整加载";
      }
      if (!images.length) throw "漫蛙吧：本章节暂无可用图片，可能需要在网站登录或开通章节权限";
      return {images};
    },
    onImageLoad: async (url, comicId, epId) => {
      await this._getImageKey();
      return this._imageConfig(url,
        `${this.baseUrl}/comic/${encodeURIComponent(comicId)}/${encodeURIComponent(epId)}`);
    },
    onThumbnailLoad: url => this._imageConfig(url, `${this.baseUrl}/`),
  };

  settings = {
    domain: {
      title: "站点域名", type: "input", default: "manwaxu.cc",
      validator: String.raw`^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?\/?$`,
    },
    imageSource: {
      title: "章节图片线路", type: "select", default: "https://mwtuwu.cc",
      options: [
        {value: "https://mwtuwu.cc", text: "稳定线路"},
        {value: "https://tu.mwzu.cc", text: "高速线路"},
        {value: "https://tu.mhttu.cc", text: "备用线路"},
      ],
    },
  };
}
