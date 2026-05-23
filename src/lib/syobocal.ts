export type SyobocalChannelGroup = {
	channelIds: number[];
	label: string;
	order: number;
	rawGroupIds: number[];
};

export type SyobocalChannel = {
	groupLabel: string | null;
	id: number;
	name: string;
	rawGroupId: number | null;
};

export type SyobocalScheduleItem = {
	category: number;
	channelGroupLabel: string | null;
	channelId: number;
	channelName: string;
	count: number | null;
	firstBroadcastAt: string | null;
	firstEndBroadcastAt: string | null;
	endAt: string;
	flag: number;
	programId: number;
	shortTitle: string | null;
	startAt: string;
	subtitle: string | null;
	title: string;
	titleEn: string | null;
	titleId: number;
	titleYomi: string | null;
	warn: number;
	comment: string | null;
};

export type SyobocalSchedule = {
	businessDate: string;
	channelGroups: SyobocalChannelGroup[];
	channels: SyobocalChannel[];
	items: SyobocalScheduleItem[];
	rangeEndAt: string;
	rangeStartAt: string;
};

type CachedChannelDirectory = {
	cachedAt: number;
	channelGroups: SyobocalChannelGroup[];
	channels: SyobocalChannel[];
};

type ChannelDirectoryData = {
	channelGroups: SyobocalChannelGroup[];
	channels: Map<number, SyobocalChannel>;
};

type SyobocalProgramResponse = {
	ChID?: string | null;
	ChName?: string | null;
	ConfFlag?: string | null;
	Count?: string | null;
	EdTime?: string | null;
	PID?: string | null;
	StTime?: string | null;
	SubTitle2?: string | null;
	TID?: string | null;
	ProgComment?: string | null;
};

type SyobocalResponse = {
	Programs?: Record<string, SyobocalProgramResponse>;
	Titles?: Record<string, SyobocalTitleResponse>;
};

type SyobocalTitle = {
	category: number;
	firstBroadcastAt: string | null;
	firstEndBroadcastAt: string | null;
	shortTitle: string | null;
	title: string;
	titleEn: string | null;
	titleId: number;
	titleYomi: string | null;
};

type SyobocalTitleResponse = {
	Cat?: string | null;
	FirstMonth?: string | null;
	FirstYear?: string | null;
	FirstEndMonth?: string | null;
	FirstEndYear?: string | null;
	ShortTitle?: string | null;
	TID?: string | null;
	Title?: string | null;
	TitleEN?: string | null;
	TitleYomi?: string | null;
};

const CHANNEL_DIRECTORY_CACHE_KEY = "tamate:syobocal-channel-directory:v1";
const CHANNEL_DIRECTORY_CACHE_TTL = 1000 * 60 * 60 * 24 * 31;
const SYOBOCAL_JSON_ENDPOINT = "/cal/json.php";
const SYOBOCAL_XML_ENDPOINT = "/cal/db.php";
const pendingScheduleRequests = new Map<string, Promise<SyobocalSchedule>>();

const TOKYO_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
	day: "2-digit",
	hour: "2-digit",
	hour12: false,
	minute: "2-digit",
	month: "2-digit",
	second: "2-digit",
	timeZone: "Asia/Tokyo",
	year: "numeric",
});

const normalizeText = (value: string | null | undefined) => {
	const trimmedValue = value?.trim();
	return trimmedValue ? trimmedValue : null;
};

const padNumber = (value: number) => value.toString().padStart(2, "0");

const parseNumber = (value: string | null | undefined) => {
	if (!value) {
		return null;
	}

	const parsedValue = Number.parseInt(value, 10);
	return Number.isFinite(parsedValue) ? parsedValue : null;
};

const readTagText = (element: Element, tagName: string) =>
	normalizeText(element.querySelector(tagName)?.textContent);

const shiftDateString = (dateString: string, deltaDays: number) => {
	const [year, month, day] = dateString
		.split("-")
		.map((value) => Number.parseInt(value, 10));
	const date = new Date(Date.UTC(year, month - 1, day));
	date.setUTCDate(date.getUTCDate() + deltaDays);

	return `${date.getUTCFullYear()}-${padNumber(date.getUTCMonth() + 1)}-${padNumber(
		date.getUTCDate(),
	)}`;
};

const getTokyoNowParts = (now = new Date()) => {
	const parts = TOKYO_DATE_TIME_FORMATTER.formatToParts(now);

	return {
		day: Number.parseInt(
			parts.find((part) => part.type === "day")?.value ?? "01",
			10,
		),
		hour: Number.parseInt(
			parts.find((part) => part.type === "hour")?.value ?? "00",
			10,
		),
		month: Number.parseInt(
			parts.find((part) => part.type === "month")?.value ?? "01",
			10,
		),
		year: Number.parseInt(
			parts.find((part) => part.type === "year")?.value ?? "1970",
			10,
		),
	};
};

