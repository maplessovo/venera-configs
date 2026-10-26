const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {test} = require('node:test');

const root = path.resolve(__dirname, '..');
const library = fs.readFileSync(path.join(root, '_venera_.js'), 'utf8');

test('MH1234 reads current and saved legacy chapter links without crossing comic IDs', () => {
    const {source} = loadSource('mh1234.js');
    assert.equal(source._chapterId('/comic/56016/3969497.html', '56016'), '3969497');
    assert.equal(source._chapterId('/comic/56016/3969497.html?from=list', '56016'), '3969497');
    assert.equal(source._chapterId('/comic/99999/3969497.html', '56016'), null);
    assert.equal(source._chapterId('/go/saved_reader-token', '56016'), 'saved_reader-token');
    assert.equal(source._chapterId('https://other.example/go/token', '56016'), null);
});

test('MH1234 resolves the literal reader redirect and keeps its actual image Referer', async () => {
    const rt = loadSource('mh1234.js', {request: async message => {
        assert.equal(message.url, 'https://m.wmh1234.com/comic/56016/3969497.html');
        assert.equal(message.headers.Referer, 'https://m.wmh1234.com/comic/56016.html');
        return {status: 200, body: '<script>location.replace("https://reader.hqread.cc/r/live-reader-token");</script>'};
    }});
    assert.equal(await rt.source._chapterReaderUrl('56016', '3969497'), 'https://reader.hqread.cc/r/live-reader-token');
    assert.equal(rt.source.comic.onImageLoad('https://image.example/page.webp', '56016', '3969497').headers.Referer,
        'https://reader.hqread.cc/r/live-reader-token');
    assert.equal(await rt.source._chapterReaderUrl('56016', 'saved-token'), 'https://reader.hqread.cc/r/saved-token');
    assert.equal(rt.calls.length, 1);
});

test('MH1234 refuses missing or foreign redirects and malformed chapter identifiers', async () => {
    for (const html of ['<html>No redirect</html>', '<script>location.replace("https://reader.hqread.cc.evil.example/r/token")</script>']) {
        const {source} = loadSource('mh1234.js', {request: async () => ({status: 200, body: html})});
        await assert.rejects(source._chapterReaderUrl('56016', '3969497'));
    }
    const {source} = loadSource('mh1234.js');
    await assert.rejects(source._chapterReaderUrl('../56016', '3969497'));
    await assert.rejects(source._chapterReaderUrl('56016', '../3969497'));
});

function loadSource(file, {settings = {}, settingsUnavailable = false, request, images = [], decoderRequest = false} = {}) {
    const calls = [], delays = [], data = new Map();
    let source, disposed = 0;
    function sendMessage(message) {
        switch (message.method) {
            case 'load_setting': {
                if (settingsUnavailable) throw new Error(`Setting not found: ${message.setting_key}`);
                return settings[message.setting_key] ?? source?.settings?.[message.setting_key]?.default;
            }
            case 'load_data': return data.get(message.data_key);
            case 'save_data': return data.set(message.data_key, message.data);
            case 'delay': delays.push(message.time); return Promise.resolve();
            case 'http':
                if (file === 'manwaba.js' && !decoderRequest && message.url.endsWith('/static/assets/js/base.js')) {
                    return Promise.resolve({status: 200, body: "AES_KEY: '0123456789abcdef0123456789abcdef'"});
                }
                calls.push(message); return request(message, calls.length);
            case 'convert': {
                if (message.type === 'base64') return Uint8Array.from(Buffer.from(message.value, 'base64')).buffer;
                if (message.type === 'utf8') return message.isEncode
                    ? Uint8Array.from(Buffer.from(message.value, 'utf8')).buffer
                    : Buffer.from(new Uint8Array(message.value)).toString('utf8');
                if (message.type === 'aes-cbc') {
                    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(new Uint8Array(message.key)), Buffer.from(new Uint8Array(message.iv)));
                    decipher.setAutoPadding(false);
                    return Uint8Array.from(Buffer.concat([decipher.update(Buffer.from(new Uint8Array(message.value))), decipher.final()])).buffer;
                }
                throw new Error(`Unexpected conversion: ${message.type}`);
            }
            case 'html': {
                if (message.function === 'parse') return;
                if (message.function === 'dispose') { disposed++; return; }
                if (message.function === 'querySelectorAll') return images.map((_, index) => index);
                if (message.function === 'getAttributes') return images[message.key];
                throw new Error(`Unexpected HTML call: ${message.function}`);
            }
            default: throw new Error(`Unexpected bridge call: ${message.method}`);
        }
    }
    const context = vm.createContext({sendMessage, ArrayBuffer, Uint8Array, console});
    vm.runInContext(library, context);
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    const className = code.match(/class\s+(\w+)\s+extends\s+ComicSource/)[1];
    vm.runInContext(`(() => { ${code}\n globalThis.testSource = new ${className}(); })()`, context);
    source = context.testSource;
    return {source, calls, delays, data, get disposed() { return disposed; }};
}

