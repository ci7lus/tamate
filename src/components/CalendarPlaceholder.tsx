import { useState } from "react";

import {
	type CalendarPlaceholderShape,
	readCalendarPlaceholderShape,
} from "../lib/calendarPlaceholder";
import { CALENDAR_TIME_RAIL_WIDTH } from "../shared/constants";

const HOUR_HEIGHT = 144;
const MIN_EMPTY_HOUR_HEIGHT = HOUR_HEIGHT * 0.25;
const HALF_HOUR_MINUTES = 30;
const TIMELINE_DURATION_MINUTES = 20 * 60;
const START_HOUR = 9;

type PlaceholderProgram = {
	end: number;
	isWatching?: boolean;
	start: number;
};

type PositionedPlaceholderProgram = PlaceholderProgram & {
	columnCount: number;
	columnIndex: number;
	height: number;
	top: number;
};

type PlaceholderCluster = {
	end: number;
	programs: PlaceholderProgram[];
	start: number;
	top: number;
};

const placeholderPrograms: PlaceholderProgram[] = [
	{ start: 0, end: 20 },
	{ start: 0, end: 30 },
	{ start: 30, end: 35 },
	{ start: 30, end: 60, isWatching: true },
	{ start: 449, end: 450 },
	{ start: 510, end: 540 },
	{ start: 540, end: 780 },
	{ start: 565, end: 590 },
	{ start: 660, end: 780 },
	{ start: 660, end: 690 },
	{ start: 690, end: 720 },
	{ start: 720, end: 750 },
	{ start: 720, end: 750 },
	{ start: 720, end: 750, isWatching: true },
	{ start: 750, end: 777 },
	{ start: 750, end: 780 },
	{ start: 780, end: 810 },
	{ start: 810, end: 840 },
	{ start: 810, end: 840 },
	{ start: 840, end: 990 },
	{ start: 840, end: 870 },
	{ start: 840, end: 870 },
	{ start: 840, end: 870 },
	{ start: 840, end: 870 },
	{ start: 840, end: 870 },
	{ start: 865, end: 870 },
	{ start: 870, end: 900 },
	{ start: 870, end: 900 },
	{ start: 870, end: 900 },
	{ start: 885, end: 910 },
	{ start: 900, end: 930, isWatching: true },
	{ start: 900, end: 930 },
	{ start: 900, end: 930 },
	{ start: 900, end: 930 },
	{ start: 900, end: 930 },
	{ start: 930, end: 960, isWatching: true },
	{ start: 930, end: 960, isWatching: true },
	{ start: 960, end: 990 },
	{ start: 990, end: 1020 },
	{ start: 990, end: 1020 },
	{ start: 995, end: 1025 },
	{ start: 1020, end: 1050 },
	{ start: 1110, end: 1125 },
];

const buildPlaceholderLayout = () => {
	const sortedPrograms = [...placeholderPrograms].sort(
		(left, right) => left.start - right.start,
	);
	const clusters: PlaceholderCluster[] = [];

	for (const program of sortedPrograms) {
		const currentCluster = clusters.at(-1);
		if (!currentCluster || program.start >= currentCluster.end) {
			clusters.push({
				end: program.end,
				programs: [program],
				start: program.start,
				top: 0,
			});
			continue;
		}

		currentCluster.programs.push(program);
		currentCluster.end = Math.max(currentCluster.end, program.end);
	}

	const positionedPrograms: PositionedPlaceholderProgram[] = [];
	let top = 0;
	let previousBoundary = clusters[0]?.start ?? 0;

	for (const cluster of clusters) {
		if (cluster.start > previousBoundary) {
			top += ((cluster.start - previousBoundary) / 60) * MIN_EMPTY_HOUR_HEIGHT;
		}
		cluster.top = top;

		const columnEnds: number[] = [];
		const assignments = cluster.programs.map((program) => {
			const reusableIndex = columnEnds.findIndex(
				(columnEnd) => program.start >= columnEnd,
			);

			if (reusableIndex >= 0) {
				columnEnds[reusableIndex] = program.end;
				return { columnIndex: reusableIndex, program };
			}

			columnEnds.push(program.end);
			return { columnIndex: columnEnds.length - 1, program };
		});
		const columnCount = Math.max(columnEnds.length, 1);

		for (const { columnIndex, program } of assignments) {
			positionedPrograms.push({
				...program,
				columnCount,
				columnIndex,
				height: ((program.end - program.start) / 60) * HOUR_HEIGHT,
				top: cluster.top + ((program.start - cluster.start) / 60) * HOUR_HEIGHT,
			});
		}

		top += ((cluster.end - cluster.start) / 60) * HOUR_HEIGHT;
		previousBoundary = cluster.end;
	}

	if (previousBoundary < TIMELINE_DURATION_MINUTES) {
		top +=
			((TIMELINE_DURATION_MINUTES - previousBoundary) / 60) *
			MIN_EMPTY_HOUR_HEIGHT;
	}

	const markers: Array<{
		label: string | null;
		tone: "hour" | "halfHour";
		top: number;
	}> = [];
	const lastClusterEnd = clusters.at(-1)?.end ?? 0;
	for (let minute = 0; minute <= lastClusterEnd; minute += HALF_HOUR_MINUTES) {
		const cluster = clusters.find(
			(candidate) => minute >= candidate.start && minute <= candidate.end,
		);
		if (!cluster) {
			continue;
		}

		const totalMinutes = START_HOUR * 60 + minute;
		const isHalfHour = totalMinutes % 60 === 30;
		markers.push({
			label: isHalfHour
				? null
				: String(Math.floor((totalMinutes % (24 * 60)) / 60)),
			tone: isHalfHour ? "halfHour" : "hour",
			top: cluster.top + ((minute - cluster.start) / 60) * HOUR_HEIGHT,
		});
	}

	return { height: top, markers, programs: positionedPrograms };
};