const buildBusinessRange = (businessDate: string) => ({
	rangeEndAt: `${shiftDateString(businessDate, 1)} 04:00:00`,
	rangeStartAt: `${businessDate} 04:00:00`,
});

const buildFirstBroadcastAt = (title: SyobocalTitleResponse) => {
	const firstYear = parseNumber(title.FirstYear);
	const firstMonth = parseNumber(title.FirstMonth);

	if (!firstYear || !firstMonth || firstMonth < 1 || firstMonth > 12) {
		return null;
	}

	return `${firstYear}-${padNumber(firstMonth)}-01 00:00:00`;
};

const buildFirstEndBroadcastAt = (title: SyobocalTitleResponse) => {
	const endYear = parseNumber(title.FirstEndYear);
	const endMonth = parseNumber(title.FirstEndMonth);

	if (!endYear || !endMonth || endMonth < 1 || endMonth > 12) {
		return null;
	}

	return `${endYear}-${padNumber(endMonth)}-01 00:00:00`;
};

const formatTokyoDateTime = (date: Date) => {
	const parts = TOKYO_DATE_TIME_FORMATTER.formatToParts(date);
	const year = parts.find((part) => part.type === "year")?.value ?? "1970";
	const month = parts.find((part) => part.type === "month")?.value ?? "01";
	const day = parts.find((part) => part.type === "day")?.value ?? "01";
	const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
	const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
	const second = parts.find((part) => part.type === "second")?.value ?? "00";

	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const isSyobocalResponse = (value: unknown): value is SyobocalResponse =>
	typeof value === "object" && value !== null;

const buildTitleMap = (
	titles: Record<string, SyobocalTitleResponse> | undefined,
) => {
	const titleMap = new Map<number, SyobocalTitle>();

	for (const title of Object.values(titles ?? {})) {
		const titleId = parseNumber(title.TID);
		const titleName = normalizeText(title.Title);

		if (!titleId || !titleName) {
			continue;
		}

		titleMap.set(titleId, {
			category: parseNumber(title.Cat) ?? 0,
			firstBroadcastAt: buildFirstBroadcastAt(title),
			firstEndBroadcastAt: buildFirstEndBroadcastAt(title),
			shortTitle: normalizeText(title.ShortTitle),
			title: titleName,
			titleEn: normalizeText(title.TitleEN),
			titleId,
			titleYomi: normalizeText(title.TitleYomi),
		});
	}

	return titleMap;
};

const parseXml = (xmlText: string) => {
	const xml = new DOMParser().parseFromString(xmlText, "application/xml");
	if (xml.querySelector("parsererror")) {
		throw new Error("しょぼいカレンダーのレスポンスを解析できませんでした。");
	}

	const code = xml.querySelector("Result > Code")?.textContent?.trim();
	if (code && code !== "200") {
		const message =
			xml.querySelector("Result > Message")?.textContent?.trim() ??
			"しょぼいカレンダーへの問い合わせに失敗しました。";
		throw new Error(message);
	}

	return xml;
};

const fetchSyobocalJson = async (businessDate: string) => {
	const params = new URLSearchParams({
		Req: "ProgramByDate,TitleMedium",
		start: businessDate,
	});
	const response = await fetch(
		`${SYOBOCAL_JSON_ENDPOINT}?${params.toString()}`,
	);
	if (!response.ok) {
		throw new Error(
			`しょぼいカレンダーへの問い合わせに失敗しました (${response.status})。`,
		);
	}

	const json = (await response.json()) as unknown;
	if (!isSyobocalResponse(json)) {
		throw new Error("しょぼいカレンダーのレスポンスを解析できませんでした。");
	}

	return json;
};

const fetchSyobocalXml = async (params: URLSearchParams) => {
	const response = await fetch(`${SYOBOCAL_XML_ENDPOINT}?${params.toString()}`);
	if (!response.ok) {
		throw new Error(
			`しょぼいカレンダーへの問い合わせに失敗しました (${response.status})。`,
		);
	}

	return parseXml(await response.text());
};

const normalizeChannelGroupName = (value: string) =>
	value.replace(/^(テレビ|ラジオ)\s*/, "").trim();

const toChannelDirectoryData = (
	cached: CachedChannelDirectory,
): ChannelDirectoryData => ({
	channelGroups: cached.channelGroups,
	channels: new Map(cached.channels.map((channel) => [channel.id, channel])),
});

const readCachedChannelDirectory = () => {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const rawValue = window.localStorage.getItem(CHANNEL_DIRECTORY_CACHE_KEY);
		if (!rawValue) {
			return null;
		}

		const parsedValue = JSON.parse(rawValue) as Partial<CachedChannelDirectory>;
		if (
			typeof parsedValue !== "object" ||
			parsedValue === null ||
			typeof parsedValue.cachedAt !== "number" ||
			!Array.isArray(parsedValue.channelGroups) ||
			!Array.isArray(parsedValue.channels)
		) {
			return null;
		}

		const data = toChannelDirectoryData(parsedValue as CachedChannelDirectory);
		return {
			data,
			isFresh: Date.now() - parsedValue.cachedAt < CHANNEL_DIRECTORY_CACHE_TTL,
		};
	} catch {
		return null;
	}
};

