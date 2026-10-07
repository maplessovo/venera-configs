const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const root = path.resolve(__dirname, '..');
const library = fs.readFileSync(path.join(root, '_venera_.js'), 'utf8');

function loadSource(file, {settings = {}, request, images = []} = {}) {
    const calls = [], delays = [], data = new Map();
    let source, disposed = 0;
    function sendMessage(message) {
        switch (message.method) {
            case 'load_setting': return settings[message.setting_key] ?? source?.settings?.[message.setting_key]?.default;
            case 'load_data': return data.get(message.data_key);
            case 'save_data': return data.set(message.data_key, message.data);
            case 'delay': delays.push(message.time); return Promise.resolve();
            case 'http': calls.push(message); return request(message, calls.length);
            case 'convert': {
                if (message.type === 'base64') return Uint8Array.from(Buffer.from(message.value, 'base64')).buffer;
                if (message.type === 'utf8') return Buffer.from(new Uint8Array(message.value)).toString('utf8');
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
