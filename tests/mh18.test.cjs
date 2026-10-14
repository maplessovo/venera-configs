const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const code = fs.readFileSync(path.join(__dirname, '..', 'mh18.js'), 'utf8');
function makeSource({domain = '18mh.org', get = async () => ({status: 200, body: '', headers: {}}), HtmlDocument} = {}) {
  const context = vm.createContext({
    ComicSource: class { loadSetting() { return domain; } },
    Comic: class { constructor(value) { Object.assign(this, value); } },
    ComicDetails: class { constructor(value) { Object.assign(this, value); } },
    Network: { get },
    HtmlDocument: HtmlDocument || class { constructor() { throw new Error('Challenge HTML must not be parsed'); } },
    console,
  });
  return vm.runInContext(`${code}\nnew MH18()`, context);
}

test('domain settings accept a hostname or pasted HTTPS URL', () => {
  assert.equal(makeSource({domain: ' https://18mh.org/ '}).baseUrl, 'https://18mh.org');
  assert.equal(makeSource({domain: 'mirror.example'}).baseUrl, 'https://mirror.example');
  assert.equal(makeSource({domain: undefined}).baseUrl, 'https://18mh.org');
});

test('requests use the app-managed User-Agent and consistent Referer', async () => {
  let headers;
  const response = {status: 200, body: '<html>Normal page</html>', headers: {}};
  const source = makeSource({get: async (_, h) => { headers = h; return response; }});
  assert.equal(await source.request('https://18mh.org/'), response);
  assert.equal(headers.Referer, 'https://18mh.org/');
  assert(!Object.keys(headers).some(key => key.toLowerCase() === 'user-agent'));
  for (const handler of [source.comic.onThumbnailLoad, source.comic.onImageLoad]) {
    const config = handler('https://18mh.org/image.jpg');
    assert.equal(config.headers.Referer, headers.Referer);
    assert(!Object.keys(config.headers).some(key => key.toLowerCase() === 'user-agent'));
  }
});

const challenges = [
  {status: 403, headers: {'Cf-Mitigated': 'challenge'}, body: ''},
  {status: 200, headers: {'CF-MITIGATED': ['challenge']}, body: ''},
  {status: 503, headers: {}, body: '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'},
  {status: 200, headers: {}, body: '<script>window._cf_chl_opt = {};</script>'},
  {status: 200, headers: {}, body: '<form id="challenge-form"></form>'},
  {status: 200, headers: {}, body: '<TITLE>Just a moment...</TITLE>'},
];
for (const [index, response] of challenges.entries()) {
  test(`challenge variant ${index + 1} uses the native verification marker and host homepage`, async () => {
    let count = 0;
    const source = makeSource({get: async () => { count++; return response; }});
    await assert.rejects(source.request('https://mirror.example/chapter/getcontent?m=1&c=2'), error => {
      assert.equal(error, 'CloudflareException: https://mirror.example/');
      return true;
    });
    assert.equal(count, 1);
  });
}

test('normal Cloudflare-hosted pages, JS detection, and Turnstile widgets are not challenges', async () => {
  for (const body of [
    '<html>Normal content</html>',
    '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    '<p>The comic title is Just a moment</p>',
  ]) {
    const response = {status: 200, headers: {server: 'cloudflare'}, body};
    const source = makeSource({get: async () => response});
    assert.equal(await source.request('https://18mh.org/'), response);
  }
});

test('ordinary HTTP failures keep their status instead of opening verification', async () => {
  for (const status of [403, 404, 503]) {
    const source = makeSource({get: async () => ({status, headers: {server: 'cloudflare'}, body: '<html>Unavailable</html>'})});
    await assert.rejects(source.request('https://18mh.org/'), error => {
      assert.equal(error, `请求失败：HTTP ${status}`);
      return true;
    });
  }
});

test('native verification errors from Network.get are preserved', async () => {
  const error = 'CloudflareException: https://18mh.org/manga';
  const source = makeSource({get: async () => { throw error; }});
  await assert.rejects(source.request('https://18mh.org/manga'), actual => actual === error);
});

test('network errors are preserved and never silently retried', async () => {
  const error = new Error('Connection timed out');
  let calls = 0;
  const source = makeSource({get: async () => { calls++; throw error; }});
  await assert.rejects(source.request('https://18mh.org/'), actual => actual === error);
  assert.equal(calls, 1);
});

const loaders = [
  ['home', source => source.explore[0].load()],
  ['category', source => source.categoryComics.load('全部', '/manga', [], 2)],
  ['search', source => source.search.load('a/b ?漫画', [], 2)],
  ['details', source => source.comic.loadInfo('/manga/example')],
  ['chapter', source => source.comic.loadEp('example', '1@2')],
];
for (const [name, load] of loaders) {
  test(`${name} detects challenge HTML before parsing and uses shared headers`, async () => {
    let requestedUrl;
    const source = makeSource({get: async (url, headers) => {
      requestedUrl = url;
      assert.equal(headers.Referer, 'https://18mh.org/');
      return {status: 200, headers: {}, body: '<script>window._cf_chl_opt = {};</script>'};
    }});
    await assert.rejects(load(source), error => error === 'CloudflareException: https://18mh.org/');
    if (name === 'search') assert.match(requestedUrl, /\/s\/a%2Fb%20%3F%E6%BC%AB%E7%94%BB\?page=2$/);
  });
}

test('chapter-list AJAX requests also reach the native verification flow', async () => {
  let calls = 0;
  const source = makeSource({
    get: async (url, headers) => {
      calls++;
      assert.equal(headers.Referer, 'https://18mh.org/');
      if (calls === 1) return {status: 200, headers: {}, body: 'details'};
      assert.match(url, /\/manga\/get\?mid=123/);
      return {status: 503, headers: {'cf-mitigated': 'challenge'}, body: ''};
    },
    HtmlDocument: class {
      querySelector(selector) {
        if (selector === '#mangachapters') return {attributes: {'data-mid': '123'}};
        return {text: 'Example', attributes: {src: 'cover.jpg'}};
      }
      querySelectorAll() { return Array.from({length: 3}, () => ({querySelectorAll: () => []})); }
    },
  });
  await assert.rejects(source.comic.loadInfo('/manga/example'), error => error === 'CloudflareException: https://18mh.org/');
  assert.equal(calls, 2);
});

test('after verification, retrying the request returns content without another prompt', async () => {
  let verified = false;
  const content = {status: 200, headers: {}, body: '<html>Comics</html>'};
  const source = makeSource({get: async () => verified ? content : challenges[0]});
  await assert.rejects(source.request('https://18mh.org/'), error => error === 'CloudflareException: https://18mh.org/');
  verified = true; // Venera persists the WebView cookie and retries the loader.
  assert.equal(await source.request('https://18mh.org/'), content);
});