test('Zero preserves the configured scheme and site image URLs', () => {
    const {source} = loadSource('zerobyw33.js', {settings: {domain: ' http://www.zerobyw33.com/ '}});
    assert.equal(source.baseUrl, 'http://www.zerobyw33.com');
    assert.equal(source._absoluteUrl('//tupa.zerobyw33.com/page.jpg'), 'http://tupa.zerobyw33.com/page.jpg');
    assert.equal(source._absoluteUrl('http://images.example/page.jpg'), 'http://images.example/page.jpg');
    assert.equal(source._absoluteUrl('https://images.example/page.jpg'), 'https://images.example/page.jpg');
    assert.equal(source._absoluteUrl('/pc/details/?kuid=1&amp;page=2'), 'http://www.zerobyw33.com/pc/details/?kuid=1&page=2');
    assert.equal(source.account.loginWithWebview.url, 'http://www.zerobyw33.com/member.php?mod=logging&action=login');
});

test('Zero defaults to HTTPS and follows a custom login host', () => {
    const {source} = loadSource('zerobyw33.js', {settings: {domain: 'reader.example'}});
    assert.equal(source.baseUrl, 'https://reader.example');
    assert.equal(source.account.registerWebsite, 'https://reader.example/member.php?mod=register');
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example/pc/pc/', '漫画'), true);
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example.evil.test/pc/pc/', '漫画'), false);
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example/member.php?mod=logging', '登录'), false);
    assert.doesNotMatch(source.requestHeaders['User-Agent'], /Mobile|Android|iPhone/);
});

test('Zero retries a transient TLS failure once with a delay', async () => {
    const rt = loadSource('zerobyw33.js', {request: async (_, count) => {
        if (count === 1) throw 'DioException: Connection terminated during handshake';
        return {status: 200, body: 'ok'};
    }});
    assert.equal(await rt.source._get('https://www.zerobyw33.com/pc/pc/'), 'ok');
    assert.equal(rt.calls.length, 2);
    assert.deepEqual(rt.delays, [1000]);
});

test('Zero bounds TLS retries and never automatically downgrades a request', async () => {
    const rt = loadSource('zerobyw33.js', {request: async () => { throw 'handshake failed'; }});
    await assert.rejects(rt.source._get('https://www.zerobyw33.com/pc/pc/'), error => String(error).includes('TLS 握手失败'));
    assert.equal(rt.calls.length, 2);
    assert.ok(rt.calls.every(call => call.url.startsWith('https://')));
});

test('Zero does not retry HTTP denial responses', async () => {
    const rt = loadSource('zerobyw33.js', {request: async () => ({status: 403, body: ''})});
    await assert.rejects(rt.source._get('https://www.zerobyw33.com/pc/pc/'), error => String(error).includes('HTTP 403'));
    assert.equal(rt.calls.length, 1);
});

