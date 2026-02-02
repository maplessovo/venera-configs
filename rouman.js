// 1. 模拟定义依赖的工具类/对象（补充缺失的基础实现）
const Convert = {
  md5: (str) => str, // 模拟md5加密
  encodeUtf8: (str) => str, // 模拟UTF8编码
  hexEncode: (str) => str, // 模拟十六进制编码
  decodeBase64: (str) => str, // 模拟Base64解码
  decryptAesEcb: (data, key) => data, // 模拟AES-ECB解密
  decodeUtf8: (str) => str, // 模拟UTF8解码
};

const UI = {
  showDialog: (title, message, buttons) => console.log(`[弹窗] ${title}: ${message}`),
  showMessage: (msg) => console.log(`[提示] ${msg}`),
};

const Network = {
  get: async (url, headers) => ({ status: 200, body: JSON.stringify({ data: "{}" }) }),
  post: async (url, headers, body) => ({ status: 200, body: JSON.stringify({ data: "{}" }) }),
  deleteCookies: (url) => {},
};

// 2. 定义Comic、ComicDetails数据类（模拟）
class Comic {
  constructor({ id, title, subTitle = "", cover = "", tags = [], description = "" }) {
    this.id = id;
    this.title = title;
    this.subTitle = subTitle;
    this.cover = cover;
    this.tags = tags;
    this.description = description;
  }
}

class ComicDetails {
  constructor({
    title,
    cover,
    description,
    likesCount = 0,
    chapters = new Map(),
    tags = {},
    related = [],
    isFavorite = false,
    updateTime = "",
  }) {
    this.title = title;
    this.cover = cover;
    this.description = description;
    this.likesCount = likesCount;
    this.chapters = chapters;
    this.tags = tags;
    this.related = related;
    this.isFavorite = isFavorite;
    this.updateTime = updateTime;
  }
}

// 3. 定义ComicSource基类（补充继承的基础实现）
class ComicSource {
  constructor() {
    this.isLogged = false; // 模拟登录状态
    this.settings = {}; // 模拟设置项
  }

  // 模拟加载设置的方法
  loadSetting(key) {
    const defaultSettings = {
      apiDomain: "1",
      imageStream: "1",
      refreshDomainsOnStart: true,
      favoriteOrder: "add_time",
    };
    return defaultSettings[key] || "";
  }

  // 模拟多语言翻译方法
  translate(key) {
    return this.translation?.zh_CN?.[key] || key;
  }
}

// 4. 原有Rouman5类（业务逻辑不变）
class Rouman5 extends ComicSource {
  // 源名称
  name = "罗马漫画";
  // 唯一标识
  key = "rouman5";
  // 版本
  version = "1.0.0";
  // 最低应用版本要求
  minAppVersion = "1.5.0";
  // 应用版本标识
  static appVersion = "2.1.0";
  // 包名
  static pkgName = "com.rouman5.app";
  // 更新地址
  url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/rouman5.js";

  // 备用API域名（rouman5.com相关）
  static fallbackServers = [
    "www.rouman5.com",
    "api.rouman5.com",
    "cdn.rouman5.com",
    "backup.rouman5.com",
  ];

  // 图片基础地址
  static imageUrl = "https://img.rouman5.com";
  // 请求UA
  static ua = "Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36";

  // 静态API域名（补充默认值，避免下标越界）
  static apiDomains = this.fallbackServers;

  // 获取UA
  get ua() {
    return Rouman5.ua;
  }

  // 获取基础API地址（从设置中选择域名）
  get baseUrl() {
    let index = parseInt(this.loadSetting("apiDomain")) - 1;
    // 边界处理：避免index越界
    index = index < 0 || index >= Rouman5.apiDomains.length ? 0 : index;
    return `https://${Rouman5.apiDomains[index]}`;
  }

  // 获取图片基础地址
  get imageUrl() {
    return Rouman5.imageUrl;
  }

  // 覆盖API域名
  overwriteApiDomains(domains) {
    if (domains.length !== 0) Rouman5.apiDomains = domains;
  }

  // 覆盖图片地址
  overwriteImgUrl(url) {
    if (url.length !== 0) Rouman5.imageUrl = url;
  }

  // 验证数字
  isNum(str) {
    return /^\d+$/.test(str);
  }

  // 基础请求头
  get baseHeaders() {
    return {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      Connection: "keep-alive",
      Origin: "https://rouman5.com",
      Referer: "https://rouman5.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "X-Requested-With": Rouman5.pkgName,
    };
  }

