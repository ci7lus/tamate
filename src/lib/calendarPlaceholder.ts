import { STORAGE_KEYS } from "../shared/constants";
import { readStorage } from "./storage";

export type CalendarPlaceholderShape = {
	height: number;
	markers: Array<{
		label: string | null;
		tone: "hour" | "halfHour";
		top: number;
	}>;
	programs: Array<{
		columnCount: number;
		columnIndex: number;
		height: number;
		top: number;
		isWatching?: boolean;
	}>;
};

type TimelineShapeSource = {
	markers: CalendarPlaceholderShape["markers"];
	positionedItems: CalendarPlaceholderShape["programs"];
	totalHeight: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value);

export const serializeCalendarPlaceholderShape = (
	layout: TimelineShapeSource,
) =>
	JSON.stringify({
		height: layout.totalHeight,
		markers: layout.markers.map(({ label, tone, top }) => ({
			label,
			tone,
			top,
		})),
		programs: layout.positionedItems.map(
			({ columnCount, columnIndex, height, top }) => ({
				columnCount,
				columnIndex,
				height,
				top,
			}),
		),
		version: 1,
	});

export const readCalendarPlaceholderShape =
	(): CalendarPlaceholderShape | null => {
		const value = readStorage(STORAGE_KEYS.calendarPlaceholderShape);
		if (!value) {
			return null;
		}

		try {
			const parsed: unknown = JSON.parse(value);
			if (
				!isRecord(parsed) ||
				parsed.version !== 1 ||
				!isFiniteNumber(parsed.height) ||
				parsed.height < 0 ||
				parsed.height > 100_000 ||
				!Array.isArray(parsed.markers) ||
				parsed.markers.length > 1_000 ||
				!Array.isArray(parsed.programs) ||
				parsed.programs.length > 2_000
			) {
				return null;
			}
			const height = parsed.height;

			const markers = parsed.markers.map(
				(marker): CalendarPlaceholderShape["markers"][number] | null => {
					if (!isRecord(marker)) {
						return null;
					}

					const { label, tone, top } = marker;
					if (
						!(label === null || typeof label === "string") ||
						!(tone === "hour" || tone === "halfHour") ||
						!isFiniteNumber(top) ||
						top < 0 ||
						top > height
					) {
						return null;
					}

					return { label, tone, top };
				},
			);
			const programs = parsed.programs.map(
				(program): CalendarPlaceholderShape["programs"][number] | null => {
					if (!isRecord(program)) {
						return null;
					}

					const {
						columnCount,
						columnIndex,
						height: programHeight,
						top,
					} = program;
					if (
						!isInteger(columnCount) ||
						columnCount < 1 ||
						columnCount > 500 ||
						!isInteger(columnIndex) ||
						columnIndex < 0 ||
						columnIndex >= columnCount ||
						!isFiniteNumber(programHeight) ||
						programHeight <= 0 ||
						!isFiniteNumber(top) ||
						top < 0 ||
						top + programHeight > height
					) {
						return null;
					}

					return {
						columnCount,
						columnIndex,
						height: programHeight,
						top,
					};
				},
			);

			if (
				markers.some((marker) => marker === null) ||
				programs.some((p) => p === null)
			) {
				return null;
			}

			return {
				height,
				markers: markers as CalendarPlaceholderShape["markers"],
				programs: programs as CalendarPlaceholderShape["programs"],
			};
		} catch {
			return null;
		}
	};
