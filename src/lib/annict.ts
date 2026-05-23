export type AnnictStatusState =
	| "NO_STATE"
	| "WANNA_WATCH"
	| "WATCHING"
	| "WATCHED"
	| "ON_HOLD"
	| "STOP_WATCHING";

export type AnnictRatingState = "BAD" | "AVERAGE" | "GOOD" | "GREAT";
export type AnnictSeasonName = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";

export const STATUS_OPTIONS: Array<{
	label: string;
	value: AnnictStatusState;
}> = [
	{ label: "未選択", value: "NO_STATE" },
	{ label: "見たい", value: "WANNA_WATCH" },
	{ label: "見てる", value: "WATCHING" },
	{ label: "見た", value: "WATCHED" },
	{ label: "一時中断", value: "ON_HOLD" },
	{ label: "視聴中止", value: "STOP_WATCHING" },
];

export const RATING_OPTIONS: Array<{
	label: string;
	value: AnnictRatingState;
	color: string;
}> = [
	{ label: "良くない", value: "BAD", color: "bg-gray-400" },
	{ label: "普通", value: "AVERAGE", color: "bg-orange-400" },
	{ label: "良い", value: "GOOD", color: "bg-green-400" },
	{ label: "とても良い", value: "GREAT", color: "bg-blue-400" },
];

export const SEASON_LABELS: Record<AnnictSeasonName, string> = {
	AUTUMN: "秋",
	SPRING: "春",
	SUMMER: "夏",
	WINTER: "冬",
};

export type AnnictViewer = {
	avatarUrl: string | null;
	name: string;
	username: string;
};

export type AnnictSearchWork = {
	annictId: number;
	imageUrl: string | null;
	title: string;
};

export type AnnictEpisode = {
	annictId: number;
	id: string;
	number: number | null;
	numberText: string | null;
	title: string | null;
	viewerDidTrack: boolean;
	viewerRecordsCount: number;
};

export type AnnictWork = {
	annictId: number;
	episodes: AnnictEpisode[];
	id: string;
	imageUrl: string | null;
	media: string | null;
	officialSiteUrl: string | null;
	seasonName: AnnictSeasonName | null;
	seasonYear: number | null;
	seriesList: string[];
	title: string;
	titleKana: string | null;
	twitterHashtag: string | null;
	twitterUsername: string | null;
	viewerStatusState: AnnictStatusState;
};

type GraphQLResponse<TData> = {
	data?: TData;
	errors?: Array<{ message: string }>;
};

type Nullable<TValue> = TValue | null | undefined;

const ANNICT_GRAPHQL_ENDPOINT = "https://api.annict.com/graphql";

export class AnnictApiError extends Error {
	readonly status?: number;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "AnnictApiError";
		this.status = status;
	}
}

const compact = <TValue>(values: Array<Nullable<TValue>> | null | undefined) =>
	(values ?? []).filter((value): value is TValue => value != null);

const normalizeOptionalString = (value: Nullable<string>) => {
	const trimmedValue = value?.trim();
	return trimmedValue ? trimmedValue : null;
};

const requestAnnictGraphQL = async <TData>(
	accessToken: string,
	query: string,
	variables: Record<string, unknown>,
) => {
	const response = await fetch(ANNICT_GRAPHQL_ENDPOINT, {
		body: JSON.stringify({ query, variables }),
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});

	if (!response.ok) {
		throw new AnnictApiError(
			`Annict API request failed with status ${response.status}.`,
			response.status,
		);
	}

	const payload = (await response.json()) as GraphQLResponse<TData>;
	if (payload.errors?.length) {
		const message = payload.errors.map((error) => error.message).join("\n");
		throw new AnnictApiError(
			message,
			/not authorized/i.test(message) ? 401 : response.status,
		);
	}

	if (!payload.data) {
		throw new AnnictApiError("Annict API returned no data.", response.status);
	}

	return payload.data;
};

export const buildAnnictAuthorizationUrl = () => {
	const clientId = import.meta.env.VITE_ANNICT_CLIENT_ID?.trim();
	if (!clientId || typeof window === "undefined") {
		return null;
	}

	const url = new URL("https://api.annict.com/oauth/authorize");
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set(
		"redirect_uri",
		`${window.location.origin}/.netlify/functions/annict-callback`,
	);
	return url.toString();
};

export const fetchAnnictViewer = async (accessToken: string) => {
	const data = await requestAnnictGraphQL<{
		viewer: Nullable<AnnictViewer>;
	}>(
		accessToken,
		`query Viewer {
			viewer {
				avatarUrl
				name
				username
			}
		}`,
		{},
	);

	if (!data.viewer) {
		throw new AnnictApiError("Annict viewer profile is unavailable.");
	}

	return data.viewer;
};

