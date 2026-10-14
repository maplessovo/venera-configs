const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourceCode = fs.readFileSync(path.join(__dirname, '..', 'shonen_jump_plus.js'), 'utf8');
function makeSource(network) {
  const context = vm.createContext({
    ComicSource: class {},
    Comic: class { constructor(value) { Object.assign(this, value); } },
    ComicDetails: class { constructor(value) { Object.assign(this, value); } },
    randomInt: () => 0,
    Network: network,
  });
  return vm.runInContext(`${sourceCode}\nnew ShonenJumpPlus()`, context);
}
const json = (body, status = 200) => ({ status, body: JSON.stringify(body) });

test('initialization gets the app version from the Apple lookup response', async () => {
  const urls = [];
  const source = makeSource({ get: async url => {
    urls.push(url);
    return json({ results: [{ trackId: 875750302, version: '5.0.1' }] });
  }});
  await source.init();
  assert.equal(source.latestVersion, '5.0.1');
  assert.equal(source.headers['User-Agent'], 'ShonenJumpPlus-Android/5.0.1');
  assert.match(urls[0], /^https:\/\/itunes\.apple\.com\/lookup\?/);
});

test('initialization falls back to current App Store structured metadata', async () => {
  const source = makeSource({ get: async url => url.includes('itunes.apple.com')
    ? { status: 503, body: '<html>Unavailable</html>' }
    : { status: 200, body: '<script type="application/ld+json">{"softwareVersion":"5.0.2"}</script>' }
  });
  await source.init();
  assert.equal(source.latestVersion, '5.0.2');
});

test('initialization retains support for the older App Store markup', async () => {
  const source = makeSource({ get: async url => url.includes('itunes.apple.com')
    ? json({ results: [] })
    : { status: 200, body: '<p class="whats-new__latest__version">Version 4.2.0</p>' }
  });
  await source.init();
  assert.equal(source.latestVersion, '4.2.0');
});

test('optional app-version requests do not prevent the source loading', async () => {
  const source = makeSource({ get: async () => { throw new Error('offline'); } });
  await source.init();
  assert.equal(source.latestVersion, '4.0.24');
});

test('an HTML authentication error reports HTTP status instead of a JSON syntax error', async () => {
  const source = makeSource({ post: async () => ({ status: 403, body: '<html>Forbidden</html>' }) });
  await assert.rejects(source.explore[0].load(), error => {
    assert.equal(error.name, 'Error');
    assert.match(error.message, /认证.*HTTP 403/);
    return true;
  });
  assert.equal(source.bearerToken, null);
  assert.equal(source.tokenExpiry, 0);
});

test('a successful HTTP response containing HTML has a useful authentication error', async () => {
  const source = makeSource({ post: async () => ({ status: 200, body: '<html>Challenge</html>' }) });
  await assert.rejects(source.explore[0].load(), /认证.*非 JSON/);
});

test('empty and malformed authentication bodies do not escape as SyntaxError', async () => {
  for (const body of ['', '{invalid']) {
    const source = makeSource({ post: async () => ({ status: 200, body }) });
    await assert.rejects(source.explore[0].load(), /认证.*非 JSON/);
  }
});

test('missing access tokens are rejected without poisoning authentication state', async () => {
  const source = makeSource({ post: async () => json({ error: 'unavailable' }) });
  await assert.rejects(source.explore[0].load(), /认证.*access_token/);
  assert.equal(source.bearerToken, null);
  assert.equal(source.tokenExpiry, 0);
});

test('a non-JSON GraphQL response identifies the failing home operation', async () => {
  const source = makeSource({ post: async url => url.endsWith('/access_token')
    ? json({ access_token: 'test-token', user_account_id: 'test-user' })
    : { status: 200, body: '<html>Challenge</html>' }
  });
  await assert.rejects(source.explore[0].load(), /HomeCacheable.*非 JSON/);
});

test('GraphQL errors are surfaced rather than mistaken for missing home sections', async () => {
  const source = makeSource({ post: async url => url.endsWith('/access_token')
    ? json({ access_token: 'test-token', user_account_id: 'test-user' })
    : json({ errors: [{ message: 'Unsupported client version' }] })
  });
  await assert.rejects(source.explore[0].load(), /Unsupported client version/);
});

test('authentication accepts a BOM-prefixed JSON response', async () => {
  const source = makeSource({ post: async () => ({
    status: 200, body: '\uFEFF {"access_token":"test-token","user_account_id":"test-user"} ',
  }) });
  await source.fetchBearerToken();
  assert.equal(source.bearerToken, 'test-token');
  assert.equal(source.userAccountId, 'test-user');
});

test('invalid JSON payload types cannot become authentication state', async () => {
  for (const value of [null, [], 'error', 123]) {
    const source = makeSource({ post: async () => json(value) });
    await assert.rejects(source.fetchBearerToken(), /认证.*无效的 JSON/);
    assert.equal(source.bearerToken, null);
  }
});

test('rent error handling still receives the structured GraphQL point error', async () => {
  const source = makeSource({ post: async () => json({
    errors: [{ message: 'Point unavailable', extensions: { code: 'FAILED_TO_USE_POINT' } }],
  }) });
  let renewals = 0;
  source.refreshAccount = async () => { renewals++; };
  await assert.rejects(source.rentChapter('episode', 1), /multiple attempts/);
  assert.equal(renewals, 4);
});

test('other rent errors are reported instead of returning false success', async () => {
  const source = makeSource({ post: async () => json({ errors: [{ message: 'Episode unavailable' }] }) });
  await assert.rejects(source.rentChapter('episode', 1), /Episode unavailable/);
});

test('home requests renew a rejected token once and return the ranking', async () => {
  let tokenRequests = 0;
  let graphqlRequests = 0;
  const source = makeSource({ post: async (url, headers) => {
    if (url.endsWith('/access_token')) {
      tokenRequests++;
      assert.equal(headers.Accept, 'application/json');
      return json({ access_token: `test-token-${tokenRequests}`, user_account_id: 'test-user' });
    }
    graphqlRequests++;
    if (graphqlRequests === 1) return { status: 401, body: '<html>Unauthorized</html>' };
    assert.equal(headers.Authorization, 'Bearer test-token-2');
    return json({ data: { homeSections: [{
      __typename: 'DailyRankingSection',
      dailyRankings: [{ ranking: { __typename: 'DailyRanking', items: { edges: [{ node: {
        __typename: 'DailyRankingValidItem', rank: 1, viewCount: 100,
        product: { series: { databaseId: '123', title: 'Example', squareThumbnailUriTemplate: 'https://example.com/{width}/{height}.jpg' } },
      }}] } } }],
    }] } });
  }});
  const result = await source.explore[0].load();
  assert.equal(tokenRequests, 2);
  assert.equal(graphqlRequests, 2);
  assert.equal(result['Daily Ranking'][0].id, '123');
  assert.equal(result['Daily Ranking'][0].cover, 'https://example.com/500/500.jpg');
});

test('persistent unauthorized responses stop after one token renewal', async () => {
  let graphqlRequests = 0;
  const source = makeSource({ post: async url => {
    if (url.endsWith('/access_token')) return json({ access_token: 'test-token' });
    graphqlRequests++;
    return { status: 401, body: 'Unauthorized' };
  }});
  await assert.rejects(source.explore[0].load(), /HomeCacheable.*HTTP 401/);
  assert.equal(graphqlRequests, 2);
});