  // API请求头（带认证）
  getApiHeaders(time) {
    const authKey = "rouman5APPContent2025";
    let token = Convert.md5(Convert.encodeUtf8(`${time}${authKey}`));
    return {
      ...this.baseHeaders,
      Authorization: "Bearer",
      "Sec-Fetch-Storage-Access": "active",
      token: Convert.hexEncode(token),
      tokenparam: `${time},${Rouman5.appVersion}`,
      "User-Agent": this.ua,
    };
  }

  // 图片请求头
  getImgHeaders() {
    return {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      Connection: "keep-alive",
      Referer: "https://rouman5.com/",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "same-site",
      "Sec-Fetch-Storage-Access": "active",
      "User-Agent": this.ua,
      "X-Requested-With": Rouman5.pkgName,
    };
  }

  // 封面图地址
  getCoverUrl(id) {
    return `${this.imageUrl}/covers/${id}_cover.jpg`;
  }

  // 漫画图片地址
  getImageUrl(comicId, chapterId, imageName) {
    return `${this.imageUrl}/comics/${comicId}/${chapterId}/${imageName}`;
  }

  // 头像地址
  getAvatarUrl(imageName) {
    return `${this.imageUrl}/users/${imageName}`;
  }

  // 初始化
  async init() {
    if (this.loadSetting("refreshDomainsOnStart")) await this.refreshApiDomains(false);
    this.refreshImgUrl(false);
  }

  // 刷新API域名
  async refreshApiDomains(showConfirmDialog) {
    let url = "https://cdn.rouman5.com/config/domains.txt";
    let domainSecret = "rouman5DomainSecret2025";
    let title = "";
    let message = "";
    let servers = [];
    let domains = [];
    let res = null;
    try {
      res = await fetch(url, { headers: this.baseHeaders });
    } catch (error) {
      res = null;
    }
    if (res && res.status === 200) {
      let data = this.convertData(await res.text(), domainSecret);
      let json = JSON.parse(data);
      if (json["servers"]) {
        title = "更新成功";
        message = "\n";
        servers = json["servers"].slice(0, 4);
      }
    }
    if (servers.length === 0) {
      title = "更新失败";
      message = `使用内置域名:\n\n`;
      servers = Rouman5.fallbackServers;
    }
    for (let i = 0; i < servers.length; i++) {
      message = message + `线路${i + 1}:  ${servers[i]}\n\n`;
      domains.push(servers[i]);
    }
    if (showConfirmDialog) {
      UI.showDialog(title, message, [
        {
          text: "取消",
          callback: () => {},
        },
        {
          text: "应用",
          callback: () => {
            this.overwriteApiDomains(domains);
            this.refreshImgUrl(true);
          },
        },
      ]);
    } else {
      this.overwriteApiDomains(domains);
    }
  }

  // 刷新图片地址
  async refreshImgUrl(showMessage) {
    let index = this.loadSetting("imageStream");
    let res = await this.get(`${this.baseUrl}/api/setting?img_shunt=${index}`);
    let setting = JSON.parse(res);
    if (setting["img_host"]) {
      if (showMessage) {
        UI.showMessage(`图片线路 ${index}:${setting["img_host"]}`);
      }
      this.overwriteImgUrl(setting["img_host"]);
    }
  }

  // 解析漫画信息
  parseComic(comic) {
    let id = comic.id.toString();
    let author = comic.author || "未知作者";
    let title = comic.title;
    let description = comic.desc ?? "";
    let cover = this.getCoverUrl(id);
    let tags = [];
    if (comic["category"]) {
      tags.push(comic["category"]);
    }
    if (comic["tags"] && comic["tags"].length > 0) {
      tags.push(...comic["tags"]);
    }
    return new Comic({
      id: id,
      title: title,
      subTitle: author,
      cover: cover,
      tags: tags,
      description: description,
    });
  }

  // 数据解密转换
  convertData(input, secret) {
    let key = Convert.encodeUtf8(Convert.hexEncode(Convert.md5(Convert.encodeUtf8(secret))));
    let data = Convert.decodeBase64(input);
    let decrypted = Convert.decryptAesEcb(data, key);
    let res = Convert.decodeUtf8(decrypted);
    let start = 0;
    while (start < res.length && res[start] !== "{" && res[start] !== "[") {
      start++;
    }
    let end = res.length - 1;
    while (end > start && res[end] !== "}" && res[end] !== "]") {
      end--;
    }
    return res.substring(start, end + 1);
  }