export const searchWorksByTitle = async (accessToken: string, term: string) => {
	if (term.trim().length < 2) {
		return [];
	}

	const data = await requestAnnictGraphQL<{
		searchWorks: {
			nodes: Array<
				Nullable<{
					annictId: number;
					image: Nullable<{ recommendedImageUrl: Nullable<string> }>;
					title: string;
				}>
			>;
		};
	}>(
		accessToken,
		`query SearchWorks($term: String!) {
			searchWorks(titles: [$term], first: 12) {
				nodes {
					annictId
					title
					image {
						recommendedImageUrl
					}
				}
			}
		}`,
		{ term },
	);

	return compact(data.searchWorks.nodes).map((work) => ({
		annictId: work.annictId,
		imageUrl: normalizeOptionalString(work.image?.recommendedImageUrl),
		title: work.title,
	}));
};

export const fetchWorkByAnnictId = async (
	accessToken: string,
	annictId: number,
) => {
	const data = await requestAnnictGraphQL<{
		searchWorks: {
			nodes: Array<
				Nullable<{
					annictId: number;
					episodes: Nullable<{
						nodes: Array<
							Nullable<{
								annictId: number;
								id: string;
								number: Nullable<number>;
								numberText: Nullable<string>;
								title: Nullable<string>;
								viewerDidTrack: boolean;
								viewerRecordsCount: number;
							}>
						>;
					}>;
					id: string;
					image: Nullable<{ recommendedImageUrl: Nullable<string> }>;
					media: Nullable<string>;
					officialSiteUrl: Nullable<string>;
					seasonName: Nullable<AnnictSeasonName>;
					seasonYear: Nullable<number>;
					seriesList: Nullable<{
						nodes: Array<Nullable<{ name: Nullable<string> }>>;
					}>;
					title: string;
					titleKana: Nullable<string>;
					twitterHashtag: Nullable<string>;
					twitterUsername: Nullable<string>;
					viewerStatusState: Nullable<AnnictStatusState>;
				}>
			>;
		};
	}>(
		accessToken,
		`query Work($annictId: Int!) {
			searchWorks(annictIds: [$annictId], first: 1) {
				nodes {
					annictId
					id
					title
					titleKana
					media
					twitterUsername
					twitterHashtag
					officialSiteUrl
					seasonName
					seasonYear
					image {
						recommendedImageUrl
					}
					viewerStatusState
					seriesList {
						nodes {
							name
						}
					}
					episodes(orderBy: { field: SORT_NUMBER, direction: ASC }, first: 100) {
						nodes {
							annictId
							id
							number
							numberText
							title
							viewerDidTrack
							viewerRecordsCount
						}
					}
				}
			}
		}`,
		{ annictId },
	);

	const work = compact(data.searchWorks.nodes)[0];
	if (!work) {
		return null;
	}

	return {
		annictId: work.annictId,
		episodes: compact(work.episodes?.nodes).map((episode) => ({
			annictId: episode.annictId,
			id: episode.id,
			number: episode.number ?? null,
			numberText: episode.numberText ?? null,
			title: episode.title ?? null,
			viewerDidTrack: episode.viewerDidTrack,
			viewerRecordsCount: episode.viewerRecordsCount,
		})),
		id: work.id,
		imageUrl: normalizeOptionalString(work.image?.recommendedImageUrl),
		media: work.media ?? null,
		officialSiteUrl: work.officialSiteUrl ?? null,
		seasonName: work.seasonName ?? null,
		seasonYear: work.seasonYear ?? null,
		seriesList: compact(work.seriesList?.nodes)
			.map((series) => series.name ?? null)
			.filter((seriesName): seriesName is string => Boolean(seriesName)),
		title: work.title,
		titleKana: work.titleKana ?? null,
		twitterHashtag: work.twitterHashtag ?? null,
		twitterUsername: work.twitterUsername ?? null,
		viewerStatusState: work.viewerStatusState ?? "NO_STATE",
	} satisfies AnnictWork;
};

export const updateAnnictWorkStatus = async (
	accessToken: string,
	workId: string,
	state: AnnictStatusState,
) => {
	await requestAnnictGraphQL(
		accessToken,
		`mutation UpdateWorkStatus($workId: ID!, $state: StatusState!) {
			updateStatus(input: {
				clientMutationId: "tamate",
				state: $state,
				workId: $workId
			}) {
				clientMutationId
			}
		}`,
		{ state, workId },
	);
};

export const createAnnictRecord = async (
	accessToken: string,
	params: {
		comment: string | null;
		episodeId: string;
		ratingState: AnnictRatingState | null;
		shareFacebook: boolean;
		shareTwitter?: boolean;
	},
) => {
	params.shareTwitter = false;
	await requestAnnictGraphQL(
		accessToken,
		`mutation CreateRecord(
			$comment: String
			$episodeId: ID!
			$ratingState: RatingState
			$shareFacebook: Boolean
			$shareTwitter: Boolean
		) {
			createRecord(input: {
				clientMutationId: "tamate",
				comment: $comment,
				episodeId: $episodeId,
				ratingState: $ratingState,
				shareFacebook: $shareFacebook,
				shareTwitter: $shareTwitter
			}) {
				clientMutationId
			}
		}`,
		params,
	);
};