test('MH18 WebView status checks the selected host without accepting challenge titles', () => {
    const {source} = loadSource('mh18.js', {settings: {domains: 'https://reader.example/path'}});
    assert.equal(source.baseUrl, 'https://reader.example');
    assert.equal(source.account.loginWithWebview.url, 'https://18mh.org/');
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example/manga', '18漫画'), true);
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example.evil.test/', '18漫画'), false);
    assert.equal(source.account.loginWithWebview.checkStatus('http://reader.example/', '18漫画'), false);
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example/', 'Just a moment...'), false);
    assert.equal(source.account.loginWithWebview.checkStatus('https://reader.example/', 'reader.example'), false);
    assert.equal(source.headers['User-Agent'], undefined);
});

test('MH18 account config can be parsed before source settings are available', () => {
    const {source} = loadSource('mh18.js', {settingsUnavailable: true});
    assert.equal(source.account.loginWithWebview.url, 'https://18mh.org/');
    assert.equal(typeof source.account.loginWithWebview.checkStatus, 'function');
});

test('MH18 detects Cloudflare response headers and challenge HTML without retrying', async () => {
    const headerChallenge = loadSource('mh18.js', {request: async () => ({
        status: 403, headers: {'CF-Mitigated': 'challenge'}, body: '<html></html>',
    })});
    await assert.rejects(headerChallenge.source.getPage('https://18mh.org/'), error => String(error).includes('Cloudflare 验证'));
    assert.equal(headerChallenge.calls.length, 1);

    const bodyChallenge = loadSource('mh18.js', {request: async () => ({
        status: 200, body: '<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script>',
    })});
    await assert.rejects(bodyChallenge.source.getPage('https://18mh.org/'), error => String(error).includes('Cloudflare 验证'));

    const denied = loadSource('mh18.js', {request: async () => ({status: 403, body: 'Forbidden'})});
    await assert.rejects(denied.source.getPage('https://18mh.org/'), error => String(error).includes('HTTP 403'));
    assert.equal((await loadSource('mh18.js', {request: async () => ({status: 200, body: 'ok'})}).source.getPage('https://18mh.org/')), 'ok');
});

test('MH18 routes explore, category, search, comic and chapter requests through challenge detection', async () => {
    const rt = loadSource('mh18.js', {request: async () => ({
        status: 403, headers: {'cf-mitigated': 'challenge'}, body: '',
    })});
    const operations = [
        () => rt.source.explore[0].load(),
        () => rt.source.categoryComics.load('全部', '/manga', [], 1),
        () => rt.source.search.load('测试 漫画', [], 1),
        () => rt.source.comic.loadInfo('/manga/example'),
        () => rt.source.comic.loadEp('example', '1@2'),
    ];
    for (const operation of operations) {
        await assert.rejects(operation(), error => String(error).includes('Cloudflare 验证'));
    }
    assert.equal(rt.calls.length, operations.length);
    assert.ok(rt.calls.every(call => call.headers.Referer === 'https://18mh.org/'));
    assert.ok(rt.calls.every(call => call.headers['User-Agent'] === undefined));
    assert.ok(rt.calls[2].url.includes(encodeURIComponent('测试 漫画')));
});

test('Zero explore requests run sequentially with newest-first sorting', async () => {
    const {source} = loadSource('zerobyw33.js');
    let active = 0, maxActive = 0;
    const urls = [];
    source._loadComicList = async url => {
        urls.push(url);
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        return {comics: []};
    };
    await source.explore[0].load();
    assert.equal(maxActive, 1);
    assert.equal(urls.length, 3);
    assert.match(urls[0], /order=addtime&dir=desc/);
    assert.equal(source._sortParams([]).join('&'), 'order=addtime&dir=desc');
});

test('ComicWalker takes its app version from the Apple results array', async () => {
    const rt = loadSource('comic_walker.js', {request: async message => {
        if (message.url.includes('itunes.apple.com')) return {status: 200, body: JSON.stringify({results: [{version: '9.8.7'}]})};
        assert.match(message.headers['User-Agent'], /9\.8\.7/);
        return {status: 200, body: JSON.stringify({resources: {access_token: 'test-token'}})};
    }});
    await rt.source.init();
    assert.equal(rt.data.get('token'), 'test-token');
    assert.equal(rt.calls.length, 2);
});