  // GET请求
  async get(url) {
    let time = Math.floor(Date.now() / 1000);
    let secret = "rouman5APISecret2025";
    let res = await Network.get(url, this.getApiHeaders(time));
    if (res.status !== 200) {
      if (res.status === 401) {
        let json = JSON.parse(res.body);
        let message = json.errorMsg;
        if (message === "请先登录" && this.isLogged) {
          throw "登录过期";
        }
        throw message ?? "状态码异常: " + res.status;
      }
      throw "状态码异常: " + res.status;
    }
    let json = JSON.parse(res.body);
    let data = json.data;
    if (typeof data !== "string") {
      throw "数据格式异常";
    }
    return this.convertData(data, `${time}${secret}`);
  }

  // POST请求
  async post(url, body) {
    let time = Math.floor(Date.now() / 1000);
    let secret = "rouman5APISecret2025";
    let res = await Network.post(url, {
      ...this.getApiHeaders(time),
      "Content-Type": "application/x-www-form-urlencoded",
    }, body);
    if (res.status !== 200) {
      if (res.status === 401) {
        let json = JSON.parse(res.body);
        let message = json.errorMsg;
        if (message === "请先登录" && this.isLogged) {
          throw "登录过期";
        }
        throw message ?? "状态码异常: " + res.status;
      }
      throw "状态码异常: " + res.status;
    }
    let json = JSON.parse(res.body);
    let data = json.data;
    if (typeof data !== "string") {
      throw "数据格式异常";
    }
    return this.convertData(data, `${time}${secret}`);
  }

  // 账号相关
  account = {
    // 登录
    login: async (account, pwd) => {
      let time = Math.floor(Date.now() / 1000);
      await this.post(
        `${this.baseUrl}/api/login`,
        `username=${encodeURIComponent(account)}&password=${encodeURIComponent(pwd)}`
      );
      return "登录成功";
    },
    // 退出登录
    logout: () => {
      for (let url of Rouman5.apiDomains) {
        Network.deleteCookies(url);
      }
    },
    // 注册地址（无则为null）
    registerWebsite: "https://rouman5.com/register",
  };

  // 探索页配置
  explore = [
    {
      title: "罗马漫画",
      type: "multiPartPage",
      load: async (page) => {
        let res = await this.get(`${this.baseUrl}/api/home?page=${page || 0}`);
        let result = [];
        for (let e of JSON.parse(res)) {
          let sectionTitle = e["title"];
          let comics = e["list"].map((item) => this.parseComic(item));
          result.push({
            title: sectionTitle,
            comics: comics,
            viewMore: `category:${sectionTitle}@${e["id"]}`,
          });
        }
        return result;
      },
    },
  ];

  // 分类页配置
  category = {
    title: "罗马漫画分类",
    parts: [
      {
        name: "热门分类",
        type: "fixed",
        categories: ["最新上线", "热门推荐", "完结佳作", "独家首发"],
        itemType: "category",
        categoryParams: ["new", "hot", "end", "exclusive"],
      },
      {
        name: "漫画类型",
        type: "fixed",
        categories: ["恋爱", "悬疑", "热血", "校园", "科幻", "古风", "搞笑", "治愈"],
        itemType: "search",
      },
      {
        name: "地区分类",
        type: "fixed",
        categories: ["国产", "日本", "韩国", "欧美", "其他"],
        itemType: "search",
      },
    ],
    enableRankingPage: true,
  };

  // 分类漫画加载
  categoryComics = {
    load: async (category, param, options, page) => {
      param ??= category;
      param = encodeURIComponent(param);
      let sort = options[0] || "new";
      let res = await this.get(`${this.baseUrl}/api/category?type=${param}&sort=${sort}&page=${page}`);
      let data = JSON.parse(res);
      let total = data.total;
      let maxPage = Math.ceil(total / 30);
      let comics = data.list.map((e) => this.parseComic(e));
      return {
        comics: comics,
        maxPage: maxPage,
      };
    },
    optionLoader: async (category, param) => {
      return [
        {
          label: "排序方式",
          options: ["new-最新上线", "hot-热门优先", "score-评分排序", "update-更新优先"],
        },
      ];
    },
    ranking: {
      options: ["hot-热门排行", "score-评分排行", "new-新作排行"],
      load: async (option, page) => {
        let sort = option.split("-")[0];
        return this.categoryComics.load("排行榜", "ranking", [sort], page);
      },
    },
  };