const writeCachedChannelDirectory = (data: ChannelDirectoryData) => {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			CHANNEL_DIRECTORY_CACHE_KEY,
			JSON.stringify({
				cachedAt: Date.now(),
				channelGroups: data.channelGroups,
				channels: [...data.channels.values()],
			} satisfies CachedChannelDirectory),
		);
	} catch {
		// Ignore storage write failures.
	}
};

const fetchChannelDirectory = async (): Promise<ChannelDirectoryData> => {
	const cached = readCachedChannelDirectory();
	if (cached?.isFresh) {
		return cached.data;
	}

	try {
		const [groupXml, channelXml] = await Promise.all([
			fetchSyobocalXml(new URLSearchParams({ Command: "ChGroupLookup" })),
			fetchSyobocalXml(
				new URLSearchParams({
					Command: "ChLookup",
					Fields: "ChID,ChName,ChGID",
				}),
			),
		]);

		const rawGroupMap = new Map<number, { label: string; order: number }>();
		for (const element of Array.from(
			groupXml.querySelectorAll("ChGroupItem"),
		)) {
			const rawGroupId = parseNumber(readTagText(element, "ChGID"));
			const rawLabel = readTagText(element, "ChGroupName");
			if (!rawGroupId || !rawLabel) {
				continue;
			}

			rawGroupMap.set(rawGroupId, {
				label: rawLabel,
				order: parseNumber(readTagText(element, "ChGroupOrder")) ?? 9_999,
			});
		}

		const channelGroups = new Map<
			string,
			{
				channelIds: Set<number>;
				label: string;
				order: number;
				rawGroupIds: Set<number>;
			}
		>();
		const channels = new Map<number, SyobocalChannel>();

		for (const element of Array.from(channelXml.querySelectorAll("ChItem"))) {
			const channelId = parseNumber(readTagText(element, "ChID"));
			const channelName = readTagText(element, "ChName");
			if (!channelId || !channelName) {
				continue;
			}

			const rawGroupId = parseNumber(readTagText(element, "ChGID"));
			const rawGroup = rawGroupId ? rawGroupMap.get(rawGroupId) : undefined;
			const groupLabel = rawGroup
				? normalizeChannelGroupName(rawGroup.label)
				: null;

			channels.set(channelId, {
				groupLabel,
				id: channelId,
				name: channelName,
				rawGroupId: rawGroupId ?? null,
			});

			if (!groupLabel || !rawGroupId || !rawGroup) {
				continue;
			}

			const currentGroup = channelGroups.get(groupLabel) ?? {
				channelIds: new Set<number>(),
				label: groupLabel,
				order: rawGroup.order,
				rawGroupIds: new Set<number>(),
			};
			currentGroup.channelIds.add(channelId);
			currentGroup.rawGroupIds.add(rawGroupId);
			currentGroup.order = Math.min(currentGroup.order, rawGroup.order);
			channelGroups.set(groupLabel, currentGroup);
		}

		const data = {
			channelGroups: [...channelGroups.values()]
				.map((group) => ({
					channelIds: [...group.channelIds].sort((left, right) => left - right),
					label: group.label,
					order: group.order,
					rawGroupIds: [...group.rawGroupIds].sort(
						(left, right) => left - right,
					),
				}))
				.sort((left, right) => {
					if (left.order === right.order) {
						return left.label.localeCompare(right.label, "ja");
					}

					return left.order - right.order;
				}),
			channels,
		} satisfies ChannelDirectoryData;

		writeCachedChannelDirectory(data);
		return data;
	} catch (error) {
		if (cached) {
			return cached.data;
		}

		throw error;
	}
};

export const getInitialSyobocalDate = (now = new Date()) => {
	const today = getTokyoNowParts(now);
	const businessDate = `${today.year}-${padNumber(today.month)}-${padNumber(today.day)}`;
	return today.hour < 4 ? shiftDateString(businessDate, -1) : businessDate;
};

