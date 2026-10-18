import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchWatchingWorks } from "../src/lib/annict.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const pageInfo = (endCursor = null) => ({
	hasNextPage: endCursor !== null,
	endCursor,
});
const episodes = (tracked) => ({
	nodes: tracked.map((viewerDidTrack) => ({ viewerDidTrack })),
});
const work = (annictId, progress = episodes([true, false, true])) => ({
	annictId,
	title: `作品${annictId}`,
	titleKana: "さくひん",
	episodesCount: 178,
	seasonName: "SPRING",
	seasonYear: 2026,
	syobocalTid: 123,
	episodes: progress,
});
const watchingPage = (nodes, cursor = null) => ({
	viewer: { works: { nodes, pageInfo: pageInfo(cursor) } },
});
const respond = (data) => new Response(JSON.stringify({ data }));

test("一覧と進捗を同じGraphQLリクエストで取得する", async () => {
	const requests = [];
	globalThis.fetch = async (url, options) => {
		assert.equal(String(url), "https://api.annict.com/graphql");
		requests.push(JSON.parse(options.body));
		return respond(watchingPage([work(1), null, work(2)]));
	};
	const result = await fetchWatchingWorks("test-token");
	assert.equal(requests.length, 1);
	assert.match(requests[0].query, /state: WATCHING/);
	assert.deepEqual(
		result.map((w) => [w.annictId, w.watchedEpisodeCount]),
		[
			[1, 2],
			[2, 2],
		],
	);
	assert.equal(result[0].seasonName, "2026-spring");
	assert.equal(result[0].syobocalTid, 123);
});

test("100話を超える作品も一括取得し、作品一覧だけページングする", async () => {
	const requests = [];
	globalThis.fetch = async (_url, options) => {
		const request = JSON.parse(options.body);
		requests.push(request);
		assert.doesNotMatch(request.query, /episodes\s*\(/);
		return respond(
			request.variables.after
				? watchingPage([work(2)])
				: watchingPage(
						[work(1, episodes(Array(178).fill(true)))],
						"works-next",
					),
		);
	};
	const result = await fetchWatchingWorks("test-token");
	assert.equal(requests.length, 2);
	assert.deepEqual(
		result.map((w) => [w.annictId, w.watchedEpisodeCount]),
		[
			[1, 178],
			[2, 2],
		],
	);
	assert.ok(requests.some((r) => r.variables.after === "works-next"));
});

test("見てる作品がないときは空配列を返す", async () => {
	globalThis.fetch = async () => respond(watchingPage([]));
	assert.deepEqual(await fetchWatchingWorks("test-token"), []);
});

test("進捗取得が失敗したときに0話の一覧を返さない", async () => {
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ errors: [{ message: "failure" }] }));
	await assert.rejects(fetchWatchingWorks("test-token"), /failure/);
});