  // 搜索配置
  search = {
    load: async (keyword, options, page) => {
      keyword = keyword.trim();
      keyword = encodeURIComponent(keyword);
      keyword = keyword.replace(/%20/g, "+");
      let sort = options[0] || "new";
      let url = `${this.baseUrl}/api/search?keyword=${keyword}&sort=${sort}&page=${page || 1}`;
      let res = await this.get(url);
      let data = JSON.parse(res);
      let total = data.total;
      let maxPage = Math.ceil(total / 30);
      let comics = data.list.map((e) => this.parseComic(e));
      return {
        comics: comics,
        maxPage: maxPage,
      };
    },
    optionList: [
      {
        type: "select",
        options: ["new-最新上线", "hot-热门优先", "score-评分排序", "update-更新优先"],
        label: "排序方式",
      },
    ],
  };

  // 收藏相关
  favorites = {
    multiFolder: true,
    addOrDelFavorite: async (comicId, folderId, isAdding, favoriteId) => {
      if (isAdding) {
        await this.post(`${this.baseUrl}/api/favorite/add`, `comic_id=${comicId}`);
        if (folderId !== "0") {
          await this.post(`${this.baseUrl}/api/favorite/move`, `comic_id=${comicId}&folder_id=${folderId}`);
        }
      } else {
        await this.post(`${this.baseUrl}/api/favorite/remove`, `comic_id=${comicId}`);
      }
    },
    loadFolders: async (comicId) => {
      let res = await this.get(`${this.baseUrl}/api/favorite/folders`);
      let folders = {
        "0": this.translate("全部"),
      };
      let json = JSON.parse(res);
      for (let e of json.folders) {
        folders[e.id.toString()] = e.name;
      }
      return {
        folders: folders,
        favorited: comicId ? json.favorited || [] : [],
      };
    },
    addFolder: async (name) => {
      await this.post(`${this.baseUrl}/api/favorite/create_folder`, `name=${encodeURIComponent(name)}`);
    },
    deleteFolder: async (folderId) => {
      await this.post(`${this.baseUrl}/api/favorite/delete_folder`, `folder_id=${folderId}`);
    },
    loadComics: async (page, folder) => {
      let order = this.loadSetting("favoriteOrder") || "add_time";
      let res = await this.get(`${this.baseUrl}/api/favorite/list?folder_id=${folder}&page=${page}&order=${order}`);
      let json = JSON.parse(res);
      let total = json.total;
      let maxPage = Math.ceil(total / 20);
      let comics = json.list.map((e) => this.parseComic(e));
      return {
        comics: comics,
        maxPage: maxPage,
      };
    },
    singleFolderForSingleComic: true,
  };

  // 漫画详情与章节加载
  comic = {
    loadInfo: async (id) => {
      if (id.startsWith("rouman5")) {
        id = id.substring(7);
      }
      let res = await this.get(`${this.baseUrl}/api/comic/detail?id=${id}`);
      let data = JSON.parse(res);
      let author = data.author || [];
      let chapters = new Map();
      let series = (data.chapters ?? []).sort((a, b) => a.sort - b.sort);
      for (let e of series) {
        let chapterTitle = e.title || `第${e.sort}话`;
        let chapterId = e.id.toString();
        chapters.set(chapterId, chapterTitle);
      }
      if (chapters.size === 0) {
        chapters.set(id, "第1话");
      }
      let tags = data.tags ?? [];
      let related = (data["related"] ?? []).map((e) => new Comic({
        id: e.id.toString(),
        title: e.title,
        subtitle: e.author || "",
        cover: this.getCoverUrl(e.id),
        description: e.desc ?? "",
      }));
      let updateTimeStamp = data["update_time"];
      let date = updateTimeStamp ? new Date(updateTimeStamp * 1000) : new Date();
      let updateDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;

      return new ComicDetails({
        title: data.title,
        cover: this.getCoverUrl(id),
        description: data.desc || "暂无简介",
        likesCount: Number(data.likes) || 0,
        chapters: chapters,
        tags: {
          作者: author,
          标签: tags,
          地区: [data.region || "未知"],
          状态: [data.status === 1 ? "连载中" : "已完结"],
        },
        related: related,
        isFavorite: data.is_favorite ?? false,
        updateTime: updateDate,
      });
    },
    loadEp: async (comicId, epId) => {
      let res = await this.get(`${this.baseUrl}/api/chapter/images?id=${epId}`);
      let data = JSON.parse(res);
      let images = (data.images ?? []).map((e) => this.getImageUrl(comicId, epId, e));
      return {
        images: images,
      };
    },
    onImageLoad: (url, comicId, epId) => {
      const scrambleThreshold = 10000;
      let num = 0;
      epId = Number(epId);
      if (epId > scrambleThreshold) {
        let str = epId.toString() + url.split("/").pop().split(".")[0];
        let bytes = Convert.encodeUtf8(str);
        let hash = Convert.md5(bytes);
        let hashStr = Convert.hexEncode(hash);
        let remainder = hashStr.charCodeAt(hashStr.length - 1) % 6;
        num = remainder * 2 + 2;
      }
      if (num <= 1) {
        return {};
      }
      return {
        headers: this.getImgHeaders(),
        modifyImage: url.endsWith(".gif")
          ? null
          : `
                    let modifyImage = (image) => {
                        const num = ${num}
                        let blockSize = Math.floor(image.height / num)
                        let remainder = image.height % num
                        let blocks = []
                        for(let i = 0; i < num; i++) {
                            let start = i * blockSize
                            let end = start + blockSize + (i !== num - 1 ? 0 : remainder)
                            blocks.push({ start: start, end: end })
                        }
                        let res = Image.empty(image.width, image.height)
                        let y = 0
                        for(let i = blocks.length - 1; i >= 0; i--) {
                            let block = blocks[i]
                            let currentHeight = block.end - block.start
                            res.fillImageRangeAt(0, y, image, 0, block.start, image.width, currentHeight)
                            y += currentHeight
                        }
                        return res
                    }
                `,
      };
    },
    onThumbnailLoad: (url) => {
      return {
        headers: this.getImgHeaders(),
      };
    },
    idMatch: "^(\\d+|rouman5\\d+)$",
    onClickTag: (namespace, tag) => {
      return {
        action: "search",
        keyword: tag,
      };
    },
  };

