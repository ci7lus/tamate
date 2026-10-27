import { Interweave } from "interweave";
import { Url, UrlMatcher } from "interweave-autolink";
import { startTransition, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import useSWR from "swr";

import { type AnnictWatchingWork, fetchWatchingWorks } from "../lib/annict";
import { serializeCalendarPlaceholderShape } from "../lib/calendarPlaceholder";
import { getErrorMessage } from "../lib/errors";
import { writeStorage } from "../lib/storage";
import {
	fetchSyobocalSchedule,
	getInitialSyobocalDate,
	parseSyobocalDateTime,
	type SyobocalScheduleItem,
	shiftSyobocalDate,
} from "../lib/syobocal";
import {
	readWatchingWorksPlaceholderCounts,
	serializeWatchingWorksPlaceholderCounts,
} from "../lib/watchingWorksPlaceholder";
import { readWorkMappings } from "../lib/workMappings";
import { CALENDAR_TIME_RAIL_WIDTH, STORAGE_KEYS } from "../shared/constants";
import { useAnnictSession } from "./AnnictSessionProvider";
import { CalendarPlaceholder } from "./CalendarPlaceholder";
import { WatchingWorksPlaceholder } from "./WatchingWorksPlaceholder";
import { WorkMappingModal } from "./WorkMappingModal";

const HOUR_HEIGHT = 144;
const MIN_EMPTY_HOUR_HEIGHT = HOUR_HEIGHT * 0.25;
const HALF_HOUR_MS = 30 * 60_000;
const SEASON_START_MONTH: Record<string, number> = {
	winter: 0,
	spring: 3,
	summer: 6,
	autumn: 9,
};

const getBroadcastDate = (work: AnnictWatchingWork) => {
	const season = work.seasonName?.match(
		/^(\d{4})-(winter|spring|summer|autumn)$/i,
	);
	if (!season) {
		return null;
	}

	return Date.UTC(
		Number(season[1]),
		SEASON_START_MONTH[season[2].toLowerCase()],
		1,
	);
};

const compareWatchingWorksByBroadcastDate = (
	first: AnnictWatchingWork | undefined,
	second: AnnictWatchingWork | undefined,
) => {
	if (!first) {
		return second ? 1 : 0;
	}
	if (!second) {
		return -1;
	}

	const firstDate = getBroadcastDate(first);
	const secondDate = getBroadcastDate(second);
	if (firstDate == null) {
		return secondDate == null
			? first.title.localeCompare(second.title, "ja")
			: 1;
	}
	if (secondDate == null) {
		return -1;
	}
	return (
		secondDate - firstDate || first.title.localeCompare(second.title, "ja")
	);
};

type TimedScheduleItem = {
	endAt: Date;
	item: SyobocalScheduleItem;
	startAt: Date;
};

type TimelineCluster = {
	endAt: Date;
	height: number;
	pixelsPerHour: number;
	startAt: Date;
	top: number;
};

type TimelineLayoutItem = {
	columnCount: number;
	columnIndex: number;
	height: number;
	item: SyobocalScheduleItem;
	top: number;
};

type TimelineMarker = {
	label: string | null;
	top: number;
	tone: "hour" | "halfHour";
};

type ProgramActionModalState = {
	annictId: number | null;
	item: SyobocalScheduleItem;
};

const CATEGORY_OPTIONS = [
	{ label: "アニメ", value: 1 },
	{ label: "アニメ(終了/再放送)", value: 10 },
	{ label: "OVA", value: 7 },
	{ label: "アニメ関連", value: 5 },
	{ label: "特撮", value: 4 },
	{ label: "映画", value: 8 },
	{ label: "テレビ", value: 3 },
	{ label: "ラジオ", value: 2 },
	{ label: "メモ", value: 6 },
	{ label: "その他", value: 0 },
] as const;

const DEFAULT_SELECTED_CATEGORIES = CATEGORY_OPTIONS.filter(
	(option) => option.value !== 10,
).map((option) => option.value);

const DEFAULT_VISIBLE_CHANNEL_GROUPS = [
	"全国",
	"関東",
	"BSデジタル",
	"スカパー",
	"インターネット",
	"AbemaTV",
] as const;

const FILTER_STORAGE_KEY = "tamate:schedule-filters:v1";
const RECENT_FIRST_BROADCAST_MONTHS = 12;

type StoredFilters = {
	categories: number[];
	channelGroups: string[];
	mayRebroadcastHidden: boolean;
};

const buildDefaultFilters = (): StoredFilters => ({
	categories: DEFAULT_SELECTED_CATEGORIES,
	channelGroups: [...DEFAULT_VISIBLE_CHANNEL_GROUPS],
	mayRebroadcastHidden: true,
});

const readStoredFilters = () => {
	if (typeof window === "undefined") {
		return buildDefaultFilters();
	}

	try {
		const rawValue = window.localStorage.getItem(FILTER_STORAGE_KEY);
		if (!rawValue) {
			return buildDefaultFilters();
		}

		const parsedValue = JSON.parse(rawValue) as Partial<StoredFilters>;
		const defaultFilters = buildDefaultFilters();

		return {
			categories:
				parsedValue.categories?.filter((value) => typeof value === "number") ??
				defaultFilters.categories,
			channelGroups:
				parsedValue.channelGroups?.filter(
					(value) => typeof value === "string",
				) ?? defaultFilters.channelGroups,
			mayRebroadcastHidden:
				typeof parsedValue.mayRebroadcastHidden === "boolean"
					? parsedValue.mayRebroadcastHidden
					: defaultFilters.mayRebroadcastHidden,
		};
	} catch {
		return buildDefaultFilters();
	}
};

const formatClockFromDate = (value: Date) =>
	new Intl.DateTimeFormat("ja-JP", {
		hour: "2-digit",
		hour12: false,
		minute: "2-digit",
		timeZone: "Asia/Tokyo",
	}).format(value);

const formatClock = (value: string) =>
	formatClockFromDate(parseSyobocalDateTime(value));

const formatMinute = (value: string) => formatClock(value).slice(3, 5);

const formatTimelineMarker = (
	value: Date,
): Pick<TimelineMarker, "label" | "tone"> => {
	const clock = formatClockFromDate(value);
	const minute = clock.slice(3, 5);
	const isHalfHour = minute === "30";
	return {
		label: isHalfHour ? null : String(Number(clock.slice(0, 2))),
		tone: isHalfHour ? "halfHour" : "hour",
	};
};

const getRecentFirstBroadcastCutoff = (businessDate: string) => {
	const cutoff = parseSyobocalDateTime(`${businessDate} 00:00:00`);
	cutoff.setMonth(cutoff.getMonth() - RECENT_FIRST_BROADCAST_MONTHS);
	return cutoff;
};

const diffMinutes = (startAt: Date, endAt: Date) =>
	Math.round((endAt.getTime() - startAt.getTime()) / 60_000);

const getProgramDurationMinutes = (item: SyobocalScheduleItem) =>
	diffMinutes(
		parseSyobocalDateTime(item.startAt),
		parseSyobocalDateTime(item.endAt),
	);

const formatDuration = (durationMinutes: number) => {
	const hours = Math.floor(durationMinutes / 60);
	const minutes = durationMinutes % 60;

	if (hours === 0) {
		return `${minutes}分`;
	}

	return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
};

const buildProgramSummary = (item: SyobocalScheduleItem) => {
	const parts: string[] = [];

	if (item.count) {
		parts.push(`#${item.count}`);
	}

	if (item.subtitle) {
		parts.push(item.subtitle);
	}

	if (item.comment) {
		parts.push(item.comment);
	}

	return parts.join(" ");
};

const isFirstRunBatch = (item: SyobocalScheduleItem) =>
	item.comment?.includes("初回") === true ||
	item.subtitle?.includes("初回") === true;

const getCategorySurfaceStyle = (category: number) => {
	switch (category) {
		case 1:
		case 10:
			return { backgroundColor: "#fff7b8", borderColor: "#d6bc55" };
		case 5:
			return { backgroundColor: "#ffe8d9", borderColor: "#fb923c" };
		case 7:
			return { backgroundColor: "#ecfccb", borderColor: "#84cc16" };
		case 4:
			return { backgroundColor: "#fed7aa", borderColor: "#f97316" };
		case 8:
			return { backgroundColor: "#dcfce7", borderColor: "#4ade80" };
		case 3:
			return { backgroundColor: "#dbeafe", borderColor: "#60a5fa" };
		case 2:
			return { backgroundColor: "#ede9fe", borderColor: "#a78bfa" };
		case 6:
			return { backgroundColor: "#f5f3ff", borderColor: "#c4b5fd" };
		default:
			return { backgroundColor: "#f3f4f6", borderColor: "#9ca3af" };
	}
};

const mergeSimulcastItems = (items: SyobocalScheduleItem[]) => {
	const groupedItems = new Map<string, SyobocalScheduleItem[]>();

	for (const item of items) {
		const mergeKey = [
			item.titleId,
			item.count ?? "",
			item.startAt,
			item.endAt,
		].join("\u0000");
		const currentItems = groupedItems.get(mergeKey);
		if (currentItems) {
			currentItems.push(item);
			continue;
		}

		groupedItems.set(mergeKey, [item]);
	}

	return [...groupedItems.values()]
		.map((group) => {
			if (group.length === 1) {
				return group[0];
			}

			const [baseItem] = group;
			const channelNames = [
				...new Set(group.map((item) => item.channelName)),
			].sort((left, right) => left.localeCompare(right, "ja"));
			const channelGroupLabels = [
				...new Set(
					group
						.map((item) => item.channelGroupLabel)
						.filter((label): label is string => label !== null),
				),
			].sort((left, right) => left.localeCompare(right, "ja"));

			return {
				...baseItem,
				channelGroupLabel:
					channelGroupLabels.length === 1 ? channelGroupLabels[0] : null,
				channelName: channelNames.join(" / "),
			};
		})
		.sort((left, right) => {
			if (left.startAt === right.startAt) {
				return left.channelName.localeCompare(right.channelName, "ja");
			}

			return left.startAt.localeCompare(right.startAt);
		});
};

const buildTimelineLayout = (
	items: SyobocalScheduleItem[],
	_rangeStartAt?: string,
	rangeEndAt?: string,
) => {
	const timelineItems: TimedScheduleItem[] = items
		.map((item) => ({
			endAt: parseSyobocalDateTime(item.endAt),
			item,
			startAt: parseSyobocalDateTime(item.startAt),
		}))
		.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
	const timelineStart = timelineItems[0]?.startAt;
	const timelineEnd = rangeEndAt
		? parseSyobocalDateTime(rangeEndAt)
		: timelineItems.at(-1)?.endAt;

	const clusters: TimedScheduleItem[][] = [];
	let currentCluster: TimedScheduleItem[] = [];
	let currentClusterEnd: Date | null = null;

	for (const timelineItem of timelineItems) {
		if (
			currentCluster.length === 0 ||
			(currentClusterEnd && timelineItem.startAt < currentClusterEnd)
		) {
			currentCluster.push(timelineItem);
			if (!currentClusterEnd || timelineItem.endAt > currentClusterEnd) {
				currentClusterEnd = timelineItem.endAt;
			}
			continue;
		}

		clusters.push(currentCluster);
		currentCluster = [timelineItem];
		currentClusterEnd = timelineItem.endAt;
	}

	if (currentCluster.length > 0) {
		clusters.push(currentCluster);
	}

	const positionedItems: TimelineLayoutItem[] = [];
	const positionedClusters: TimelineCluster[] = [];
	let top = 0;
	let previousBoundary = timelineStart ?? null;

	for (const cluster of clusters) {
		const clusterStart = cluster[0]?.startAt;
		if (!clusterStart) {
			continue;
		}

		if (previousBoundary && clusterStart > previousBoundary) {
			top +=
				(diffMinutes(previousBoundary, clusterStart) / 60) *
				MIN_EMPTY_HOUR_HEIGHT;
		}

		const clusterEnd = cluster.reduce(
			(currentEnd, timelineItem) =>
				timelineItem.endAt > currentEnd ? timelineItem.endAt : currentEnd,
			clusterStart,
		);

		const columnEnds: Date[] = [];
		const assignments = cluster.map((timelineItem) => {
			const reusableIndex = columnEnds.findIndex(
				(columnEnd) => timelineItem.startAt >= columnEnd,
			);

			if (reusableIndex >= 0) {
				columnEnds[reusableIndex] = timelineItem.endAt;
				return { columnIndex: reusableIndex, timelineItem };
			}

			columnEnds.push(timelineItem.endAt);
			return {
				columnIndex: columnEnds.length - 1,
				timelineItem,
			};
		});

		const pixelsPerHour = HOUR_HEIGHT;
		const clusterHeight =
			(diffMinutes(clusterStart, clusterEnd) / 60) * pixelsPerHour;
		const columnCount = Math.max(columnEnds.length, 1);

		for (const assignment of assignments) {
			const itemDurationMinutes = diffMinutes(
				assignment.timelineItem.startAt,
				assignment.timelineItem.endAt,
			);

			positionedItems.push({
				columnCount,
				columnIndex: assignment.columnIndex,
				height: (itemDurationMinutes / 60) * pixelsPerHour,
				item: assignment.timelineItem.item,
				top:
					top +
					(diffMinutes(clusterStart, assignment.timelineItem.startAt) / 60) *
						pixelsPerHour,
			});
		}

		positionedClusters.push({
			endAt: clusterEnd,
			height: clusterHeight,
			pixelsPerHour,
			startAt: clusterStart,
			top,
		});
		top += clusterHeight;
		previousBoundary = clusterEnd;
	}

	if (previousBoundary && timelineEnd && timelineEnd > previousBoundary) {
		top +=
			(diffMinutes(previousBoundary, timelineEnd) / 60) * MIN_EMPTY_HOUR_HEIGHT;
	}

	const markers: TimelineMarker[] = [];
	const firstProgramStart = timelineItems[0]?.startAt;
	if (firstProgramStart && positionedClusters.length > 0) {
		const lastClusterEnd =
			positionedClusters[positionedClusters.length - 1].endAt;
		let currentTime = new Date(
			Math.ceil(firstProgramStart.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS,
		);
		while (currentTime <= lastClusterEnd) {
			for (const cluster of positionedClusters) {
				if (currentTime >= cluster.startAt && currentTime <= cluster.endAt) {
					const markerTop =
						cluster.top +
						(diffMinutes(cluster.startAt, currentTime) / 60) *
							cluster.pixelsPerHour;
					markers.push({
						...formatTimelineMarker(currentTime),
						top: markerTop,
					});
					break;
				}
			}

			currentTime = new Date(currentTime.getTime() + HALF_HOUR_MS);
		}
	}

	return {
		clusters: positionedClusters,
		markers,
		positionedItems,
		totalColumns: Math.max(
			1,
			...positionedItems.map((positionedItem) => positionedItem.columnCount),
		),
		totalHeight: Math.max(top, 280),
	};
};

function ScheduleCard({
	isWatching,
	item,
	onOpenDetails,
	position,
}: {
	isWatching: AnnictWatchingWork | null;
	item: SyobocalScheduleItem;
	onOpenDetails: () => void;
	position: TimelineLayoutItem;
}) {
	const [isHovered, setIsHovered] = useState(false);
	const isCompact = position.height < 56;
	const isVeryCompact = position.height < 22;
	const left = `${(position.columnIndex / position.columnCount) * 100}%`;
	const baseSurfaceStyle = getCategorySurfaceStyle(item.category);
	const surfaceStyle =
		item.warn > 0
			? { ...baseSurfaceStyle, borderColor: "#38bdf8" }
			: baseSurfaceStyle;
	const bgColor = surfaceStyle.backgroundColor;
	const durationMinutes = getProgramDurationMinutes(item);
	const durationLabel = `(${formatDuration(durationMinutes)})`;
	const accessibleLabel = [
		`${formatClock(item.startAt)} - ${formatClock(item.endAt)} ${durationLabel}`,
		item.title,
		item.channelName,
		isWatching ? "視聴中" : null,
	]
		.filter((value): value is string => value !== null)
		.join(" / ");
	const hoverBgColor = (() => {
		const r = parseInt(bgColor.slice(1, 3), 16);
		const g = parseInt(bgColor.slice(3, 5), 16);
		const b = parseInt(bgColor.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, 0.95)`;
	})();

	return (
		<button
			aria-label={accessibleLabel}
			className="absolute z-0 overflow-hidden rounded-sm border p-0.5 text-left transition"
			onClick={onOpenDetails}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			title={accessibleLabel}
			style={{
				height: position.height,
				left,
				top: position.top,
				width: `${100 / position.columnCount}%`,
				...surfaceStyle,
				borderLeft: isWatching ? "3px solid #fb923c" : undefined,
				backgroundColor: isHovered ? hoverBgColor : bgColor,
			}}
			type="button"
		>
			{!isVeryCompact ? (
				<div className="overflow-hidden whitespace-nowrap text-[9px] font-semibold leading-[9px] text-gray-700">
					<p className="overflow-hidden text-ellipsis whitespace-nowrap">
						{formatMinute(item.startAt)} {durationLabel}
					</p>
				</div>
			) : null}
			<div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-semibold leading-[11px] text-gray-950">
				{item.shortTitle ?? item.title}
			</div>
			{!isVeryCompact ? (
				<div className="overflow-hidden text-ellipsis whitespace-nowrap text-[8px] leading-[9px] text-sky-700">
					{item.channelName}
				</div>
			) : null}
			{!isCompact ? (
				<div className="line-clamp-1 overflow-hidden text-[9px] leading-[10px] text-gray-600">
					{buildProgramSummary(item)}
				</div>
			) : null}
		</button>
	);
}

function ProgramActionModal({
	annictId,
	isLoggedIn,
	item,
	onClose,
	onOpenSearch,
}: {
	annictId: number | null;
	isLoggedIn: boolean;
	item: SyobocalScheduleItem;
	onClose: () => void;
	onOpenSearch: (item: SyobocalScheduleItem) => void;
}) {
	const [entered, setEntered] = useState(false);

	useEffect(() => {
		const id = requestAnimationFrame(() => setEntered(true));
		return () => cancelAnimationFrame(id);
	}, []);

	return (
		<div className="fixed inset-0 z-50 grid place-items-end p-3 md:place-items-center">
			<button
				aria-label="モーダルを閉じる"
				className={`absolute inset-0 cursor-default transition-opacity duration-200 ease-out ${entered ? "bg-gray-950/75" : "bg-transparent"}`}
				onClick={onClose}
				type="button"
			/>
			<div
				className={`relative z-10 max-h-[calc(100dvh_-_1.5rem)] w-full max-w-lg overflow-x-hidden overflow-y-auto overscroll-contain rounded-3xl border border-gray-700 bg-gray-900 p-4 text-gray-100 shadow-2xl transition-all duration-200 ease-out ${entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<p className="break-words text-lg font-semibold leading-tight">
							{item.shortTitle ?? item.title}
						</p>
						<p className="mt-1 break-words text-sm text-gray-400">
							{formatClock(item.startAt)} - {formatClock(item.endAt)} (
							{formatDuration(getProgramDurationMinutes(item))}) /{" "}
							{item.channelName}
						</p>
					</div>
					<button
						className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-gray-700 bg-gray-800 px-3 text-sm text-gray-200 transition hover:bg-gray-700"
						onClick={onClose}
						type="button"
					>
						閉じる
					</button>
				</div>

				<div className="mt-3 min-w-0 break-words rounded-2xl border border-gray-800 bg-gray-950/60 p-3 text-sm whitespace-pre-line text-gray-300">
					<Interweave
						content={buildProgramSummary(item)}
						matchers={[
							new UrlMatcher("url", {}, (args) => (
								<Url {...args} newWindow={true} />
							)),
						]}
					/>
				</div>

				<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
					{annictId ? (
						<Link
							className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732]"
							onClick={onClose}
							to={`/works/${annictId}`}
						>
							作品ページ
						</Link>
					) : (
						<button
							className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!isLoggedIn}
							onClick={() => {
								if (!isLoggedIn) {
									return;
								}
								onOpenSearch(item);
								onClose();
							}}
							type="button"
						>
							作品を選択
						</button>
					)}
					<a
						className="inline-flex min-h-11 items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400"
						href={`https://cal.syoboi.jp/tid/${item.titleId}#${item.programId}`}
						rel="noopener"
						target="_blank"
					>
						しょぼかる
					</a>
				</div>
			</div>
		</div>
	);
}

function WatchingWorkRow({
	episodeCount,
	onOpen,
	programChannel,
	programTime,
	title,
	watchedEpisodeCount,
}: {
	episodeCount: number;
	onOpen: () => void;
	programChannel?: string;
	programTime?: string;
	title: string;
	watchedEpisodeCount: number;
}) {
	const progressValue = Math.max(
		0,
		Math.min(watchedEpisodeCount, episodeCount),
	);
	const progressPercent =
		episodeCount > 0 ? (progressValue / episodeCount) * 100 : 0;

	return (
		<button
			className="flex min-w-0 w-full flex-col gap-1 rounded-2xl border border-[#FF8B46]/30 bg-[#FF8B46]/10 px-3 py-2 text-left text-sm text-gray-100 transition hover:bg-[#FF8B46]/20"
			onClick={onOpen}
			type="button"
		>
			<span className="flex min-w-0 w-full items-center justify-between gap-2">
				<span className="min-w-0 flex-1">
					<span className="block overflow-hidden text-ellipsis whitespace-nowrap">
						{title}
					</span>
					<span className="mt-1 block truncate text-xs text-gray-400">
						視聴済み {watchedEpisodeCount} / {episodeCount}話
					</span>
				</span>
				{programTime ? (
					<span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-right text-xs">
						{programChannel ? (
							<span className="min-w-0 truncate text-gray-400">
								{programChannel}
							</span>
						) : null}
						<span className="shrink-0 text-[#ffd5bb]">{programTime}</span>
					</span>
				) : null}
			</span>
			<span
				aria-label={`視聴済み ${watchedEpisodeCount} / ${episodeCount}話`}
				aria-valuemax={Math.max(episodeCount, 1)}
				aria-valuemin={0}
				aria-valuenow={progressValue}
				className="block h-1.5 w-full overflow-hidden rounded-full bg-gray-700"
				role="progressbar"
			>
				<span
					className="block h-full rounded-full bg-[#FF8B46] transition-[width]"
					style={{ width: `${progressPercent}%` }}
				/>
			</span>
		</button>
	);
}

export function SyobocalCalendar() {
	const storedFilters = readStoredFilters();
	const location = useLocation();
	const navigate = useNavigate();
	const { accessToken, isLoading, login } = useAnnictSession();
	const [watchingPlaceholderCounts] = useState(
		readWatchingWorksPlaceholderCounts,
	);
	const todayDate = getInitialSyobocalDate();
	const [displayDate, setDisplayDate] = useState(() => {
		const hashValue = location.hash.replace(/^#/, "").trim();
		if (/^\d{4}-\d{2}-\d{2}$/.test(hashValue)) {
			return hashValue;
		}
		return getInitialSyobocalDate();
	});
	const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
	const [selectedChannelGroups, setSelectedChannelGroups] = useState<string[]>([
		...storedFilters.channelGroups,
	]);
	const [selectedCategories, setSelectedCategories] = useState<number[]>(
		storedFilters.categories,
	);
	const [mayRebroadcastHidden, setMayRebroadcastHidden] = useState(
		storedFilters.mayRebroadcastHidden,
	);
	const {
		data: scheduleData,
		error: scheduleErrorRaw,
		isLoading: isScheduleLoading,
		mutate: mutateSchedule,
	} = useSWR(
		["syobocal-schedule", displayDate, [...selectedChannelGroups].sort()],
		([, date, groups]) => fetchSyobocalSchedule(date, groups),
		{
			keepPreviousData: true,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
		},
	);
	const schedule =
		scheduleData?.businessDate === displayDate &&
		JSON.stringify(scheduleData.selectedGroups) ===
			JSON.stringify([...selectedChannelGroups].sort())
			? scheduleData
			: undefined;
	const scheduleError = scheduleErrorRaw
		? getErrorMessage(scheduleErrorRaw)
		: null;

	const {
		data: watchingWorksRaw,
		error: watchingErrorRaw,
		isLoading: isWatchingLoading,
	} = useSWR(
		accessToken ? ["annict-watching-v3", accessToken] : null,
		([, token]) => fetchWatchingWorks(token),
		{
			revalidateOnMount: true,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
		},
	);
	const watchingWorks = watchingWorksRaw ?? [];
	const watchingError = watchingErrorRaw
		? getErrorMessage(watchingErrorRaw)
		: null;
	const [activeProgramModal, setActiveProgramModal] =
		useState<ProgramActionModalState | null>(null);
	const [nowTick, setNowTick] = useState(() => Date.now());

	const watchingWorksByTid = new Map<number, AnnictWatchingWork>();
	for (const work of watchingWorks) {
		if (work.syobocalTid) {
			watchingWorksByTid.set(work.syobocalTid, work);
		}
	}
	const availableChannelGroups = scheduleData?.channelGroups ?? [];
	const selectedCategorySet = new Set(selectedCategories);
	const selectedChannelGroupSet = new Set(selectedChannelGroups);
	const categoryCounts = new Map<number, number>();
	const channelGroupCounts = new Map<string, number>();
	for (const item of schedule?.items ?? []) {
		categoryCounts.set(
			item.category,
			(categoryCounts.get(item.category) ?? 0) + 1,
		);
		if (item.channelGroupLabel) {
			channelGroupCounts.set(
				item.channelGroupLabel,
				(channelGroupCounts.get(item.channelGroupLabel) ?? 0) + 1,
			);
		}
	}

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		try {
			window.localStorage.setItem(
				FILTER_STORAGE_KEY,
				JSON.stringify({
					categories: selectedCategories,
					channelGroups: selectedChannelGroups,
					mayRebroadcastHidden,
				}),
			);
		} catch {
			// Ignore storage write failures.
		}
	}, [mayRebroadcastHidden, selectedCategories, selectedChannelGroups]);

	const visibleItems = (() => {
		if (!schedule) {
			return [];
		}

		const recentFirstBroadcastCutoff =
			getRecentFirstBroadcastCutoff(displayDate);

		return mergeSimulcastItems(
			[...schedule.items]
				.sort((left, right) => left.startAt.localeCompare(right.startAt))
				.filter(
					(item) =>
						selectedCategorySet.has(item.category) &&
						(!mayRebroadcastHidden ||
							item.firstBroadcastAt === null ||
							(parseSyobocalDateTime(item.firstBroadcastAt) >=
								recentFirstBroadcastCutoff &&
								(!item.subtitle?.includes("～") || isFirstRunBatch(item)))) &&
						(availableChannelGroups.length === 0 ||
							(item.channelGroupLabel !== null &&
								selectedChannelGroupSet.has(item.channelGroupLabel))),
				),
		);
	})();

	const timelineLayout = buildTimelineLayout(
		visibleItems,
		schedule?.rangeStartAt,
		schedule?.rangeEndAt,
	);
	const calendarShapeStorageValue = schedule
		? serializeCalendarPlaceholderShape(timelineLayout)
		: null;
	const isCurrentDisplayDate = displayDate === todayDate;

	useEffect(() => {
		if (calendarShapeStorageValue) {
			writeStorage(
				STORAGE_KEYS.calendarPlaceholderShape,
				calendarShapeStorageValue,
			);
		}
	}, [calendarShapeStorageValue]);

	useEffect(() => {
		const today = getInitialSyobocalDate();
		const targetHash = displayDate === today ? "" : `#${displayDate}`;
		if (location.hash === targetHash) {
			return;
		}
		navigate({ hash: targetHash }, { replace: true });
	}, [displayDate, location.hash, navigate]);

	useEffect(() => {
		if (!isCurrentDisplayDate) {
			return;
		}

		setNowTick(Date.now());
		const timerId = window.setInterval(() => {
			setNowTick(Date.now());
		}, 60_000);

		return () => {
			window.clearInterval(timerId);
		};
	}, [isCurrentDisplayDate]);

	useEffect(() => {
		if (!activeProgramModal) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setActiveProgramModal(null);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [activeProgramModal]);

	const displayScheduleWatchingTitleIds = new Set(
		visibleItems
			.filter((item) => watchingWorksByTid.has(item.titleId))
			.map((item) => item.titleId),
	);
	const scheduleChannelOrder = new Map<number, number>();
	let channelOrder = 0;
	for (const group of schedule?.channelGroups ?? []) {
		for (const channelId of group.channelIds) {
			scheduleChannelOrder.set(channelId, channelOrder);
			channelOrder += 1;
		}
	}
	const displayScheduleWatchingItems = visibleItems
		.filter((item) => watchingWorksByTid.has(item.titleId))
		.sort((first, second) => {
			const startOrder = first.startAt.localeCompare(second.startAt);
			if (startOrder !== 0) {
				return startOrder;
			}

			const firstChannelOrder =
				scheduleChannelOrder.get(first.channelId) ?? Number.MAX_SAFE_INTEGER;
			const secondChannelOrder =
				scheduleChannelOrder.get(second.channelId) ?? Number.MAX_SAFE_INTEGER;
			return (
				firstChannelOrder - secondChannelOrder ||
				first.channelName.localeCompare(second.channelName, "ja")
			);
		});
	const displayScheduleWatchingProgramByTitleId = new Map<
		number,
		(typeof displayScheduleWatchingItems)[number]
	>();
	for (const item of displayScheduleWatchingItems) {
		if (!displayScheduleWatchingProgramByTitleId.has(item.titleId)) {
			displayScheduleWatchingProgramByTitleId.set(item.titleId, item);
		}
	}
	const displayScheduleWatchingPrograms = [
		...displayScheduleWatchingProgramByTitleId.values(),
	];
	const otherWatchingWorks = watchingWorks
		.filter(
			(work) =>
				!work.syobocalTid ||
				!displayScheduleWatchingTitleIds.has(work.syobocalTid),
		)
		.sort(compareWatchingWorksByBroadcastDate);
	const watchingPlaceholderCountsToStore =
		accessToken &&
		watchingWorksRaw !== undefined &&
		!isWatchingLoading &&
		!isScheduleLoading
			? serializeWatchingWorksPlaceholderCounts({
					inSchedule: displayScheduleWatchingPrograms.length,
					outOfSchedule: otherWatchingWorks.length,
				})
			: null;
	useEffect(() => {
		if (watchingPlaceholderCountsToStore) {
			writeStorage(
				STORAGE_KEYS.watchingWorksPlaceholderCounts,
				watchingPlaceholderCountsToStore,
			);
		}
	}, [watchingPlaceholderCountsToStore]);
	const shouldShowWatchingPlaceholder =
		watchingWorksRaw === undefined &&
		(isWatchingLoading || isLoading || isScheduleLoading);
	const openWatchingWork = (work: AnnictWatchingWork) => {
		startTransition(() => {
			navigate(`/works/${work.annictId}`);
		});
	};

	const [mappingItem, setMappingItem] = useState<SyobocalScheduleItem | null>(
		null,
	);
	const savedMappings = readWorkMappings();
	const openSearch = (item: SyobocalScheduleItem) => {
		const mapping = readWorkMappings().find(
			(entry) => entry.titleId === item.titleId,
		);
		if (mapping) {
			startTransition(() => navigate(`/works/${mapping.annictId}`));
			return;
		}
		setMappingItem(item);
	};

	const toggleCategory = (value: number) => {
		setSelectedCategories((current) => {
			const next = new Set(current);
			if (next.has(value)) {
				next.delete(value);
			} else {
				next.add(value);
			}

			return CATEGORY_OPTIONS.map((option) => option.value).filter((category) =>
				next.has(category),
			);
		});
	};

	const toggleChannelGroup = (label: string) => {
		setSelectedChannelGroups((current) => {
			const next = new Set(current);
			if (next.has(label)) {
				next.delete(label);
			} else {
				next.add(label);
			}

			return availableChannelGroups
				.map((group) => group.label)
				.filter((groupLabel) => next.has(groupLabel));
		});
	};

	const toggleMayRebroadcastHidden = () => {
		setMayRebroadcastHidden((current) => !current);
	};

	const nowTop = isCurrentDisplayDate
		? (() => {
				const firstCluster = timelineLayout.clusters[0];
				const lastCluster = timelineLayout.clusters.at(-1);
				if (!firstCluster || !lastCluster) {
					return null;
				}

				const now = new Date(nowTick);
				if (now < firstCluster.startAt || now > lastCluster.endAt) {
					return null;
				}

				let currentTop = 0;
				let previousBoundary = firstCluster.startAt;
				for (const cluster of timelineLayout.clusters) {
					if (now < cluster.startAt) {
						return (
							currentTop +
							(diffMinutes(previousBoundary, now) / 60) * MIN_EMPTY_HOUR_HEIGHT
						);
					}

					if (now <= cluster.endAt) {
						return (
							cluster.top +
							(diffMinutes(cluster.startAt, now) / 60) * cluster.pixelsPerHour
						);
					}

					currentTop = cluster.top + cluster.height;
					previousBoundary = cluster.endAt;
				}

				return (
					currentTop +
					(diffMinutes(previousBoundary, now) / 60) * MIN_EMPTY_HOUR_HEIGHT
				);
			})()
		: null;

	return (
		<div className="flex min-w-0 flex-col gap-3 leading-1 md:flex-row">
			<section className="min-w-0 w-full md:w-2/3">
				<div className="rounded-3xl border border-gray-800 bg-gray-900 p-4 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-3">
					<div className="flex flex-wrap items-center justify-between gap-3 px-2">
						<h1 className="text-2xl font-semibold text-gray-50">番組表</h1>
						<div className="flex flex-wrap items-center gap-2">
							<button
								className="inline-flex min-h-11 items-center justify-center rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-gray-700"
								onClick={() =>
									setDisplayDate(shiftSyobocalDate(displayDate, -1))
								}
								type="button"
							>
								前日
							</button>
							<input
								className="min-h-11 rounded-full border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-100 outline-none focus:border-[#FF8B46]"
								onChange={(event) => setDisplayDate(event.target.value)}
								type="date"
								value={displayDate}
							/>
							<button
								className="inline-flex min-h-11 items-center justify-center rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-gray-700"
								onClick={() =>
									setDisplayDate(shiftSyobocalDate(displayDate, 1))
								}
								type="button"
							>
								翌日
							</button>
							<button
								className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732]"
								onClick={() => setDisplayDate(getInitialSyobocalDate())}
								type="button"
							>
								今日
							</button>
						</div>
					</div>

					<div className="mt-4 rounded-2xl border border-gray-800 bg-gray-950/80 p-4">
						<button
							className="flex w-full items-center justify-between gap-3 text-left"
							onClick={() => setIsFilterPanelOpen((current) => !current)}
							type="button"
						>
							<div className="mt-4">
								<p className="font-md font-semibold">表示フィルタ</p>
								<p className="mt-4 text-sm text-gray-300">
									カテゴリ {selectedCategories.length} 件 / 表示グループ{" "}
									{selectedChannelGroups.length} 件
								</p>
							</div>
							<span className="rounded-full border border-gray-700 px-3 py-1 text-sm text-gray-300">
								{isFilterPanelOpen ? "閉じる" : "開く"}
							</span>
						</button>

						{isFilterPanelOpen ? (
							<div className="mt-4 grid gap-3">
								<div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="text-md font-semibold">カテゴリ</p>
										<p className="text-sm text-gray-400">
											選択中 {selectedCategories.length} /{" "}
											{CATEGORY_OPTIONS.length}
										</p>
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										{CATEGORY_OPTIONS.map((option) => {
											const isSelected = selectedCategorySet.has(option.value);

											return (
												<label
													className={
														isSelected
															? "inline-flex cursor-pointer items-center gap-2 rounded-full border border-[#FF8B46]/50 bg-[#FF8B46]/12 px-3 py-2 text-sm text-gray-100"
															: "inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-400"
													}
													key={option.value}
												>
													<input
														checked={isSelected}
														className="sr-only"
														onChange={() => toggleCategory(option.value)}
														type="checkbox"
													/>
													<span>{option.label}</span>
													<span
														className={
															isSelected
																? "rounded-full bg-[#FF8B46] px-2 py-0.5 text-xs text-white"
																: "rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
														}
													>
														{categoryCounts.get(option.value) ?? 0}
													</span>
												</label>
											);
										})}
									</div>
								</div>

								<div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div>
											<p className="text-md font-semibold">
												チャンネルグループ
											</p>
										</div>
										<p className="text-sm text-gray-400">
											選択中 {selectedChannelGroups.length} /{" "}
											{availableChannelGroups.length}
										</p>
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										{availableChannelGroups.map((group) => {
											const isSelected = selectedChannelGroupSet.has(
												group.label,
											);

											return (
												<label
													className={
														isSelected
															? "inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm text-gray-100"
															: "inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-400"
													}
													key={group.label}
												>
													<input
														checked={isSelected}
														className="sr-only"
														onChange={() => toggleChannelGroup(group.label)}
														type="checkbox"
													/>
													<span>{group.label}</span>
													{isSelected ? (
														<span
															className={
																isSelected
																	? "rounded-full bg-sky-400 px-2 py-0.5 text-xs text-gray-950"
																	: "rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
															}
														>
															{channelGroupCounts.get(group.label) ?? 0}
														</span>
													) : null}
												</label>
											);
										})}
									</div>
								</div>

								<div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div>
											<p className="text-md font-semibold">その他フィルタ</p>
										</div>
										<p className="text-sm text-gray-400">
											{mayRebroadcastHidden ? "有効" : "無効"}
										</p>
									</div>
									<div className="mt-3 flex flex-wrap gap-2">
										<label
											className={
												mayRebroadcastHidden
													? "inline-flex cursor-pointer items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-gray-100"
													: "inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-400"
											}
										>
											<input
												checked={mayRebroadcastHidden}
												className="sr-only"
												onChange={toggleMayRebroadcastHidden}
												type="checkbox"
											/>
											<span>再放送疑いを除外</span>
										</label>
									</div>
								</div>
							</div>
						) : null}
					</div>

					<div className="mt-4">
						{isScheduleLoading && !schedule ? <CalendarPlaceholder /> : null}
						{scheduleError ? (
							<div className="grid min-h-60 place-items-center rounded-3xl border border-dashed border-[#FF8B46]/40 bg-[#FF8B46]/8 p-6 text-center">
								<div className="max-w-lg space-y-3">
									<p className="text-lg font-semibold text-gray-50">
										番組表を取得できませんでした
									</p>
									<p className="text-sm text-[#ffd5bb]">{scheduleError}</p>
									<button
										className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732]"
										onClick={() => {
											void mutateSchedule();
										}}
										type="button"
									>
										再読み込み
									</button>
								</div>
							</div>
						) : null}
						{schedule ? (
							<div className="overflow-hidden rounded-3xl border border-gray-800 bg-gray-950/80">
								<div
									className="relative w-full min-w-0"
									style={{ height: timelineLayout.totalHeight }}
								>
									<div
										className="absolute left-0 top-0 z-20 h-full border-r border-gray-800 bg-gray-950/95 backdrop-blur"
										style={{ width: CALENDAR_TIME_RAIL_WIDTH }}
									>
										{timelineLayout.markers.map((marker) => (
											<div
												aria-hidden="true"
												className="pointer-events-none absolute left-0 right-0 border-t border-gray-600"
												key={`rail-guide-${marker.tone}-${marker.top}`}
												style={{
													top: marker.top,
													opacity: marker.tone === "halfHour" ? 0.65 : 0.9,
												}}
											/>
										))}
										{timelineLayout.markers.map((marker) =>
											marker.label === null ? null : (
												<div
													className="absolute left-0 right-0 px-1 text-right text-[10px] font-semibold text-[#FF8B46]"
													key={`${marker.label}-${marker.top}`}
													style={{
														top: marker.top < 12 ? 12 : marker.top,
														transform:
															marker.top < 12
																? "translateY(0)"
																: "translateY(-50%)",
													}}
												>
													<span className="bg-gray-950 px-0.5">
														{marker.label}
													</span>
												</div>
											),
										)}
									</div>

									<div
										className="absolute inset-y-0 right-0"
										style={{ left: CALENDAR_TIME_RAIL_WIDTH }}
									>
										{timelineLayout.markers.map((marker) => (
											<div
												aria-hidden="true"
												className="pointer-events-none absolute left-0 right-0 border-t border-gray-600"
												key={`guide-${marker.label}-${marker.top}`}
												style={{
													top: marker.top,
													opacity: marker.tone === "halfHour" ? 0.65 : 0.9,
												}}
											/>
										))}

										{nowTop != null ? (
											<div
												className="absolute left-0 right-0 z-30 border-t-2 border-red-500"
												style={{ top: nowTop }}
											/>
										) : null}

										{timelineLayout.positionedItems.map((positionedItem) => {
											const linkedWork =
												watchingWorksByTid.get(positionedItem.item.titleId) ??
												null;

											return (
												<ScheduleCard
													isWatching={linkedWork}
													item={positionedItem.item}
													key={positionedItem.item.programId}
													onOpenDetails={() =>
														setActiveProgramModal({
															annictId: linkedWork?.annictId ?? null,
															item: positionedItem.item,
														})
													}
													position={positionedItem}
												/>
											);
										})}
									</div>
								</div>
							</div>
						) : null}
					</div>
					<p className="mt-6 text-sm text-center text-gray-400">
						番組表データソース:{" "}
						<a
							className="text-blue-400"
							href="https://cal.syoboi.jp/"
							rel="noopener"
							target="_blank"
						>
							しょぼいカレンダー (cal.syoboi.jp)
						</a>
					</p>
				</div>
			</section>

			<aside className="min-w-0 w-full md:w-1/3">
				<div className="grid min-w-0 gap-3">
					<section className="min-w-0 rounded-3xl border border-gray-800 bg-gray-900 p-4 shadow-2xl max-[720px]:rounded-2xl">
						<p className="text-md font-semibold mt-2">
							Annictで「見てる」の作品
						</p>
						{accessToken ? (
							<div className="mt-6 min-w-0 space-y-3">
								{shouldShowWatchingPlaceholder ? (
									<WatchingWorksPlaceholder
										inScheduleCount={watchingPlaceholderCounts.inSchedule}
										outOfScheduleCount={watchingPlaceholderCounts.outOfSchedule}
									/>
								) : (
									<>
										{watchingError ? (
											<p className="text-sm text-[#ffc29d]">{watchingError}</p>
										) : null}
										<div className="min-w-0 space-y-5">
											<section>
												<div className="mb-2 flex items-center justify-between">
													<p className="text-sm font-semibold text-gray-200">
														番組表内
													</p>
													<span className="text-xs text-gray-500">
														{displayScheduleWatchingPrograms.length}作品
													</span>
												</div>
												{scheduleError ? (
													<p className="text-sm text-gray-400">
														番組表を取得できませんでした。
													</p>
												) : displayScheduleWatchingPrograms.length > 0 ? (
													<div className="grid min-w-0 gap-2">
														{displayScheduleWatchingPrograms.map((item) => {
															const work = watchingWorksByTid.get(item.titleId);
															if (!work) {
																return null;
															}
															const title = item.shortTitle ?? item.title;
															const episodeNumber =
																item.count === null ? null : `${item.count}話`;
															const displayTitle =
																episodeNumber && !title.includes(episodeNumber)
																	? `${title} ${episodeNumber}`
																	: title;

															return (
																<WatchingWorkRow
																	episodeCount={work.episodeCount}
																	key={work.annictId}
																	onOpen={() => openWatchingWork(work)}
																	programChannel={item.channelName}
																	programTime={formatClock(item.startAt)}
																	title={displayTitle}
																	watchedEpisodeCount={work.watchedEpisodeCount}
																/>
															);
														})}
													</div>
												) : (
													<p className="text-sm text-gray-400">
														該当する作品はありません。
													</p>
												)}
											</section>
											<section>
												<div className="mb-2 flex items-center justify-between">
													<p className="text-sm font-semibold text-gray-200">
														番組表外
													</p>
													<span className="text-xs text-gray-500">
														{otherWatchingWorks.length}作品
													</span>
												</div>
												{otherWatchingWorks.length > 0 ? (
													<div className="grid min-w-0 gap-2">
														{otherWatchingWorks.map((work) => {
															return (
																<WatchingWorkRow
																	episodeCount={work.episodeCount}
																	key={work.annictId}
																	onOpen={() => openWatchingWork(work)}
																	title={work.title}
																	watchedEpisodeCount={work.watchedEpisodeCount}
																/>
															);
														})}
													</div>
												) : (
													<p className="text-sm text-gray-400">
														{watchingWorks.length === 0
															? "「見てる」作品はありません。"
															: "対象の作品はありません。"}
													</p>
												)}
											</section>
										</div>
									</>
								)}
							</div>
						) : (
							<div className="mt-3 space-y-3">
								<p className="text-sm text-gray-400">
									ログインすると、Annict
									上で「見てる」の作品と合わせて表示できます。
								</p>
								<button
									className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732] disabled:cursor-not-allowed disabled:opacity-50"
									onClick={login}
									type="button"
								>
									Annictでログイン
								</button>
							</div>
						)}
					</section>
				</div>
			</aside>

			{mappingItem ? (
				<WorkMappingModal
					titleId={mappingItem.titleId}
					title={mappingItem.shortTitle ?? mappingItem.title}
					onClose={() => setMappingItem(null)}
				/>
			) : null}
			{activeProgramModal ? (
				<ProgramActionModal
					annictId={
						savedMappings.find(
							(entry) => entry.titleId === activeProgramModal.item.titleId,
						)?.annictId ?? activeProgramModal.annictId
					}
					isLoggedIn={!!accessToken}
					item={activeProgramModal.item}
					onClose={() => setActiveProgramModal(null)}
					onOpenSearch={openSearch}
				/>
			) : null}
		</div>
	);
}
