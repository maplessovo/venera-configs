/** @type {import('./_venera_.js')} */

class CosplayTele extends ComicSource {
    name = "CosplayTele"

    key = "cosplaytele"

    version = "1.0.1"

    minAppVersion = "1.4.6"

    url = "https://cdn.jsdelivr.net/gh/maplessovo/venera-configs@main/cosplaytele.js"

    baseUrl = "https://cosplaytele.com"

    apiUrl = `${this.baseUrl}/wp-json/wp/v2`

    pageSize = 18

    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }

    imageHeaders = {
        "Referer": `${this.baseUrl}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }

    _buildApiUrl(path, params = {}) {
        let query = Object.entries(params)
            .filter(([, value]) => value !== null && value !== undefined && value !== "")
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&")
        return `${this.apiUrl}/${path}${query ? `?${query}` : ""}`
    }

    async _request(path, params = {}) {
        let response = await Network.get(this._buildApiUrl(path, params), this.headers)
        if (response.status !== 200) {
            throw `CosplayTele request failed: ${response.status}`
        }
        return {
            data: JSON.parse(response.body),
            headers: response.headers ?? {},
        }
    }

    _getHeader(headers, name) {
        let key = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === name.toLowerCase())
        if (!key) return null
        let value = headers[key]
        return Array.isArray(value) ? value[0] : value
    }

    _htmlToText(html) {
        if (!html) return ""
        let document = new HtmlDocument(`<div>${html}</div>`)
        try {
            return document.querySelector("div")?.text?.trim() ?? ""
        } finally {
            document.dispose()
        }
    }

    _getTerms(post, taxonomy) {
        let groups = post?._embedded?.["wp:term"]
        if (!Array.isArray(groups)) return []

        let terms = []
        for (let group of groups) {
            if (!Array.isArray(group)) continue
            for (let term of group) {
                if (term?.taxonomy === taxonomy && term.name) {
                    terms.push(this._htmlToText(term.name))
                }
            }
        }
        return terms.filter(Boolean)
    }

    _getCover(post) {
        let media = post?._embedded?.["wp:featuredmedia"]?.[0]
        return media?.media_details?.sizes?.medium_large?.source_url
            ?? media?.media_details?.sizes?.medium?.source_url
            ?? media?.source_url
            ?? ""
    }

    _formatDate(value) {
        if (!value) return ""
        let date = new Date(value)
        if (Number.isNaN(date.getTime())) return value.toString().split("T")[0]
        let year = date.getFullYear()
        let month = `${date.getMonth() + 1}`.padStart(2, "0")
        let day = `${date.getDate()}`.padStart(2, "0")
        return `${year}-${month}-${day}`
    }

    _parsePost(post) {
        let categories = this._getTerms(post, "category")
        let postTags = this._getTerms(post, "post_tag")
        return new Comic({
            id: post?.slug ?? post?.id?.toString() ?? "",
            title: this._htmlToText(post?.title?.rendered) || post?.slug || "Untitled",
            subTitle: categories.join(" / "),
            cover: this._getCover(post),
            tags: [...categories, ...postTags],
            description: this._htmlToText(post?.excerpt?.rendered),
            updateTime: this._formatDate(post?.modified ?? post?.date),
        })
    }

    async _loadPosts(params, page, pageSize = this.pageSize) {
        page = Math.max(1, Number(page) || 1)
        let result = await this._request("posts", {
            ...params,
            page: page,
            per_page: pageSize,
            orderby: "date",
            order: "desc",
            _embed: "wp:featuredmedia,wp:term",
            _fields: "id,slug,date,modified,link,title,excerpt,_links,_embedded",
        })
        let posts = Array.isArray(result.data) ? result.data : []
        let totalPages = Number(this._getHeader(result.headers, "x-wp-totalpages"))
        if (!Number.isFinite(totalPages) || totalPages < 1) {
            totalPages = posts.length < pageSize ? page : page + 1
        }
        return {
            comics: posts.map((post) => this._parsePost(post)).filter((comic) => comic.id),
            maxPage: totalPages,
        }
    }

    async _loadPost(id, includeContent = false) {
        let fields = "id,slug,date,modified,link,title,excerpt,_links,_embedded"
        if (includeContent) fields += ",content"

        let result = await this._request("posts", {
            slug: id,
            per_page: 1,
            _embed: "wp:featuredmedia,wp:term",
            _fields: fields,
        })
        let post = Array.isArray(result.data) ? result.data[0] : null
        if (!post) throw `CosplayTele post not found: ${id}`
        return post
    }

    _normalizeUrl(url) {
        if (!url) return ""
        url = url.replaceAll("&amp;", "&").trim()
        if (url.startsWith("//")) return `https:${url}`
        if (url.startsWith("/")) return `${this.baseUrl}${url}`
        return url
    }

    _isGalleryImage(url) {
        if (!url || !url.includes("/wp-content/uploads/")) return false
        let path = url.split(/[?#]/)[0]
        return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(path)
    }

    _extractImages(html) {
        let document = new HtmlDocument(html ?? "")
        let images = []
        let seen = new Set()

        let addImage = (url) => {
            url = this._normalizeUrl(url)
            if (!this._isGalleryImage(url) || seen.has(url)) return
            seen.add(url)
            images.push(url)
        }

        try {
            for (let link of document.querySelectorAll("a[href]")) {
                addImage(link.attributes?.["href"])
            }
            for (let image of document.querySelectorAll("img")) {
                let attributes = image.attributes ?? {}
                addImage(attributes["data-src"] ?? attributes["data-lazy-src"] ?? attributes["src"])
            }
        } finally {
            document.dispose()
        }
        return images
    }

    _extractTopSearchGroups(html) {
        let document = new HtmlDocument(html ?? "")
        let groups = []
        let supportedTitles = ["Top Search", "Cosplayer", "Character", "Game"]

        try {
            for (let heading of document.querySelectorAll("h2")) {
                let title = heading.text?.trim() ?? ""
                if (!supportedTitles.includes(title)) continue

                let container = heading.parent
                let categories = []
                let tags = []
                for (let link of container?.querySelectorAll("a[href]") ?? []) {
                    let href = link.attributes?.["href"] ?? ""
                    let match = href.match(/\/(category|tag)\/([^/?#]+)\/?/i)
                    if (!match) continue
                    let slug = decodeURIComponent(match[2])
                    let list = match[1].toLowerCase() === "category" ? categories : tags
                    if (!list.includes(slug)) list.push(slug)
                }
                if (categories.length > 0 || tags.length > 0) {
                    groups.push({ title, categories, tags })
                }
            }
        } finally {
            document.dispose()
        }
        return groups
    }

    async _resolveTerms(path, slugs) {
        if (slugs.length === 0) return new Map()
        let result = await this._request(path, {
            slug: slugs.join(","),
            per_page: 100,
            _fields: "id,name,slug",
        })
        let map = new Map()
        for (let term of Array.isArray(result.data) ? result.data : []) {
            if (term?.slug && term?.id != null) map.set(term.slug, term.id.toString())
        }
        return map
    }

    async _loadTopSearch() {
        let pageResult = await this._request("pages", {
            slug: "top-search",
            per_page: 1,
            _fields: "content",
        })
        let page = Array.isArray(pageResult.data) ? pageResult.data[0] : null
        let groups = this._extractTopSearchGroups(page?.content?.rendered)
        if (groups.length === 0) throw "Top Search groups not found"

        let categorySlugs = [...new Set(groups.flatMap((group) => group.categories))]
        let tagSlugs = [...new Set(groups.flatMap((group) => group.tags))]
        let [categoryMap, tagMap] = await Promise.all([
            this._resolveTerms("categories", categorySlugs),
            this._resolveTerms("tags", tagSlugs),
        ])

        return Promise.all(groups.map(async (group) => {
            let categoryIds = group.categories.map((slug) => categoryMap.get(slug)).filter(Boolean)
            let tagIds = group.tags.map((slug) => tagMap.get(slug)).filter(Boolean)
            let loaders = []
            if (categoryIds.length > 0) {
                loaders.push(this._loadPosts({ categories: categoryIds.join(",") }, 1, 8))
            }
            if (tagIds.length > 0) {
                loaders.push(this._loadPosts({ tags: tagIds.join(",") }, 1, 8))
            }

            let results = await Promise.all(loaders)
            let comics = []
            let seen = new Set()
            for (let result of results) {
                for (let comic of result.comics) {
                    if (seen.has(comic.id)) continue
                    seen.add(comic.id)
                    comics.push(comic)
                }
            }
            return { title: group.title, comics: comics.slice(0, 12) }
        }))
    }

    async _loadLevelCosplay() {
        let definitions = [
            { title: "Cosplay Nude", slug: "cosplay-nude" },
            { title: "Cosplay Ero", slug: "cosplay-ero" },
            { title: "Cosplay", slug: "cosplay" },
        ]
        let categoryMap = await this._resolveTerms("categories", definitions.map((item) => item.slug))

        return Promise.all(definitions.map(async (item) => {
            let id = categoryMap.get(item.slug)
            if (!id) return { title: item.title, comics: [] }
            let result = await this._loadPosts({ categories: id }, 1, 12)
            return {
                title: item.title,
                comics: result.comics,
                viewMore: `category:${item.title}@${id}`,
            }
        }))
    }

    async _loadPopularPosts(range, timeQuantity = null, timeUnit = null) {
        let params = {
            limit: 20,
            range: range,
            time_quantity: timeQuantity,
            time_unit: timeUnit,
            _embed: "wp:featuredmedia,wp:term",
            _fields: "id,slug,date,modified,link,title,excerpt,_links,_embedded",
        }
        let query = Object.entries(params)
            .filter(([, value]) => value !== null && value !== undefined && value !== "")
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join("&")
        let url = `${this.baseUrl}/wp-json/wordpress-popular-posts/v1/popular-posts?${query}`
        let response = await Network.get(url, this.headers)
        if (response.status !== 200) throw `CosplayTele popular posts failed: ${response.status}`
        let posts = JSON.parse(response.body)
        return (Array.isArray(posts) ? posts : []).map((post) => this._parsePost(post))
    }

    async _loadTopCosplay() {
        let [daily, threeDays, sevenDays] = await Promise.all([
            this._loadPopularPosts("custom", 24, "hour"),
            this._loadPopularPosts("custom", 3, "day"),
            this._loadPopularPosts("last7days"),
        ])
        return [
            { title: "24 hours", comics: daily },
            { title: "3 day", comics: threeDays },
            { title: "7 Day", comics: sevenDays },
        ]
    }

    explore = [
        {
            title: "CosplayTele",
            type: "multiPageComicList",
            load: async (page) => this._loadPosts({}, page),
        },
        {
            title: "Top Search",
            type: "multiPartPage",
            load: async () => this._loadTopSearch(),
        },
        {
            title: "Level Cosplay",
            type: "multiPartPage",
            load: async () => this._loadLevelCosplay(),
        },
        {
            title: "Top Cosplay",
            type: "multiPartPage",
            load: async () => this._loadTopCosplay(),
        }
    ]

    category = {
        title: "CosplayTele",
        parts: [
            {
                name: "Categories",
                type: "dynamic",
                loader: async () => {
                    let result = await this._request("categories", {
                        per_page: 50,
                        page: 1,
                        orderby: "count",
                        order: "desc",
                        hide_empty: true,
                        _fields: "id,name,slug,count",
                    })
                    let categories = Array.isArray(result.data) ? result.data : []
                    return categories.map((category) => ({
                        label: this._htmlToText(category.name),
                        target: {
                            page: "category",
                            attributes: {
                                category: this._htmlToText(category.name),
                                param: category.id.toString(),
                            },
                        },
                    }))
                },
            }
        ],
        enableRankingPage: false,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            if (!param) throw "Invalid category id"
            return this._loadPosts({ categories: param }, page)
        },
        optionList: [],
    }

    search = {
        load: async (keyword, options, page) => {
            return this._loadPosts({ search: keyword }, page)
        },
        optionList: [],
        enableTagsSuggestions: false,
    }

    comic = {
        loadInfo: async (id) => {
            id = id?.toString().trim() ?? ""
            if (!id) throw "Invalid CosplayTele post id"

            let post = await this._loadPost(id, true)
            let categories = this._getTerms(post, "category")
            let postTags = this._getTerms(post, "post_tag")
            let content = post?.content?.rendered ?? ""
            let document = new HtmlDocument(content)
            let description = ""
            try {
                description = document.querySelector("blockquote")?.text?.trim() ?? ""
            } finally {
                document.dispose()
            }
            if (!description) description = this._htmlToText(post?.excerpt?.rendered)

            let chapters = new Map()
            chapters.set(post.slug, "Photo Gallery")

            return new ComicDetails({
                title: this._htmlToText(post?.title?.rendered) || post.slug,
                cover: this._getCover(post),
                description: description,
                tags: {
                    "Category": categories,
                    "Tag": postTags,
                },
                chapters: chapters,
                updateTime: this._formatDate(post?.modified ?? post?.date),
                url: post?.link ?? `${this.baseUrl}/${post.slug}/`,
            })
        },

        loadEp: async (comicId, epId) => {
            let id = epId?.toString().trim() || comicId?.toString().trim()
            if (!id) throw "Invalid CosplayTele chapter id"
            let post = await this._loadPost(id, true)
            let images = this._extractImages(post?.content?.rendered)
            if (images.length === 0) throw "No gallery images found"
            return { images: images }
        },

        onImageLoad: () => ({ headers: this.imageHeaders }),

        onThumbnailLoad: () => ({ headers: this.imageHeaders }),

        onClickTag: (namespace, tag) => ({
            page: "search",
            keyword: tag,
        }),

        link: {
            domains: ["cosplaytele.com"],
            linkToId: (url) => {
                let match = url?.match(/^https?:\/\/(?:www\.)?cosplaytele\.com\/([^/?#]+)\/?/i)
                if (!match) return null
                let id = decodeURIComponent(match[1])
                if (["page", "category", "tag", "author", "wp-json"].includes(id)) return null
                return id
            },
        },

        enableTagsTranslate: false,
    }

    translation = {
        "zh_CN": {
            "Categories": "分类",
            "Category": "分类",
            "Tag": "标签",
            "Photo Gallery": "图片集",
        },
        "zh_TW": {
            "Categories": "分類",
            "Category": "分類",
            "Tag": "標籤",
            "Photo Gallery": "圖片集",
        },
    }
}