  // 设置项
  settings = {
    refreshDomains: {
      title: "刷新域名列表",
      type: "callback",
      buttonText: "刷新",
      callback: () => this.refreshApiDomains(true),
    },
    refreshDomainsOnStart: {
      title: "启动时刷新域名",
      type: "switch",
      default: true,
    },
    apiDomain: {
      title: "API域名线路",
      type: "select",
      options: [
        { value: "1", text: "线路1" },
        { value: "2", text: "线路2" },
        { value: "3", text: "线路3" },
        { value: "4", text: "线路4" },
      ],
      default: "1",
    },
    imageStream: {
      title: "图片线路",
      type: "select",
      options: [
        { value: "1", text: "图片线路1" },
        { value: "2", text: "图片线路2" },
        { value: "3", text: "图片线路3" },
        { value: "4", text: "图片线路4" },
      ],
      default: "1",
    },
    favoriteOrder: {
      title: "收藏排序",
      type: "select",
      options: [
        { value: "add_time", text: "添加时间" },
        { value: "update_time", text: "更新时间" },
      ],
      default: "add_time",
    },
  };

  // 多语言翻译
  translation = {
    zh_CN: {
      "刷新域名列表": "刷新域名列表",
      刷新: "刷新",
      "启动时刷新域名": "启动时刷新域名",
      "API域名线路": "API域名线路",
      "图片线路": "图片线路",
      "收藏排序": "收藏排序",
      "添加时间": "添加时间",
      "更新时间": "更新时间",
      全部: "全部",
      线路1: "线路1",
      线路2: "线路2",
      线路3: "线路3",
      线路4: "线路4",
      "图片线路1": "图片线路1",
      "图片线路2": "图片线路2",
      "图片线路3": "图片线路3",
      "图片线路4": "图片线路4",
    },
    zh_TW: {
      "刷新域名列表": "刷新域名列表",
      刷新: "刷新",
      "启动时刷新域名": "啟動時刷新域名",
      "API域名线路": "API域名線路",
      "图片线路": "圖片線路",
      "收藏排序": "收藏排序",
      "添加时间": "添加時間",
      "更新时间": "更新時間",
      全部: "全部",
      线路1: "線路1",
      线路2: "線路2",
      线路3: "線路3",
      线路4: "線路4",
      "图片线路1": "圖片線路1",
      "图片线路2": "圖片線路2",
      "图片线路3": "圖片線路3",
      "图片线路4": "圖片線路4",
    },
  };
}

// 测试代码（可选，验证代码可运行）
(async () => {
  const rouman5 = new Rouman5();
  await rouman5.init();
  console.log("Rouman5类初始化完成，无语法/引用错误");
})();
