import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchWorkByAnnictId } from "../src/lib/annict.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

for (const syobocalTid of [1234, null]) {
	test(`作品詳細としょぼかるID ${syobocalTid} をGraphQLだけで取得する`, async () => {
		const requests = [];
		globalThis.fetch = async (url, options) => {
			requests.push(String(url));
			assert.equal(String(url), "https://api.annict.com/graphql");
			assert.match(JSON.parse(options.body).query, /\bsyobocalTid\b/);
			return new Response(
				JSON.stringify({
					data: {
						searchWorks: {
							nodes: [
								{
									annictId: 1,
									id: "work-1",
									title: "作品",
									episodesCount: 0,
									syobocalTid,
									episodes: { nodes: [] },
								},
							],
						},
					},
				}),
			);
		};
		const result = await fetchWorkByAnnictId("test-token", 1);
		assert.equal(result.syobocalTid, syobocalTid);
		assert.equal(requests.length, 1);
	});
}

test("作品詳細は100話ずつカーソルで続きまで取得する", async () => {
	const episodes = Array.from({ length: 178 }, (_, index) => ({
		annictId: index + 1,
		id: `episode-${index + 1}`,
		number: index + 1,
		viewerDidTrack: index < 120,
		viewerRecordsCount: index < 120 ? 1 : 0,
	}));
	const cursors = [];
	globalThis.fetch = async (_url, options) => {
		const { query, variables } = JSON.parse(options.body);
		assert.match(
			query,
			/episodes\(first: 100, after: \$after, orderBy: \{ field: SORT_NUMBER, direction: ASC \}\)/,
		);
		assert.match(query, /pageInfo\s*\{ hasNextPage endCursor \}/);
		cursors.push(variables.after);
		const offset = variables.after === null ? 0 : 100;
		return new Response(
			JSON.stringify({
				data: {
					searchWorks: {
						nodes: [
							{
								annictId: 1,
								id: "work-1",
								title: "作品",
								episodesCount: 178,
								episodes: {
									nodes: episodes.slice(offset, offset + 100),
									pageInfo: {
										hasNextPage: offset === 0,
										endCursor: offset === 0 ? "cursor-100" : "cursor-178",
									},
								},
							},
						],
					},
				},
			}),
		);
	};
	const first = await fetchWorkByAnnictId("test-token", 1);
	assert.equal(first.episodes.length, 100);
	assert.equal(first.episodesPageInfo.hasNextPage, true);
	const next = await fetchWorkByAnnictId(
		"test-token",
		1,
		first.episodesPageInfo.endCursor,
	);
	assert.equal(next.episodes.length, 78);
	assert.equal(next.episodes[0].number, 101);
	assert.equal(next.episodes.at(-1).number, 178);
	assert.equal(next.episodesPageInfo.hasNextPage, false);
	assert.deepEqual(cursors, [null, "cursor-100"]);
	assert.equal(
		[...first.episodes, ...next.episodes].filter(
			(episode) => episode.viewerDidTrack,
		).length,
		120,
	);
});