export const shiftSyobocalDate = (businessDate: string, deltaDays: number) =>
	shiftDateString(businessDate, deltaDays);

export const parseSyobocalDateTime = (value: string) =>
	new Date(`${value.replace(" ", "T")}+09:00`);

export const fetchSyobocalSchedule = async (
	businessDate: string,
): Promise<SyobocalSchedule> => {
	const pendingRequest = pendingScheduleRequests.get(businessDate);
	if (pendingRequest) {
		return pendingRequest;
	}

	const request = (async () => {
		const { rangeEndAt, rangeStartAt } = buildBusinessRange(businessDate);
		const rangeStart = parseSyobocalDateTime(rangeStartAt);
		const rangeEnd = parseSyobocalDateTime(rangeEndAt);
		const [response, channelDirectory] = await Promise.all([
			fetchSyobocalJson(businessDate),
			fetchChannelDirectory(),
		]);
		const titleMap = buildTitleMap(response.Titles);

		const items = Object.values(response.Programs ?? {})
			.map((program) => {
				const programId = parseNumber(program.PID);
				const titleId = parseNumber(program.TID);
				const channelId = parseNumber(program.ChID);
				const fallbackChannelName = normalizeText(program.ChName);
				const startUnix = parseNumber(program.StTime);
				const endUnix = parseNumber(program.EdTime);

				if (!programId || !titleId || !channelId || !startUnix || !endUnix) {
					return null;
				}

				const startAtDate = new Date(startUnix * 1000);
				const endAtDate = new Date(endUnix * 1000);
				if (!(endAtDate > rangeStart && startAtDate < rangeEnd)) {
					return null;
				}

				const title = titleMap.get(titleId);
				const channel = channelDirectory.channels.get(channelId);
				const channelName = channel?.name ?? fallbackChannelName;
				if (!channelName) {
					return null;
				}

				return {
					category: title?.category ?? 0,
					channelGroupLabel: channel?.groupLabel ?? null,
					channelId,
					channelName,
					count: parseNumber(program.Count),
					endAt: formatTokyoDateTime(endAtDate),
					flag: parseNumber(program.ConfFlag) ?? 0,
					firstBroadcastAt: title?.firstBroadcastAt ?? null,
					firstEndBroadcastAt: title?.firstEndBroadcastAt ?? null,
					programId,
					shortTitle: title?.shortTitle ?? null,
					startAt: formatTokyoDateTime(startAtDate),
					subtitle: normalizeText(program.SubTitle2),
					title: title?.title ?? `TID ${titleId}`,
					titleEn: title?.titleEn ?? null,
					titleId,
					titleYomi: title?.titleYomi ?? null,
					warn: 0,
					comment: program.ProgComment ?? null,
				} satisfies SyobocalScheduleItem;
			})
			.filter((item): item is SyobocalScheduleItem => item !== null)
			.sort((left, right) => {
				if (left.startAt === right.startAt) {
					return left.channelName.localeCompare(right.channelName, "ja");
				}

				return left.startAt.localeCompare(right.startAt);
			});

		const channelOrder = new Map<
			number,
			{
				groupLabel: string | null;
				name: string;
				rawGroupId: number | null;
				startAt: string;
			}
		>();
		for (const item of items) {
			if (!channelOrder.has(item.channelId)) {
				const channel = channelDirectory.channels.get(item.channelId);
				channelOrder.set(item.channelId, {
					groupLabel: item.channelGroupLabel,
					name: item.channelName,
					rawGroupId: channel?.rawGroupId ?? null,
					startAt: item.startAt,
				});
			}
		}

		const channels = [...channelOrder.entries()]
			.sort((left, right) => {
				if (left[1].startAt === right[1].startAt) {
					return left[1].name.localeCompare(right[1].name, "ja");
				}

				return left[1].startAt.localeCompare(right[1].startAt);
			})
			.map(([id, value]) => ({
				groupLabel: value.groupLabel,
				id,
				name: value.name,
				rawGroupId: value.rawGroupId,
			}));

		const currentChannelIds = new Set(channels.map((channel) => channel.id));
		const channelGroups = channelDirectory.channelGroups.filter((group) =>
			group.channelIds.some((channelId) => currentChannelIds.has(channelId)),
		);

		return {
			businessDate,
			channelGroups,
			channels,
			items,
			rangeEndAt,
			rangeStartAt,
		};
	})();

	pendingScheduleRequests.set(businessDate, request);

	try {
		return await request;
	} finally {
		pendingScheduleRequests.delete(businessDate);
	}
};
