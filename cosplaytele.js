/** @type {import('./_venera_.js')} */

class CosplayTele extends ComicSource {
    name = "CosplayTele"
    key = "cosplaytele"
    version = "1.0.4"
    minAppVersion = "1.4.6"
    url = "https://cdn.jsdelivr.net/gh/maplessovo/venera-configs@main/cosplaytele.js"
    baseUrl = "https://cosplaytele.com"

    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Referer": "https://cosplaytele.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }

    _normalizeUrl(url) {
        url = String(url || "").replaceAll("&amp;", "&").trim()
        if (url.startsWith("//")) return `https:${url}`
        if (url.startsWith("/")) return `${this.baseUrl}${url}`
        return url
    }

    _postId(url) {
        const match = this._normalizeUrl(url).match(/^https?:\/\/(?:www\.)?cosplaytele\.com\/([^/?#]+)\/?(?:[?#].*)?$/i)
        if (!match) return null
        const slug = decodeURIComponent(match[1])
        if (["page", "category", "tag", "author", "wp-json", "top-search", "24-hours", "3-day", "7-day"].includes(slug)) return null
        return slug
    }

    async _get(url) {
        const response = await Network.get(url, this.headers)
        if (response.status !== 200) throw `CosplayTele 网页请求失败：HTTP ${response.status}`
        if (!response.body || /There has been a critical error on this website/i.test(response.body)) {
            throw "CosplayTele 网站暂时故障，请稍后重试"
        }
        return response.body
    }

    _cover(image) {
        const attributes = image?.attributes || {}
        return this._normalizeUrl(attributes["data-src"] || attributes["data-lazy-src"] || attributes["src"])
    }

    _parseCards(root) {
        const comics = []
        const seen = new Set()
        for (const card of root?.querySelectorAll(".post-item") || []) {
            const link = card.querySelector(".post-title a") || card.querySelector(".box-image a")
            const id = this._postId(link?.attributes?.["href"])
            const title = link?.text?.trim() || link?.attributes?.["aria-label"] || ""
            if (!id || !title || seen.has(id)) continue
            seen.add(id)
            const description = card.querySelector(".from_the_blog_excerpt")?.text?.trim() || ""
            comics.push(new Comic({
                id: id,
                title: title,
                cover: this._cover(card.querySelector("img")),
                description: description,
            }))
        }
        return comics
    }

    _maxPage(root, page) {
        let maxPage = page
        for (const link of root?.querySelectorAll(".page-numbers a[href]") || []) {
            const match = (link.attributes["href"] || "").match(/\/page\/(\d+)/)
            if (match) maxPage = Math.max(maxPage, Number(match[1]))
        }
        return maxPage
    }

    async _loadList(path = "/", page = 1, keyword = null) {
        page = Math.max(1, Number(page) || 1)
        // Older installed category targets may still use WordPress numeric IDs.
        const numericCategory = /^\d+$/.test(String(path)) ? String(path) : null
        if (numericCategory) path = "/"
        if (!/^\/(?:category\/[^/?#]+\/?|tag\/[^/?#]+\/?|)$/.test(path)) throw "无效的 CosplayTele 分类"
        let url = `${this.baseUrl}${path.replace(/\/?$/, "/")}${page > 1 ? `page/${page}/` : ""}`
        const query = []
        if (keyword !== null) query.push(`s=${encodeURIComponent(String(keyword).trim())}`)
        if (numericCategory) query.push(`cat=${numericCategory}`)
        if (query.length) url += `?${query.join("&")}`

        const html = await this._get(url)
        const document = new HtmlDocument(html)
        try {
            const root = document.querySelector("#post-list")
            if (!root) {
                if (document.querySelector(".no-results, .nothing-found")) return {comics: [], maxPage: page}
                throw "CosplayTele 列表解析失败，网站页面可能已更新"
            }
            return {comics: this._parseCards(root), maxPage: this._maxPage(root, page)}
        } finally {
            document.dispose()
        }
    }

    _target(label, param) {
        return {label: label, target: {page: "category", attributes: {category: label, param: param}}}
    }

    async _loadTopSearchTerms() {
        const document = new HtmlDocument(await this._get(`${this.baseUrl}/top-search/`))
        try {
            const heading = document.querySelectorAll("h2").find((element) => element.text.trim() === "Top Search")
            const terms = []
            const seen = new Set()
            for (const link of heading?.parent?.querySelectorAll("a[href]") || []) {
                const match = (link.attributes["href"] || "").match(/\/(category|tag)\/([^/?#]+)\/?/)
                if (!match) continue
                const value = `/${match[1]}/${match[2]}/`
                if (seen.has(value)) continue
                seen.add(value)
                terms.push({value: value, label: link.text.trim()})
            }
            if (!terms.length) throw "CosplayTele 热门词暂时不可用"
            return terms.slice(0, 10)
        } finally {
            document.dispose()
        }
    }

    _levels() {
        return [
            {value: "/category/cosplay-nudee/", label: "Nude"},
            {value: "/category/cosplay-ero/", label: "Ero"},
            {value: "/category/cosplay/", label: "Cosplay"},
        ]
    }

    async _loadPopular() {
        // The site's period-ranking widget also depends on its broken REST API.
        // Use the server-rendered Popular Cosplay section and label it accurately.
        const document = new HtmlDocument(await this._get(`${this.baseUrl}/`))
        try {
            for (const heading of document.querySelectorAll("h3")) {
                if (heading.text.trim() !== "Popular Cosplay") continue
                const children = heading.parent?.parent?.children || []
                let foundHeading = false
                for (const child of children) {
                    if (child.querySelector("h3")?.text?.trim() === "Popular Cosplay") {
                        foundHeading = true
                        continue
                    }
                    if (foundHeading) {
                        if (child.querySelector("h3")) break
                        const comics = this._parseCards(child)
                        if (comics.length) return {comics: comics, maxPage: 1}
                    }
                }
            }
            throw "CosplayTele 热门推荐暂时不可用"
        } finally {
            document.dispose()
        }
    }

    // One explore entry means one page in Venera. More posts load on scrolling.
    explore = [{
        title: "CosplayTele",
        type: "multiPageComicList",
        load: async (page) => this._loadList("/", page),
    }]

    category = {
        title: "CosplayTele",
        parts: [
            {
                name: "精选",
                type: "fixed",
                categories: [
                    this._target("最新发布", "/"),
                    this._target("Top Search", "top-search"),
                    this._target("Level Cosplay", "level-cosplay"),
                    this._target("热门推荐", "popular"),
                ],
            },
            {
                name: "分类",
                type: "dynamic",
                loader: async () => {
                    const document = new HtmlDocument(await this._get(`${this.baseUrl}/top-search/`))
                    try {
                        const categories = []
                        const seen = new Set()
                        for (const link of document.querySelectorAll('a[href*="/category/"]')) {
                            const match = (link.attributes["href"] || "").match(/\/category\/([^/?#]+)\/?/)
                            const label = link.text.trim()
                            if (!match || !label || seen.has(match[1])) continue
                            seen.add(match[1])
                            categories.push(this._target(label, `/category/${match[1]}/`))
                        }
                        return categories
                    } finally {
                        document.dispose()
                    }
                },
            },
        ],
        enableRankingPage: false,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            let selected = Array.isArray(options) ? options[0] : null
            if (selected) {
                try { selected = decodeURIComponent(selected) } catch (_) { selected = null }
            }
            if (param === "top-search") {
                const terms = await this._loadTopSearchTerms()
                return this._loadList(terms.find((term) => term.value === selected)?.value || terms[0].value, page)
            }
            if (param === "level-cosplay") {
                const levels = this._levels()
                return this._loadList(levels.find((level) => level.value === selected)?.value || levels[0].value, page)
            }
            if (param === "popular" || param === "top-cosplay") return this._loadPopular()
            return this._loadList(param || "/", page)
        },
        optionLoader: async (category, param) => {
            const terms = param === "top-search" ? await this._loadTopSearchTerms()
                : param === "level-cosplay" ? this._levels() : []
            // Encode paths so WordPress slugs containing '-' cannot confuse option parsing.
            return terms.length ? [{label: "筛选", options: terms.map((term) => `${encodeURIComponent(term.value).replaceAll("-", "%2D")}-${term.label}`)}] : []
        },
    }

    search = {
        load: async (keyword, options, page) => this._loadList("/", page, keyword),
        optionList: [],
        enableTagsSuggestions: false,
    }

    async _loadDetail(id) {
        id = String(id || "").trim()
        if (!id || /[\/?#]/.test(id)) throw "无效的 CosplayTele 作品 ID"
        return this._get(`${this.baseUrl}/${encodeURIComponent(id)}/`)
    }

    _gallery(document) {
        const images = []
        const seen = new Set()
        // Scope to real gallery items, excluding related posts and sidebar thumbnails.
        for (const item of document.querySelectorAll("article .entry-content.single-page .gallery-item")) {
            const image = item.querySelector("img")
            const value = item.querySelector("a[href]")?.attributes?.["href"] || this._cover(image)
            const url = this._normalizeUrl(value)
            if (!/\/wp-content\/uploads\/.+\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url) || seen.has(url)) continue
            seen.add(url)
            images.push(url)
        }
        return images
    }

    comic = {
        loadInfo: async (id) => {
            const document = new HtmlDocument(await this._loadDetail(id))
            try {
                const title = document.querySelector("h1.entry-title")?.text?.trim()
                if (!title) throw "CosplayTele 作品详情解析失败"
                const categories = []
                const tags = []
                for (const link of document.querySelectorAll("article footer.entry-meta a[href]")) {
                    const href = link.attributes["href"] || ""
                    if (href.includes("/category/")) categories.push(link.text.trim())
                    else if (href.includes("/tag/")) tags.push(link.text.trim())
                }
                const chapters = new Map()
                chapters.set(String(id), "Photo Gallery")
                return new ComicDetails({
                    title: title,
                    cover: this._cover(document.querySelector("article .gallery-item img")),
                    description: document.querySelector("article blockquote")?.text?.trim() || "",
                    tags: {"Category": categories, "Tag": tags},
                    chapters: chapters,
                    updateTime: document.querySelector("time.updated")?.attributes?.["datetime"]?.split("T")[0] || "",
                    url: `${this.baseUrl}/${encodeURIComponent(String(id))}/`,
                })
            } finally {
                document.dispose()
            }
        },
        loadEp: async (comicId, epId) => {
            const document = new HtmlDocument(await this._loadDetail(epId || comicId))
            try {
                const images = this._gallery(document)
                if (!images.length) throw "CosplayTele 未找到公开图片集"
                return {images: images}
            } finally {
                document.dispose()
            }
        },
        onImageLoad: () => ({headers: this.headers}),
        onThumbnailLoad: () => ({headers: this.headers}),
        onClickTag: (namespace, tag) => ({page: "search", keyword: tag}),
        link: {domains: ["cosplaytele.com"], linkToId: (url) => this._postId(url)},
        enableTagsTranslate: false,
    }

    translation = {
        "zh_CN": {"Category": "分类", "Tag": "标签", "Photo Gallery": "图片集"},
        "zh_TW": {"Category": "分類", "Tag": "標籤", "Photo Gallery": "圖片集"},
    }
}
