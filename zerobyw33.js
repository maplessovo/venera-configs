/** @type {import('./_venera_.js')} */

class ZeroByw33 extends ComicSource {
    name = "zero搬运网"
    key = "zerobyw33"
    version = "1.0.2"
    minAppVersion = "1.6.0"
    url = ""

    get baseUrl() {
        let domain = this.loadSetting("domain") || "www.zerobyw33.com"
        domain = String(domain).trim()
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/, "")
        return `https://${domain}`
    }

    get requestHeaders() {
        return {
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": `${this.baseUrl}/pc/pc/`,
        }
    }

    _absoluteUrl(url) {
        if (!url) return ""
        url = String(url).trim()
        if (url.startsWith("//")) return `https:${url}`
        if (url.startsWith("http://")) return `https://${url.substring(7)}`
        if (url.startsWith("https://")) return url
        if (!url.startsWith("/")) url = `/${url}`
        return `${this.baseUrl}${url}`
    }

    async _get(url) {
        const response = await Network.get(url, this.requestHeaders)
        if (response.status !== 200) {
            throw `zero搬运网请求失败：HTTP ${response.status}`
        }
        return response.body
    }

    _maxPage(document) {
        const jump = document.querySelector("input#jumpPage")
        if (jump) {
            const value = parseInt(jump.attributes["max"] || "1")
            if (Number.isFinite(value) && value > 0) return value
        }

        let maxPage = 1
        const links = document.querySelectorAll('a[href*="page="]')
        for (const link of links) {
            const match = (link.attributes["href"] || "").match(/[?&]page=(\d+)/)
            if (match) maxPage = Math.max(maxPage, parseInt(match[1]))
        }
        return maxPage
    }

    _parseComicCards(document) {
        const cards = document.querySelectorAll('div.pc-manga-grid > a[href*="/pc/details/"]')
        const comics = []

        for (const card of cards) {
            const href = card.attributes["href"] || ""
            const idMatch = href.match(/[?&]kuid=(\d+)/)
            const titleElement = card.querySelector("h3.manga-card-title")
            if (!idMatch || !titleElement) continue

            const image = card.querySelector("img")
            const metaElement = card.querySelector("p.manga-card-meta")
            const meta = metaElement ? metaElement.text.trim() : ""

            comics.push(new Comic({
                id: idMatch[1],
                title: titleElement.text.trim(),
                subTitle: meta,
                cover: image ? this._absoluteUrl(image.attributes["src"]) : "",
                tags: meta ? [meta] : [],
                description: meta,
            }))
        }

        return comics
    }

    async _loadComicList(url) {
        const html = await this._get(url)
        const document = new HtmlDocument(html)
        try {
            return {
                comics: this._parseComicCards(document),
                maxPage: this._maxPage(document),
            }
        } finally {
            document.dispose()
        }
    }

    _listUrl(params, page) {
        const query = []
        for (const param of params) {
            if (param) query.push(param)
        }
        query.push(`page=${Math.max(1, parseInt(page) || 1)}`)
        return `${this.baseUrl}/pc/pc/?${query.join("&")}`
    }

    _sortParams(options) {
        const value = options && options[0] ? String(options[0]) : "addtime.asc"
        const parts = value.split(".")
        const allowedOrders = ["addtime", "views", "favores"]
        const order = allowedOrders.includes(parts[0]) ? parts[0] : "addtime"
        const dir = parts[1] === "desc" ? "desc" : "asc"
        return [`order=${order}`, `dir=${dir}`]
    }

    _chapterData(html) {
        const match = html.match(/const\s+mangaDownloadChapters\s*=\s*(\[[\s\S]*?\])\s*;/)
        if (!match) return []
        try {
            const data = JSON.parse(match[1])
            return Array.isArray(data) ? data : []
        } catch (_) {
            return []
        }
    }

    _comicReadData(html) {
        const match = html.match(/window\.COMICREAD_BOOT\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/)
        if (!match) throw "未找到章节图片数据，站点页面结构可能已经更新"
        try {
            return JSON.parse(match[1])
        } catch (_) {
            throw "章节图片数据解析失败"
        }
    }

    account = {
        loginWithWebview: {
            url: "https://www.zerobyw33.com/member.php?mod=logging&action=login",
            checkStatus: (url, title) => {
                const current = String(url || "").toLowerCase()
                if (!current.includes("zerobyw33.com")) return false
                if (current.includes("mod=logging") || current.includes("action=login")) return false
                return !String(title || "").includes("登录")
            },
        },
        logout: () => {
            Network.deleteCookies(this.baseUrl)
        },
        registerWebsite: "https://www.zerobyw33.com/member.php?mod=register",
    }

    explore = [
        {
            title: "zero搬运网",
            type: "multiPartPage",
            load: async () => {
                const results = await Promise.all([
                    this._loadComicList(this._listUrl(["order=addtime", "dir=asc"], 1)),
                    this._loadComicList(this._listUrl(["order=views", "dir=desc"], 1)),
                    this._loadComicList(this._listUrl(["order=favores", "dir=desc"], 1)),
                ])

                return [
                    {
                        title: "最新上架",
                        comics: results[0].comics,
                        viewMore: {
                            page: "category",
                            attributes: {category: "最新上架", param: ""},
                        },
                    },
                    {
                        title: "人气",
                        comics: results[1].comics,
                        viewMore: {
                            page: "category",
                            attributes: {category: "人气", param: ""},
                        },
                    },
                    {
                        title: "收藏排行",
                        comics: results[2].comics,
                        viewMore: {
                            page: "category",
                            attributes: {category: "收藏排行", param: ""},
                        },
                    },
                ]
            },
        },
    ]

    category = {
        title: "分类",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: [
                    {label: "全部", target: {page: "category", attributes: {category: "全部", param: ""}}},
                    {label: "卖肉", target: {page: "category", attributes: {category: "卖肉", param: "category_id=1"}}},
                    {label: "后宫", target: {page: "category", attributes: {category: "后宫", param: "category_id=6"}}},
                    {label: "冒险", target: {page: "category", attributes: {category: "冒险", param: "category_id=22"}}},
                    {label: "奇幻", target: {page: "category", attributes: {category: "奇幻", param: "category_id=23"}}},
                    {label: "搞笑", target: {page: "category", attributes: {category: "搞笑", param: "category_id=13"}}},
                    {label: "日常", target: {page: "category", attributes: {category: "日常", param: "category_id=28"}}},
                    {label: "职业", target: {page: "category", attributes: {category: "职业", param: "category_id=35"}}},
                    {label: "体育", target: {page: "category", attributes: {category: "体育", param: "category_id=29"}}},
                    {label: "战斗", target: {page: "category", attributes: {category: "战斗", param: "category_id=15"}}},
                    {label: "爱情", target: {page: "category", attributes: {category: "爱情", param: "category_id=31"}}},
                    {label: "机战", target: {page: "category", attributes: {category: "机战", param: "category_id=34"}}},
                    {label: "悬疑", target: {page: "category", attributes: {category: "悬疑", param: "category_id=40"}}},
                    {label: "美食", target: {page: "category", attributes: {category: "美食", param: "category_id=41"}}},
                    {label: "百合", target: {page: "category", attributes: {category: "百合", param: "category_id=42"}}},
                    {label: "等网源", target: {page: "category", attributes: {category: "等网源", param: "category_id=43"}}},
                ],
            },
            {
                name: "进度",
                type: "fixed",
                categories: [
                    {label: "连载中", target: {page: "category", attributes: {category: "连载中", param: "jindu=0"}}},
                    {label: "已完结", target: {page: "category", attributes: {category: "已完结", param: "jindu=1"}}},
                ],
            },
            {
                name: "语言",
                type: "fixed",
                categories: [
                    {label: "全中文", target: {page: "category", attributes: {category: "全中文", param: "shuxing=%E5%85%A8%E4%B8%AD%E6%96%87"}}},
                    {label: "中日混合", target: {page: "category", attributes: {category: "中日混合", param: "shuxing=%E4%B8%80%E5%8D%8A%E4%B8%AD%E6%96%87%E4%B8%80%E5%8D%8A%E7%94%9F%E8%82%89"}}},
                    {label: "全生肉", target: {page: "category", attributes: {category: "全生肉", param: "shuxing=%E5%85%A8%E7%94%9F%E8%82%89"}}},
                ],
            },
        ],
        enableRankingPage: false,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            const params = []
            if (param) params.push(String(param))
            params.push(...this._sortParams(options))
            return this._loadComicList(this._listUrl(params, page))
        },
        optionLoader: async (category, param) => {
            let options
            if (category === "人气") {
                options = [
                    "views.desc-人气",
                    "addtime.asc-上架",
                    "favores.desc-收藏",
                ]
            } else if (category === "收藏排行") {
                options = [
                    "favores.desc-收藏",
                    "addtime.asc-上架",
                    "views.desc-人气",
                ]
            } else {
                options = [
                    "addtime.asc-上架",
                    "views.desc-人气",
                    "favores.desc-收藏",
                ]
            }
            return [{label: "排序", options: options}]
        },
    }

    search = {
        load: async (keyword, options, page) => {
            const params = [`keyword=${encodeURIComponent(String(keyword || "").trim())}`]
            params.push(...this._sortParams(options))
            return this._loadComicList(this._listUrl(params, page))
        },
        optionList: [
            {
                type: "select",
                label: "排序",
                options: [
                    "addtime.asc-上架",
                    "views.desc-人气",
                    "favores.desc-收藏",
                ],
                default: "addtime.asc",
            },
        ],
        enableTagsSuggestions: false,
    }

    comic = {
        loadInfo: async (id) => {
            const comicId = String(id).match(/\d+/)
            if (!comicId) throw "无效的漫画 ID"

            const html = await this._get(`${this.baseUrl}/pc/details/?kuid=${comicId[0]}`)
            const document = new HtmlDocument(html)

            try {
                const coverElement = document.querySelector("main.pc-manga-page img")
                const heading = document.querySelector("main.pc-manga-page h1")
                const summary = document.querySelector('p[x-ref="summaryText"]')
                if (!heading) throw "漫画详情解析失败，站点页面结构可能已经更新"

                let title = coverElement ? (coverElement.attributes["alt"] || "") : ""
                title = title.split("【")[0].trim()
                if (!title) title = heading.text.split("【")[0].trim()

                let author = ""
                const labels = []
                const stats = []
                const spans = document.querySelectorAll("main.pc-manga-page div.flex.flex-wrap.items-center.gap-2.text-sm > span")
                for (const span of spans) {
                    const text = span.text.trim()
                    if (text.startsWith("作者:")) author = text.substring(3).trim()
                    else if (text.startsWith("收藏:") || text.startsWith("人气:")) stats.push(text)
                    else if (text) labels.push(text)
                }

                const chapterItems = this._chapterData(html)
                const chapters = new Map()
                for (const chapter of chapterItems) {
                    if (chapter && chapter.zjid != null) {
                        chapters.set(String(chapter.zjid), String(chapter.zjname || chapter.zjid))
                    }
                }

                if (chapters.size === 0) {
                    const chapterLinks = document.querySelectorAll('a[href*="zjid="]')
                    for (const link of chapterLinks) {
                        const match = (link.attributes["href"] || "").match(/[?&]zjid=(\d+)/)
                        if (match) chapters.set(match[1], link.text.trim() || match[1])
                    }
                }

                const tags = new Map()
                if (author) tags.set("作者", [author])
                if (labels.length) tags.set("标签", labels)
                if (stats.length) tags.set("站点数据", stats)

                return new ComicDetails({
                    title: title,
                    subTitle: author,
                    cover: coverElement ? this._absoluteUrl(coverElement.attributes["src"]) : "",
                    description: summary ? summary.text.trim() : "",
                    tags: tags,
                    chapters: chapters,
                    url: `${this.baseUrl}/pc/details/?kuid=${comicId[0]}`,
                })
            } finally {
                document.dispose()
            }
        },

        loadEp: async (comicId, epId) => {
            if (!epId) throw "缺少章节 ID"
            const url = `${this.baseUrl}/pc/ComicRead/index.php?zjid=${encodeURIComponent(String(epId))}`
            const html = await this._get(url)
            const data = this._comicReadData(html)

            if (!data.allowed) {
                const lockType = data.translate && data.translate.lockType
                if (lockType === "login") {
                    throw "本章需要登录。请在漫画源设置中登录 zero搬运网后重试。"
                }
                throw "本章受站点权限或 VIP 限制，当前账号无法阅读。"
            }

            const images = Array.isArray(data.images) ? data.images : []
            return {
                images: images.map((image) => this._absoluteUrl(image && image.src ? image.src : image)),
            }
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                url: this._absoluteUrl(url),
                headers: {
                    "Referer": `${this.baseUrl}/pc/ComicRead/index.php?zjid=${encodeURIComponent(String(epId || ""))}`,
                },
            }
        },

        onThumbnailLoad: (url) => {
            return {
                url: this._absoluteUrl(url),
                headers: {"Referer": `${this.baseUrl}/pc/pc/`},
            }
        },

        idMatch: "(?:kuid=)?(\\d+)",
        link: {
            domains: ["www.zerobyw33.com", "zerobyw33.com"],
            linkToId: (url) => {
                const match = String(url || "").match(/[?&]kuid=(\d+)/)
                return match ? match[1] : null
            },
        },
        enableTagsTranslate: false,
    }

    settings = {
        domain: {
            title: "站点域名",
            type: "input",
            validator: String.raw`^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?\/?$`,
            default: "www.zerobyw33.com",
        },
    }
}