test('ComicWalker rejects a failed token refresh without recursive requests', async () => {
    const rt = loadSource('comic_walker.js', {request: async () => ({status: 401, body: JSON.stringify({code: 'unauthorized'})})});
    await assert.rejects(rt.source.refreshToken(), /Anonymous authentication failed/);
    assert.equal(rt.calls.length, 1);
});

test('ComicWalker does not refresh authentication for invalid request parameters', async () => {
    const rt = loadSource('comic_walker.js', {request: async () => ({status: 400, body: JSON.stringify({code: 'invalid_request_parameter'})})});
    await rt.source.request('https://mobileapp.comic-walker.com/v2/screens/home', rt.source.headers);
    assert.equal(rt.calls.length, 1);
});

test('ComicWalker uses the CDN host for images while retaining authentication and decoding', () => {
    const {source, data} = loadSource('comic_walker.js');
    data.set('token', 'test-token');
    const config = source.comic.onImageLoad('https://cdn.example/1.jpg?signature=abc&drm_hash=010102030405060708');
    assert.equal(config.headers.Host, undefined);
    assert.equal(config.headers.Authorization, 'Bearer test-token');
    assert.equal(config.url, 'https://cdn.example/1.jpg?signature=abc');
    assert.equal(typeof config.onResponse, 'function');
});

