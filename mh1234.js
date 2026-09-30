/** @type {import('./_venera_.js')} */

class MH1234 extends ComicSource {
    name = "漫画1234"
    key = "mh1234"
    version = "2.0.0"
    minAppVersion = "1.6.0"
    url = "https://cdn.jsdelivr.net/gh/maplessovo/venera-configs@main/mh1234.js"

    get baseUrl() {
        let domain = this.loadSetting("domain") || "m.wmh1234.com"
        domain = String(domain).trim()
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/, "")
        return `https://${domain}`
    }

    get requestHeaders() {
        return {
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": `${this.baseUrl}/`,
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
        }
    }

    _absoluteUrl(url, origin = this.baseUrl) {
        if (!url) return ""
        url = String(url).trim().replaceAll("&amp;", "&")
        if (url.startsWith("//")) return `https:${url}`
        if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://")
        if (!url.startsWith("/")) url = `/${url}`
        return `${origin}${url}`
    }

    async _get(url, referer = `${this.baseUrl}/`) {
        const headers = Object.assign({}, this.requestHeaders, {"Referer": referer})
        const response = await Network.get(url, headers)
        if (response.status !== 200) {
            throw `漫画1234请求失败：HTTP ${response.status}`
        }
        return response.body
    }

    _comicId(href) {
        const match = String(href || "").match(/\/comic\/(\d+)\.html/i)
        return match ? match[1] : null
    }

    _imageUrl(image) {
        if (!image) return ""
        return this._absoluteUrl(image.attributes["data-src"] || image.attributes["src"] || "")
    }

    _comicFromCard(card) {
        const link = card.attributes["href"] ? card : card.querySelector('a[href*="/comic/"]')
        if (!link) return null

        const id = this._comicId(link.attributes["href"])
        if (!id) return null

        const image = card.querySelector("img")
        const titleElement = card.querySelector(".comic-card__title")
            || card.querySelector("h3")
            || card.querySelector("strong")
        const subTitleElement = card.querySelector(".comic-card__chapter")
            || card.querySelector("small")
            || card.querySelector("p")
        const tagElements = card.querySelectorAll(".comic-card__badge, .mint-tag")
        const tags = []
        for (const element of tagElements) {
            const value = element.text.trim()
            if (value && !tags.includes(value)) tags.push(value)
        }

        let title = titleElement ? titleElement.text.trim() : ""
        if (!title && image) title = String(image.attributes["alt"] || "").trim()
        if (!title) return null

        const subTitle = subTitleElement ? subTitleElement.text.trim() : ""
        return new Comic({
            id: id,
            title: title,
            subTitle: subTitle,
            cover: this._imageUrl(image),
            tags: tags,
            description: subTitle,
        })
    }

    _parseCards(document, selectors = null) {
        const candidates = selectors || [
            "article.comic-card",
            "a.mint-update-card",
            "a.mint-cover-card",
        ]
        const comics = []
        const seen = new Set()

        for (const selector of candidates) {
            for (const card of document.querySelectorAll(selector)) {
                const comic = this._comicFromCard(card)
                if (!comic || seen.has(comic.id)) continue
                seen.add(comic.id)
                comics.push(comic)
            }
        }
        return comics
    }

    _maxPage(html) {
        let maxPage = 1
        const pattern = /\/page\/(\d+)/g
        let match
        while ((match = pattern.exec(html)) !== null) {
            maxPage = Math.max(maxPage, parseInt(match[1]) || 1)
        }
        return maxPage
    }

    _pagedUrl(path, page) {
        const cleanPath = `/${String(path || "/category").replace(/^\/+|\/+$/g, "")}`
        const currentPage = Math.max(1, parseInt(page) || 1)
        return `${this.baseUrl}${cleanPath}${currentPage > 1 ? `/page/${currentPage}` : ""}`
    }

    async _loadList(path, page = 1) {
        const url = this._pagedUrl(path, page)
        const html = await this._get(url)
        const document = new HtmlDocument(html)
        try {
            return {
                comics: this._parseCards(document, ["article.comic-card"]),
                maxPage: this._maxPage(html),
            }
        } finally {
            document.dispose()
        }
    }

    _category(label, param) {
        return {
            label: label,
            target: {
                page: "category",
                attributes: {category: label, param: param},
            },
        }
    }

    explore = [
        {
            title: "漫画1234",
            type: "multiPartPage",
            load: async () => {
                const pages = await Promise.all([
                    this._get(`${this.baseUrl}/custom/update`),
                    this._get(`${this.baseUrl}/custom/top`),
                    this._get(`${this.baseUrl}/`),
                ])

                const documents = pages.map((html) => new HtmlDocument(html))
                try {
                    return [
                        {
                            title: "最新更新",
                            comics: this._parseCards(documents[0], ["article.comic-card"]),
                            viewMore: {
                                page: "category",
                                attributes: {category: "最近更新", param: "/category/order/addtime"},
                            },
                        },
                        {
                            title: "人气排行",
                            comics: this._parseCards(documents[1], ["article.comic-card"]),
                            viewMore: {
                                page: "category",
                                attributes: {category: "热门", param: "/category/order/hits"},
                            },
                        },
                        {
                            title: "发现好故事",
                            comics: this._parseCards(documents[2], ["a.mint-cover-card"]),
                            viewMore: {
                                page: "category",
                                attributes: {category: "全部", param: "/category"},
                            },
                        },
                    ]
                } finally {
                    for (const document of documents) document.dispose()
                }
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
                    this._category("全部", "/category"),
                    this._category("恋爱", "/category/tags/17"),
                    this._category("搞笑", "/category/tags/13"),
                    this._category("热血", "/category/tags/6"),
                    this._category("都市", "/category/tags/31"),
                    this._category("少女", "/category/tags/187"),
                    this._category("科幻", "/category/tags/8"),
                    this._category("魔幻", "/category/tags/69"),
                    this._category("奇幻", "/category/tags/96"),
                    this._category("冒险", "/category/tags/7"),
                    this._category("纯爱", "/category/tags/77"),
                    this._category("校园", "/category/tags/11"),
                    this._category("耽美", "/category/tags/16"),
                    this._category("古风", "/category/tags/28"),
                    this._category("悬疑", "/category/tags/18"),
                    this._category("玄幻", "/category/tags/10"),
                    this._category("穿越", "/category/tags/14"),
                    this._category("恐怖", "/category/tags/19"),
                    this._category("武侠", "/category/tags/66"),
                    this._category("灵异", "/category/tags/26"),
                    this._category("百合", "/category/tags/27"),
                    this._category("治愈", "/category/tags/67"),
                    this._category("重生", "/category/tags/171"),
                    this._category("系统", "/category/tags/173"),
                    this._category("动作", "/category/tags/21"),
                    this._category("同人", "/category/tags/22"),
                ],
            },
            {
                name: "地区",
                type: "fixed",
                categories: [
                    this._category("国漫", "/category/tags/257"),
                    this._category("韩漫", "/category/tags/209"),
                    this._category("日漫", "/category/tags/240"),
                    this._category("欧美", "/category/tags/258"),
                    this._category("其他", "/category/tags/97"),
                    this._category("同人漫画", "/category/tags/22"),
                ],
            },
            {
                name: "状态与排序",
                type: "fixed",
                categories: [
                    this._category("连载", "/category/finish/1"),
                    this._category("完结", "/category/finish/2"),
                    this._category("最新收录", "/category/order/id"),
                    this._category("热门", "/category/order/hits"),
                    this._category("最近更新", "/category/order/addtime"),
                ],
            },
        ],
        enableRankingPage: false,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            return this._loadList(param || "/category", page)
        },
    }

    search = {
        load: async (keyword, options, page) => {
            if ((parseInt(page) || 1) > 1) return {comics: [], maxPage: 1}
            const url = `${this.baseUrl}/search?key=${encodeURIComponent(String(keyword || "").trim())}`
            const html = await this._get(url)
            const document = new HtmlDocument(html)
            try {
                return {
                    comics: this._parseCards(document, ["article.comic-card"]),
                    maxPage: 1,
                }
            } finally {
                document.dispose()
            }
        },
        enableTagsSuggestions: false,
    }

    comic = {
        loadInfo: async (id) => {
            const comicId = String(id || "").match(/\d+/)
            if (!comicId) throw "无效的漫画 ID"

            const url = `${this.baseUrl}/comic/${comicId[0]}.html`
            const html = await this._get(url)
            const document = new HtmlDocument(html)
            try {
                const titleElement = document.querySelector("#mintWorkTitle")
                const coverElement = document.querySelector("#mintWorkCover")
                if (!titleElement) throw "漫画详情解析失败，站点页面结构可能已经更新"

                const infoParagraphs = document.querySelectorAll(".mint-work-info p")
                let author = infoParagraphs.length > 0 ? infoParagraphs[0].text.trim() : ""
                author = author.replace(/(?:,?作者:?,?)/g, " ").replace(/\s+/g, " ").trim()

                const statusElement = document.querySelector(".mint-work-info .mint-tag")
                const metaElement = document.querySelector(".mint-work-meta")
                const introElement = document.querySelector("#mintIntroPanel div")
                const chapters = new Map()

                for (const chapter of document.querySelectorAll('[data-mint-chapters] a[href*="/go/"]')) {
                    const match = String(chapter.attributes["href"] || "").match(/\/go\/([^/?#]+)/)
                    if (match) chapters.set(match[1], chapter.text.trim() || match[1])
                }
                if (chapters.size === 0) throw "未找到章节列表，站点页面结构可能已经更新"

                const tags = new Map()
                if (author) tags.set("作者", [author])
                if (statusElement) tags.set("状态", [statusElement.text.trim()])
                if (metaElement) tags.set("更新", [metaElement.text.trim()])

                return new ComicDetails({
                    title: titleElement.text.trim(),
                    subTitle: author,
                    cover: this._imageUrl(coverElement),
                    description: introElement ? introElement.text.trim() : "",
                    tags: tags,
                    chapters: chapters,
                    recommend: this._parseCards(document, ["a.mint-cover-card"]),
                    url: url,
                })
            } finally {
                document.dispose()
            }
        },

        loadEp: async (comicId, epId) => {
            const token = String(epId || "").trim()
            if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) throw "无效的章节 ID"

            const readerUrl = `https://reader.hqread.cc/r/${token}`
            const html = await this._get(readerUrl, `${this.baseUrl}/comic/${comicId}.html`)
            const document = new HtmlDocument(html)
            try {
                const images = []
                for (const image of document.querySelectorAll("img.reader-image")) {
                    const value = image.attributes["data-src"] || image.attributes["src"] || ""
                    if (value && !value.includes("placeholder.svg")) {
                        images.push(this._absoluteUrl(value, "https://reader.hqread.cc"))
                    }
                }

                if (images.length === 0) {
                    const gate = document.querySelector("#mintReaderGateText")
                    const message = gate ? gate.text.trim() : ""
                    throw message || "未找到章节图片，章节可能受权限限制或站点页面结构已经更新"
                }
                return {images: images}
            } finally {
                document.dispose()
            }
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                url: this._absoluteUrl(url, "https://reader.hqread.cc"),
                headers: {"Referer": `https://reader.hqread.cc/r/${String(epId || "")}`},
            }
        },

        onThumbnailLoad: (url) => {
            return {
                url: this._absoluteUrl(url),
                headers: {"Referer": `${this.baseUrl}/`},
            }
        },

        idMatch: "(?:comic/)?(\\d+)",
        link: {
            domains: ["m.wmh1234.com", "www.wmh1234.com", "wmh1234.com"],
            linkToId: (url) => {
                const match = String(url || "").match(/\/comic\/(\d+)\.html/i)
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
            default: "m.wmh1234.com",
        },
    }
}
