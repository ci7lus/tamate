import { Interweave } from "interweave";
import { Url, UrlMatcher } from "interweave-autolink";
import { startTransition, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
	type AnnictWatchingWork,
	fetchWatchingWorks,
	searchWorksByTitle,
} from "../lib/annict";
import { getErrorMessage } from "../lib/errors";
import {
	fetchSyobocalSchedule,
	getInitialSyobocalDate,
	parseSyobocalDateTime,
	type SyobocalSchedule,
	type SyobocalScheduleItem,
	shiftSyobocalDate,
} from "../lib/syobocal";
import { requestSearchTerm } from "../shared/search";
import { useAnnictSession } from "./AnnictSessionProvider";

const HOUR_HEIGHT = 112;
const TIME_RAIL_WIDTH = 72;

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
	label: string;
	top: number;
	tone: "start";
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

const normalizeAnnictTitle = (value: string) =>
	value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{P}\p{S}\sー－〜]/gu, "");

const readStoredFilters = () => {
	if (typeof window === "undefined") {
		return {
			categories: DEFAULT_SELECTED_CATEGORIES,
			channelGroups: [...DEFAULT_VISIBLE_CHANNEL_GROUPS],
			mayRebroadcastHidden: true,
		};
	}

	try {
		const rawValue = window.localStorage.getItem(FILTER_STORAGE_KEY);
		if (!rawValue) {
			return {
				categories: DEFAULT_SELECTED_CATEGORIES,
				channelGroups: [...DEFAULT_VISIBLE_CHANNEL_GROUPS],
				mayRebroadcastHidden: true,
			};
		}

		const parsedValue = JSON.parse(rawValue) as {
			categories?: number[];
			channelGroups?: string[];
			mayRebroadcastHidden?: boolean;
		};

		return {
			categories:
				parsedValue.categories?.filter((value) => typeof value === "number") ??
				DEFAULT_SELECTED_CATEGORIES,
			channelGroups: parsedValue.channelGroups?.filter(
				(value) => typeof value === "string",
			) ?? [...DEFAULT_VISIBLE_CHANNEL_GROUPS],
			mayRebroadcastHidden:
				typeof parsedValue.mayRebroadcastHidden === "boolean"
					? parsedValue.mayRebroadcastHidden
					: true,
		};
	} catch {
		return {
			categories: DEFAULT_SELECTED_CATEGORIES,
			channelGroups: [...DEFAULT_VISIBLE_CHANNEL_GROUPS],
			mayRebroadcastHidden: true,
		};
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

const getRecentFirstBroadcastCutoff = (businessDate: string) => {
	const cutoff = parseSyobocalDateTime(`${businessDate} 00:00:00`);
	cutoff.setMonth(cutoff.getMonth() - RECENT_FIRST_BROADCAST_MONTHS);
	return cutoff;
};

const diffMinutes = (startAt: Date, endAt: Date) =>
	Math.round((endAt.getTime() - startAt.getTime()) / 60_000);

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

const getPreferredCardHeight = (item: SyobocalScheduleItem) => {
	const summary = buildProgramSummary(item);
	const title = item.shortTitle ?? item.title;
	const titleLines = Math.max(1, Math.ceil(title.length / 13));
	const channelLines = Math.max(1, Math.ceil(item.channelName.length / 18));
	const summaryLines = summary
		? Math.max(1, Math.ceil(summary.length / 18))
		: 0;

	return Math.min(
		196,
		52 + titleLines * 24 + channelLines * 18 + summaryLines * 16,
	);
};

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
			item.subtitle ?? "",
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

const buildTimelineLayout = (items: SyobocalScheduleItem[]) => {
	const timelineItems: TimedScheduleItem[] = items
		.map((item) => ({
			endAt: parseSyobocalDateTime(item.endAt),
			item,
			startAt: parseSyobocalDateTime(item.startAt),
		}))
		.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

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

	const markers: TimelineMarker[] = [];
	const positionedItems: TimelineLayoutItem[] = [];
	const positionedClusters: TimelineCluster[] = [];
	let top = 0;

	for (const cluster of clusters) {
		const clusterStart = cluster[0]?.startAt;
		if (!clusterStart) {
			continue;
		}

		const clusterEnd = cluster.reduce(
			(currentEnd, timelineItem) =>
				timelineItem.endAt > currentEnd ? timelineItem.endAt : currentEnd,
			clusterStart,
		);

		markers.push({
			label: formatClockFromDate(clusterStart),
			tone: "start",
			top,
		});

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

		const clusterDurationMinutes = Math.max(
			diffMinutes(clusterStart, clusterEnd),
			15,
		);
		const pixelsPerHour = Math.max(
			30,
			...assignments.map((assignment) => {
				const itemDurationMinutes = Math.max(
					diffMinutes(
						assignment.timelineItem.startAt,
						assignment.timelineItem.endAt,
					),
					5,
				);
				const baseCardHeight = Math.max(
					(itemDurationMinutes / 60) * HOUR_HEIGHT - 8,
					24,
				);

				return (
					(getPreferredCardHeight(assignment.timelineItem.item) /
						baseCardHeight) *
					HOUR_HEIGHT
				);
			}),
		);
		const clusterHeight = Math.max(
			(clusterDurationMinutes / 60) * pixelsPerHour,
			64,
		);
		const columnCount = Math.max(columnEnds.length, 1);

		for (const assignment of assignments) {
			const itemDurationMinutes = Math.max(
				diffMinutes(
					assignment.timelineItem.startAt,
					assignment.timelineItem.endAt,
				),
				5,
			);

			positionedItems.push({
				columnCount,
				columnIndex: assignment.columnIndex,
				height: Math.max(
					(itemDurationMinutes / 60) * pixelsPerHour,
					getPreferredCardHeight(assignment.timelineItem.item),
				),
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

function ScheduleSkeleton() {
	return (
		<div className="grid gap-3">
			<div className="h-16 animate-pulse rounded-2xl bg-gray-800" />
			<div className="h-[68vh] animate-pulse rounded-3xl bg-gray-950/80" />
		</div>
	);
}

function ScheduleCard({
	isWatching,
	item,
	onOpenSearch,
	onOpenWork,
	position,
}: {
	isWatching: AnnictWatchingWork | null;
	item: SyobocalScheduleItem;
	onOpenSearch: (term: string) => Promise<void> | void;
	onOpenWork: (work: AnnictWatchingWork) => void;
	position: TimelineLayoutItem;
}) {
	const left = `${(position.columnIndex / position.columnCount) * 100}%`;
	const baseSurfaceStyle = getCategorySurfaceStyle(item.category);
	const surfaceStyle = isWatching
		? { ...baseSurfaceStyle, borderColor: "#fb923c" }
		: item.warn > 0
			? { ...baseSurfaceStyle, borderColor: "#38bdf8" }
			: baseSurfaceStyle;

	return (
		<button
			className="absolute z-0 overflow-hidden rounded-2xl border p-2 text-left shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition hover:z-20 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(15,23,42,0.22)]"
			onClick={() => {
				if (isWatching) {
					onOpenWork(isWatching);
					return;
				}

				void onOpenSearch(item.shortTitle ?? item.title);
			}}
			style={{
				height: position.height,
				left,
				top: position.top,
				width: `${100 / position.columnCount}%`,
				...surfaceStyle,
			}}
			type="button"
		>
			<div className="flex items-start justify-between gap-2 text-[11px] font-semibold text-gray-700">
				<span>{formatClock(item.startAt)}</span>
				{isWatching ? (
					<span className="rounded-full bg-[#FF8B46] p-2 text-[10px] text-white">
						視聴中
					</span>
				) : null}
			</div>
			<div className="mt-1 overflow-hidden text-[16px] font-semibold leading-[1.15] text-gray-950">
				{item.shortTitle ?? item.title}
			</div>
			<div className="mt-1 overflow-hidden text-[13px] leading-tight text-sky-700">
				{item.channelName}
			</div>
			{/** biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation */}
			{/** biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation */}
			<div
				className="mt-1 overflow-hidden text-[12px] leading-tight text-gray-600"
				onClick={(e) => e.stopPropagation()}
			>
				<Interweave
					content={buildProgramSummary(item)}
					matchers={[
						new UrlMatcher("url", {}, (args) => (
							<Url {...args} newWindow={true} />
						)),
					]}
				/>
			</div>
		</button>
	);
}

export function SyobocalCalendar() {
	const storedFilters = readStoredFilters();
	const navigate = useNavigate();
	const { accessToken, isLoading, login } = useAnnictSession();
	const [businessDate, setBusinessDate] = useState(() =>
		getInitialSyobocalDate(),
	);
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
	const [isScheduleLoading, setIsScheduleLoading] = useState(true);
	const [isWatchingLoading, setIsWatchingLoading] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const [schedule, setSchedule] = useState<SyobocalSchedule | null>(null);
	const [scheduleError, setScheduleError] = useState<string | null>(null);
	const [watchingError, setWatchingError] = useState<string | null>(null);
	const [watchingWorks, setWatchingWorks] = useState<AnnictWatchingWork[]>([]);

	useEffect(() => {
		void reloadKey;

		let isActive = true;
		setIsScheduleLoading(true);
		setScheduleError(null);

		fetchSyobocalSchedule(businessDate)
			.then((nextSchedule) => {
				if (!isActive) {
					return;
				}

				setSchedule(nextSchedule);
			})
			.catch((error) => {
				if (!isActive) {
					return;
				}

				setSchedule(null);
				setScheduleError(getErrorMessage(error));
			})
			.finally(() => {
				if (!isActive) {
					return;
				}

				setIsScheduleLoading(false);
			});

		return () => {
			isActive = false;
		};
	}, [businessDate, reloadKey]);

	useEffect(() => {
		if (!accessToken) {
			setWatchingWorks([]);
			setWatchingError(null);
			setIsWatchingLoading(false);
			return;
		}

		let isActive = true;
		const timerId = window.setTimeout(() => {
			setIsWatchingLoading(true);
			setWatchingError(null);

			fetchWatchingWorks(accessToken)
				.then((nextWorks) => {
					if (!isActive) {
						return;
					}

					setWatchingWorks(nextWorks);
				})
				.catch((error) => {
					if (!isActive) {
						return;
					}

					setWatchingWorks([]);
					setWatchingError(getErrorMessage(error));
				})
				.finally(() => {
					if (!isActive) {
						return;
					}

					setIsWatchingLoading(false);
				});
		}, 180);

		return () => {
			isActive = false;
			window.clearTimeout(timerId);
		};
	}, [accessToken]);

	const watchingWorksByTid = new Map<number, AnnictWatchingWork>();
	for (const work of watchingWorks) {
		if (work.syobocalTid) {
			watchingWorksByTid.set(work.syobocalTid, work);
		}
	}
	const availableChannelGroups = schedule?.channelGroups ?? [];
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
		if (!schedule || availableChannelGroups.length === 0) {
			return;
		}

		setSelectedChannelGroups((current) => {
			const availableLabels = new Set(
				availableChannelGroups.map((group) => group.label),
			);
			const normalizedCurrent = current.filter((label) =>
				availableLabels.has(label),
			);

			if (normalizedCurrent.length > 0) {
				return normalizedCurrent;
			}

			const defaultLabels = DEFAULT_VISIBLE_CHANNEL_GROUPS.filter((label) =>
				availableLabels.has(label),
			);
			return defaultLabels.length > 0
				? [...defaultLabels]
				: availableChannelGroups.map((group) => group.label);
		});
	}, [availableChannelGroups, schedule]);

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
			getRecentFirstBroadcastCutoff(businessDate);

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
								!item.subtitle?.includes("～"))) &&
						(availableChannelGroups.length === 0 ||
							(item.channelGroupLabel !== null &&
								selectedChannelGroupSet.has(item.channelGroupLabel))),
				),
		);
	})();

	const timelineLayout = buildTimelineLayout(visibleItems);
	const isCurrentBusinessDate = businessDate === getInitialSyobocalDate();
	const matchedPrograms = [
		...new Map(
			visibleItems
				.filter((item) => watchingWorksByTid.has(item.titleId))
				.map((item) => [item.titleId, item]),
		).values(),
	];

	const openWatchingWork = (work: AnnictWatchingWork) => {
		startTransition(() => {
			navigate(`/works/${work.annictId}`);
		});
	};

	const openSearch = async (term: string) => {
		const trimmedTerm = term.trim();
		if (!trimmedTerm) {
			return;
		}

		if (accessToken) {
			try {
				const works = await searchWorksByTitle(accessToken, trimmedTerm);
				const normalizedTerm = normalizeAnnictTitle(trimmedTerm);
				const matchedWork =
					works.find(
						(work) => normalizeAnnictTitle(work.title) === normalizedTerm,
					) ?? works[0];

				if (matchedWork) {
					startTransition(() => {
						navigate(`/works/${matchedWork.annictId}`);
					});
					return;
				}
			} catch {
				// Fall back to the global search box if Annict lookup fails.
			}
		}

		requestSearchTerm(trimmedTerm);
		window.scrollTo({
			behavior: "smooth",
			top: 0,
		});
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

	const nowTop = isCurrentBusinessDate
		? (() => {
				const now = new Date();
				for (const cluster of timelineLayout.clusters) {
					if (now < cluster.startAt || now > cluster.endAt) {
						continue;
					}

					return (
						cluster.top +
						(diffMinutes(cluster.startAt, now) / 60) * cluster.pixelsPerHour
					);
				}

				return null;
			})()
		: null;

	return (
		<div className="flex flex-col gap-3 md:flex-row leading-1">
			<section className="w-full md:w-2/3">
				<div className="rounded-3xl border border-gray-800 bg-gray-900 p-4 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-3">
					<div className="flex flex-wrap items-center justify-between gap-3 px-2">
						<h1 className="text-2xl font-semibold text-gray-50">番組表</h1>
						<div className="flex flex-wrap items-center gap-2">
							<button
								className="inline-flex min-h-11 items-center justify-center rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-gray-700"
								onClick={() =>
									setBusinessDate(shiftSyobocalDate(businessDate, -1))
								}
								type="button"
							>
								前日
							</button>
							<input
								className="min-h-11 rounded-full border border-gray-700 bg-gray-950 px-4 py-2 text-sm text-gray-100 outline-none focus:border-[#FF8B46]"
								onChange={(event) => setBusinessDate(event.target.value)}
								type="date"
								value={businessDate}
							/>
							<button
								className="inline-flex min-h-11 items-center justify-center rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-gray-700"
								onClick={() =>
									setBusinessDate(shiftSyobocalDate(businessDate, 1))
								}
								type="button"
							>
								翌日
							</button>
							<button
								className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732]"
								onClick={() => setBusinessDate(getInitialSyobocalDate())}
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
													<span
														className={
															isSelected
																? "rounded-full bg-sky-400 px-2 py-0.5 text-xs text-gray-950"
																: "rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
														}
													>
														{channelGroupCounts.get(group.label) ?? 0}
													</span>
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
						{isScheduleLoading && !schedule ? <ScheduleSkeleton /> : null}
						{scheduleError ? (
							<div className="grid min-h-60 place-items-center rounded-3xl border border-dashed border-[#FF8B46]/40 bg-[#FF8B46]/8 p-6 text-center">
								<div className="max-w-lg space-y-3">
									<p className="text-lg font-semibold text-gray-50">
										番組表を取得できませんでした
									</p>
									<p className="text-sm text-[#ffd5bb]">{scheduleError}</p>
									<button
										className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#FF8B46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f07732]"
										onClick={() => setReloadKey((current) => current + 1)}
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
										style={{ width: TIME_RAIL_WIDTH }}
									>
										{timelineLayout.markers.map((marker) => (
											<div
												className="absolute left-0 right-0 px-2 text-xs font-semibold text-[#FF8B46]"
												key={`${marker.label}-${marker.top}`}
												style={{ top: marker.top }}
											>
												{marker.label}
											</div>
										))}
									</div>

									<div
										className="absolute inset-y-0 right-0"
										style={{ left: TIME_RAIL_WIDTH }}
									>
										{nowTop != null ? (
											<div
												className="absolute left-0 right-0 z-10 border-t-2 border-red-500"
												style={{ top: nowTop }}
											/>
										) : null}

										{timelineLayout.positionedItems.map((positionedItem) => (
											<ScheduleCard
												isWatching={
													watchingWorksByTid.get(positionedItem.item.titleId) ??
													null
												}
												item={positionedItem.item}
												key={positionedItem.item.programId}
												onOpenSearch={openSearch}
												onOpenWork={openWatchingWork}
												position={positionedItem}
											/>
										))}
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
							rel="noopener noreferrer"
							target="_blank"
						>
							しょぼいカレンダー (cal.syoboi.jp)
						</a>
					</p>
				</div>
			</section>

			<aside className="w-full md:w-1/3">
				<div className="grid gap-3">
					<section className="rounded-3xl border border-gray-800 bg-gray-900 p-4 shadow-2xl max-[720px]:rounded-2xl">
						<p className="text-md font-semibold mt-2">
							Annictで「見てる」の作品
						</p>
						{accessToken ? (
							<div className="mt-6 space-y-3">
								{isWatchingLoading || isLoading ? (
									<p className="text-sm text-gray-400">
										Annict を読み込み中です...
									</p>
								) : null}
								{watchingError ? (
									<p className="text-sm text-[#ffc29d]">{watchingError}</p>
								) : null}
								{matchedPrograms.length > 0 ? (
									<div className="grid gap-2">
										{matchedPrograms.slice(0, 8).map((item) => {
											const work = watchingWorksByTid.get(item.titleId);
											if (!work) {
												return null;
											}

											return (
												<button
													className="flex items-center justify-between rounded-2xl border border-[#FF8B46]/30 bg-[#FF8B46]/10 px-3 py-2 text-left text-sm text-gray-100 transition hover:bg-[#FF8B46]/20"
													key={item.programId}
													onClick={() => openWatchingWork(work)}
													type="button"
												>
													<span>{item.shortTitle ?? item.title}</span>
													<span className="text-xs text-[#ffd5bb]">
														{formatClock(item.startAt)}
													</span>
												</button>
											);
										})}
									</div>
								) : !isWatchingLoading ? (
									<p className="text-sm text-gray-400">
										この日の番組表には、Annict
										で「見てる」にしている作品はまだ見つかっていません。
									</p>
								) : null}
							</div>
						) : (
							<div className="mt-3 space-y-3">
								<p className="text-sm text-gray-400">
									ログインすると、Annict
									で視聴中の作品を番組表上で強調表示できます。
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
		</div>
	);
}