test('MYCOMIC advertises only native-supported gzip', () => {
    const mycomic = fs.readFileSync(path.join(root, 'mycomic.js'), 'utf8');
    const encodings = [...mycomic.matchAll(/['"]accept-encoding['"]:\s*['"]([^'"]+)['"]/gi)];
    assert.ok(encodings.length > 0);
    assert.ok(encodings.every(match => match[1] === 'gzip'));
});

test('Baozi follows the selected site reader redirect with actual section IDs', async () => {
    const rt = loadSource('baozi.js', {
        settings: {domains: 'webmota.com', language: 'tw', cdn_domains: '', image_quality: '/w640'},
        request: async () => ({status: 200, body: 'fixture'}),
        images: [{'data-src': 'https://s1.bzcdn.net/scomic/book/2/3/1.jpg'}],
    });
    const read = await rt.source.comic.loadEp('book', '2_3');
    assert.equal(rt.calls[0].url, 'https://tw.webmota.com/user/page_direct?comic_id=book&section_slot=2&chapter_slot=3');
    assert.equal(read.images[0], 'https://s1.bzcdn.net/w640/scomic/book/2/3/1.jpg');
    assert.equal(rt.disposed, 1);
});

test('Baozi accepts saved numeric chapter IDs and rejects empty reader pages', async () => {
    const rt = loadSource('baozi.js', {request: async () => ({status: 200, body: 'fixture'})});
    await assert.rejects(rt.source.comic.loadEp('book', '17'), error => String(error).includes('未找到章节图片'));
    assert.match(rt.calls[0].url, /section_slot=0&chapter_slot=17$/);
    assert.equal(rt.disposed, 1);
});

test('Wnacg migrates the old default while preserving custom domains', () => {
    assert.equal(loadSource('wnacg.js', {settings: {domain0: 'wnacg.com'}}).source.baseUrl, 'https://www.wn001.cfd');
    assert.equal(loadSource('wnacg.js', {settings: {domain0: 'reader.example'}}).source.baseUrl, 'https://reader.example');
});

test('Wnacg reads a series album using its episode ID', async () => {
    const rt = loadSource('wnacg.js', {request: async () => ({status: 200, body: String.raw`{url:\"//img.example/1.jpg\"}`})});
    const read = await rt.source.comic.loadEp('390075', '374220');
    assert.match(rt.calls[0].url, /photos-gallery-aid-374220\.html$/);
    assert.equal(read.images[0], 'https://img.example/1.jpg');
});

test('Wnacg supplies browser headers for images and thumbnails', () => {
    const {source} = loadSource('wnacg.js');
    for (const hook of [source.comic.onImageLoad, source.comic.onThumbnailLoad]) {
        const config = hook('https://img.example/1.jpg');
        assert.equal(config.headers.Referer, source.baseUrl + '/');
        assert.match(config.headers['User-Agent'], /Mozilla/);
        assert.equal(config.url, 'https://img.example/1.jpg');
    }
});

test('YKMH sends flat headers and resolves relative pages against the configured CDN', async () => {
    const rt = loadSource('ykmh.js', {request: async message => {
        assert.equal(message.headers.headers, undefined);
        assert.ok(message.headers['User-Agent']);
        assert.ok(message.headers['Referer']);
        if (message.url.endsWith('/js/config.js')) return {status: 200, body: 'resHost: [{"domain":["https://cdn.example"]}], scheduler: "off"'};
        return {status: 200, body: 'var chapterImages = ["/images/comic/book/1.jpg","https://other.example/2.jpg"];'};
    }});
    const read = await rt.source.comic.loadEp('https://www.ykmh.net/manhua/book/', 'https://m.ykmh.net/manhua/book/1.html');
    assert.deepEqual(Array.from(read.images), ['https://cdn.example/images/comic/book/1.jpg', 'https://other.example/2.jpg']);
    assert.equal(rt.calls.length, 2);
});

test('Manwaba sends JSON headers and encodes search punctuation without creating extra parameters', async () => {
    const rt = loadSource('manwaba.js', {settings: {domain: 'https://reader.example/'}, request: async message => {
        const url = new URL(message.url);
        assert.equal(url.origin, 'https://reader.example');
        assert.equal(url.searchParams.get('keyword'), '中文 & +?#');
        assert.equal(url.searchParams.get('page'), '2');
        assert.equal(message.headers['Content-Type'], 'application/json');
        assert.equal(message.headers.Referer, 'https://reader.example/');
        return {status: 200, body: JSON.stringify({code: 200, data: {total: 21, list: [{id: 1, title: 'comic', tags: null}]}})};
    }});
    const result = await rt.source.search.load('中文 & +?#', [], 2);
    assert.equal(result.maxPage, 2);
    assert.equal(result.comics[0].id, '1');
    assert.equal(result.comics[0].tags.length, 0);
});

test('Manwaba keeps one supported explore page and tolerates absent home sections', async () => {
    const {source} = loadSource('manwaba.js', {request: async () => ({status: 200, body: JSON.stringify({code: 200, data: {
        comicList: [{id: 1, tags: null}, null], gufengList: null,
    }})})});
    assert.equal(source.explore.length, 1);
    assert.equal(source.explore[0].type, 'multiPartPage');
    const parts = await source.explore[0].load();
    assert.ok(Array.isArray(parts));
    assert.equal(parts.length, 4);
    assert.equal(parts[0].comics.length, 1);
    assert.equal(parts[1].comics.length, 0);
});

test('Manwaba restores the harem category route and preserves filters and pagination', async () => {
    const rt = loadSource('manwaba.js', {request: async message => {
        assert.equal(message.url, 'https://manwaxu.cc/api/cate/harem');
        assert.equal(message.http_method, 'POST');
        assert.equal(message.headers['Content-Type'], 'application/json');
        const payload = JSON.parse(message.data);
        assert.equal(payload.comic.tag, '后宫');
        assert.equal(payload.comic.status, -1);
        assert.equal(payload.sort, 0);
        assert.equal(payload.page.page, 2);
        return {status: 200, body: JSON.stringify({code: 200, data: {total: 41, list: [{url: '/comic/12/', tags: ['tag']}]}})};
    }});
    const result = await rt.source.categoryComics.load('后宫', '后宫', [], 2);
    assert.equal(result.maxPage, 3);
    assert.equal(result.comics[0].id, '12');
});

test('Manwaba routes other and custom tags to their own endpoints instead of the unfiltered list', async () => {
    const rt = loadSource('manwaba.js', {request: async () => ({status: 200, body: JSON.stringify({code: 200, data: {list: [], total: 0}})})});
    await rt.source.categoryComics.load('其他', '其他', [], 1);
    await rt.source.categoryComics.load('新标签', '新标签', [], 1);
    await rt.source.categoryComics.load('全部', '', [], 1);
    assert.equal(rt.calls[0].url, 'https://manwaxu.cc/api/cate/other');
    assert.equal(rt.calls[1].url, 'https://manwaxu.cc/api/cate/' + encodeURIComponent('新标签'));
    assert.equal(rt.calls[2].url, 'https://manwaxu.cc/api/cate');
});

test('Manwaba loads every image page when the server caps page size and honors the selected image source', async () => {
    const rt = loadSource('manwaba.js', {settings: {imageSource: 'https://tu.mwzu.cc'}, request: async message => {
        const url = new URL(message.url);
        assert.equal(url.searchParams.get('image_source'), 'https://tu.mwzu.cc');
        assert.equal(url.searchParams.get('page_size'), '100');
        assert.equal(url.searchParams.has('imageSource'), false);
        assert.equal(message.headers.Referer, 'https://manwaxu.cc/comic/1/2');
        const page = Number(url.searchParams.get('page'));
        const images = page < 3 ? [`https://img.example/${page * 2 - 1}.jpg`, `https://img.example/${page * 2}.jpg`] : ['https://img.example/5.jpg'];
        return {status: 200, body: JSON.stringify({code: 200, data: {images: images.map(url => ({url})), pagination: {total: 5, page_size: 2, total_pages: 3}}})};
    }});
    const result = await rt.source.comic.loadEp('1', '2');
    assert.equal(result.images.length, 5);
    assert.equal(rt.calls.length, 3);
    assert.equal(result.images[4], 'https://img.example/5.jpg');
});

test('Manwaba loads all chapters and supplies array-valued detail tags with missing metadata', async () => {
    const rt = loadSource('manwaba.js', {request: async message => {
        const url = new URL(message.url);
        if (url.pathname === '/api/comic/1') return {status: 200, body: JSON.stringify({code: 200, data: {id: 1, title: 'comic', tags: null}})};
        const page = Number(url.searchParams.get('page'));
        return {status: 200, body: JSON.stringify({code: 200, data: page === 1 ? [{id: 10, title: 'one'}, {id: 11, title: 'two'}] : [{id: 12, title: 'three'}], pagination: {total: 3, size: 2}})};
    }});
    const details = await rt.source.comic.loadInfo('1');
    assert.equal(details.chapters.size, 3);
    assert.equal(details.chapters.get('12'), 'three');
    assert.ok(Array.isArray(details.tags['状态']));
    assert.equal(details.updateTime, '');
});

test('Manwaba reports API denials and partial images instead of returning a truncated chapter', async () => {
    const denied = loadSource('manwaba.js', {request: async () => ({status: 200, body: JSON.stringify({code: 403, msg: '需要登录'})})});
    await assert.rejects(denied.source.comic.loadEp('1', '2'), error => String(error).includes('需要登录'));
    const partial = loadSource('manwaba.js', {request: async () => ({status: 200, body: JSON.stringify({code: 200, data: {images: [{url: 'https://img.example/1.jpg'}], pagination: {total: 2}}})})});
    await assert.rejects(partial.source.comic.loadEp('1', '2'), error => String(error).includes('未加载完整'));
    assert.equal(partial.calls.length, 2);
});

test('Manwaba decodes encrypted images and thumbnails with one shared public decoder request', async () => {
    const imageKey = '0123456789abcdef0123456789abcdef';
    const rt = loadSource('manwaba.js', {decoderRequest: true, settings: {domain: 'reader.example'}, request: async message => {
        assert.equal(message.url, 'https://reader.example/static/assets/js/base.js');
        return {status: 200, body: `const BaseUtil = {AES_KEY: '${imageKey}'};`};
    }});
    const cover = rt.source.comic.onThumbnailLoad('https://img.example/cover.jpg');
    // Original Venera's parser rejects a Promise here and cannot await onResponse.
    assert.equal(typeof cover.then, 'undefined');
    const image = await rt.source.comic.onImageLoad('https://img.example/1.jpg', '1', '2');
    assert.equal(image.headers.Referer, 'https://reader.example/comic/1/2');
    assert.equal(cover.headers.Referer, 'https://reader.example/');
    assert.equal(rt.calls.length, 1);
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
    const iv = Buffer.alloc(16, 7);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(imageKey), iv);
    const encrypted = Uint8Array.from(Buffer.concat([iv, cipher.update(plain), cipher.final()])).buffer;
    for (const config of [image, cover]) {
        assert.deepEqual(Buffer.from(new Uint8Array(config.onResponse(encrypted))), plain);
        const original = Uint8Array.from(plain).buffer;
        assert.equal(config.onResponse(original), original);
    }
    assert.throws(() => image.onResponse(new ArrayBuffer(17)), error => String(error).includes('图片数据无效'));
});

test('Manwaba can retry fetching the public decoder after a failed request', async () => {
    const rt = loadSource('manwaba.js', {decoderRequest: true, request: async (_, count) => count === 1
        ? {status: 503, body: ''}
        : {status: 200, body: "AES_KEY: '0123456789abcdef0123456789abcdef'"}});
    await assert.rejects(rt.source._getImageKey(), error => String(error).includes('解码配置'));
    await rt.source._getImageKey();
    assert.equal(typeof rt.source.comic.onThumbnailLoad('https://img.example/cover.jpg').onResponse, 'function');
    assert.equal(rt.calls.length, 2);
});

test('Manwaba prepares a synchronous cover decoder before returning lists, search, and details', async () => {
    let finishDecoder;
    const rt = loadSource('manwaba.js', {decoderRequest: true, request: async message => {
        if (message.url.endsWith('/base.js')) return new Promise(resolve => { finishDecoder = resolve; });
        return {status: 200, body: JSON.stringify({code: 200, data: {comicList: []}})};
    }});
    let completed = false;
    const loading = rt.source.explore[0].load().then(result => { completed = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    finishDecoder({status: 200, body: "AES_KEY: '0123456789abcdef0123456789abcdef'"});
    await loading;
    const config = rt.source.comic.onThumbnailLoad('https://img.example/cover.jpg');
    assert.equal(typeof config.then, 'undefined');
    assert.equal(typeof rt.source._thumbnailImageKey().then, 'undefined');
    assert.equal(rt.data.get('publicImageDecoder').domain, rt.source.baseUrl);
});

test('Manwaba restores a saved public decoder for history covers and rejects other domains', () => {
    const rt = loadSource('manwaba.js');
    rt.data.set('publicImageDecoder', {domain: rt.source.baseUrl, key: '0123456789abcdef0123456789abcdef'});
    assert.equal(rt.source._thumbnailImageKey().byteLength, 32);
    rt.data.set('publicImageDecoder', {domain: 'https://other.example', key: '0123456789abcdef0123456789abcdef'});
    assert.throws(() => rt.source._thumbnailImageKey(), error => String(error).includes('首页'));
    const plain = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).buffer;
    assert.equal(rt.source.comic.onThumbnailLoad('https://img.example/plain.jpg').onResponse(plain), plain);
});

for (const file of ['copy_manga.js', 'copy_manga_multi_accounts.js']) {
    test(`${file}: each explore More target opens the matching paginated list`, async () => {
        const comic = {path_word: 'comic-1', name: 'comic', theme: [], author: [], cover: 'https://img.example/cover.jpg'};
        const home = {recComics: {list: [{comic}]}, hotComics: [comic], newComics: [comic], finishComics: {list: [comic]},
            rankDayComics: {list: [{comic}]}, rankWeekComics: {list: [{comic}]}, rankMonthComics: {list: [{comic}]}};
        const rt = loadSource(file, {request: async message => ({status: 200, body: JSON.stringify({code: 200,
            results: message.url.includes('homeIndex') ? home : {list: [comic], total: 61}})})});
        Object.defineProperty(rt.source, 'headers', {value: {}});
        assert.equal(rt.source.explore.length, 1);
        assert.equal(rt.source.explore[0].type, 'multiPartPage');
        const parts = await rt.source.explore[0].load();
        assert.equal(parts.length, 7);
        const targets = new Map();
        for (const part of parts) {
            assert.equal(part.viewMore.page, 'category');
            const {category, param, options} = part.viewMore.attributes;
            const page = await rt.source.categoryComics.load(category, param, options, 2);
            assert.equal(page.maxPage, 3);
            const url = new URL(rt.calls.at(-1).url);
            assert.equal(url.searchParams.get('limit'), '30');
            assert.equal(url.searchParams.get('offset'), '30');
            targets.set(part.title, url);
        }
        assert.equal(targets.get('推荐').pathname, '/api/v3/recs');
        assert.equal(targets.get('推荐').searchParams.get('pos'), '3200102');
        assert.equal(targets.get('热门').searchParams.get('ordering'), '-popular');
        assert.equal(targets.get('最新').pathname, '/api/v3/update/newest');
        assert.equal(targets.get('完结').searchParams.get('top'), 'finish');
        for (const [title, period] of [['今日排行', 'day'], ['本周排行', 'week'], ['本月排行', 'month']]) {
            assert.equal(targets.get(title).pathname, '/api/v3/ranks');
            assert.equal(targets.get(title).searchParams.get('date_type'), period);
        }
    });
}

test('Baozi category More destinations preserve region filters and use safe defaults', async () => {
    const rt = loadSource('baozi.js', {request: async () => ({status: 200, body: JSON.stringify({items: [], next: null})})});
    assert.equal(rt.source.explore.length, 1);
    assert.equal(rt.source.explore[0].type, 'multiPartPage');
    await rt.source.categoryComics.load('全部', 'all', ['kr', 'serial'], 2);
    const url = new URL(rt.calls[0].url);
    assert.equal(url.searchParams.get('region'), 'kr');
    assert.equal(url.searchParams.get('state'), 'serial');
    assert.equal(url.searchParams.get('page'), '2');
    await rt.source.categoryComics.load('全部', null, null, 1);
    const defaultUrl = new URL(rt.calls[1].url);
    assert.equal(defaultUrl.searchParams.get('type'), 'all');
    assert.equal(defaultUrl.searchParams.get('region'), 'all');
    assert.equal(defaultUrl.searchParams.get('state'), 'all');
    const ended = await rt.source.categoryComics.load('最新上架', 'explore:new', [], 2);
    assert.equal(ended.maxPage, 1);
    assert.equal(ended.comics.length, 0);
    assert.equal(rt.calls.length, 2);
});

test('Manwaba More targets preserve popular, new, updated, and collection sorting', async () => {
    const rt = loadSource('manwaba.js', {request: async message => ({status: 200, body: JSON.stringify({code: 200,
        data: message.url.includes('/home?') ? {comicList: [], gufengList: [], xuanhuanList: [], xiaoyuanList: []} : {list: [], total: 0}})})});
    const parts = await rt.source.explore[0].load();
    const expected = ['3', '1', '0', '4'];
    for (let i = 0; i < parts.length; i++) {
        const target = parts[i].viewMore;
        assert.equal(target.page, 'category');
        const {category, param, options} = target.attributes;
        await rt.source.categoryComics.load(category, param, options, 2);
        const payload = JSON.parse(rt.calls.at(-1).data);
        assert.equal(payload.sort, Number(expected[i]));
        assert.equal(payload.page.page, 2);
        assert.equal(payload.comic.tag, i === 1 ? '完整版' : '');
    }
});