const initialPlaceholderLayout = buildPlaceholderLayout();

export function CalendarPlaceholder() {
	const [placeholderLayout] = useState<CalendarPlaceholderShape>(
		() => readCalendarPlaceholderShape() ?? initialPlaceholderLayout,
	);

	return (
		<div className="overflow-hidden rounded-3xl border border-gray-800 bg-gray-950/80">
			<div
				className="relative w-full min-w-0"
				style={{ height: placeholderLayout.height }}
			>
				<div
					aria-hidden="true"
					className="absolute left-0 top-0 z-20 h-full border-r border-gray-800 bg-gray-950/95"
					style={{ width: CALENDAR_TIME_RAIL_WIDTH }}
				>
					{placeholderLayout.markers.map((marker) => (
						<div
							className="pointer-events-none absolute left-0 right-0 border-t border-gray-600"
							key={`rail-${marker.label}-${marker.top}`}
							style={{
								top: marker.top,
								opacity: marker.tone === "halfHour" ? 0.65 : 0.9,
							}}
						/>
					))}
					{placeholderLayout.markers.map((marker) =>
						marker.label === null ? null : (
							<div
								className="absolute left-0 right-0 px-1 text-right text-[10px] font-semibold text-[#FF8B46]"
								key={`label-${marker.label}-${marker.top}`}
								style={{
									top: marker.top < 12 ? 12 : marker.top,
									transform:
										marker.top < 12 ? "translateY(0)" : "translateY(-50%)",
								}}
							>
								<span className="bg-gray-950 px-0.5">{marker.label}</span>
							</div>
						),
					)}
				</div>

				<div
					aria-hidden="true"
					className="absolute inset-y-0 right-0"
					style={{ left: CALENDAR_TIME_RAIL_WIDTH }}
				>
					{placeholderLayout.markers.map((marker) => (
						<div
							className="pointer-events-none absolute left-0 right-0 border-t border-gray-600"
							key={`guide-${marker.label}-${marker.top}`}
							style={{
								top: marker.top,
								opacity: marker.tone === "halfHour" ? 0.65 : 0.9,
							}}
						/>
					))}

					{placeholderLayout.programs.map((program) => (
						<div
							className="absolute animate-pulse overflow-hidden rounded-sm border border-gray-700 bg-gray-800/90 p-0.5"
							key={`${program.top}-${program.height}-${program.columnIndex}`}
							style={{
								borderLeft: program.isWatching
									? "3px solid #fb923c"
									: undefined,
								top: program.top,
								left: `${(program.columnIndex / program.columnCount) * 100}%`,
								width: `${100 / program.columnCount}%`,
								height: program.height,
							}}
						>
							{program.height >= 22 ? (
								<div className="mb-1 h-2 w-[45%] rounded bg-gray-700" />
							) : null}
							{program.height >= 12 ? (
								<div className="h-2 w-[75%] rounded bg-gray-700/80" />
							) : null}
							{program.height >= 56 ? (
								<div className="mt-1 h-2 w-1/3 rounded bg-gray-700/60" />
							) : null}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
