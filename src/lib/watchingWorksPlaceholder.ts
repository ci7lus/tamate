import { STORAGE_KEYS } from "../shared/constants";
import { readStorage } from "./storage";

export type WatchingWorksPlaceholderCounts = {
	inSchedule: number;
	outOfSchedule: number;
};

const DEFAULT_PLACEHOLDER_COUNTS: WatchingWorksPlaceholderCounts = {
	inSchedule: 3,
	outOfSchedule: 3,
};

const isCount = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isInteger(value) &&
	value >= 0 &&
	value <= 1_000;

export const serializeWatchingWorksPlaceholderCounts = (
	counts: WatchingWorksPlaceholderCounts,
) => JSON.stringify({ ...counts, version: 1 });

export const readWatchingWorksPlaceholderCounts =
	(): WatchingWorksPlaceholderCounts => {
		const value = readStorage(STORAGE_KEYS.watchingWorksPlaceholderCounts);
		if (!value) {
			return DEFAULT_PLACEHOLDER_COUNTS;
		}

		try {
			const parsed: unknown = JSON.parse(value);
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				!("version" in parsed) ||
				parsed.version !== 1 ||
				!("inSchedule" in parsed) ||
				!("outOfSchedule" in parsed) ||
				!isCount(parsed.inSchedule) ||
				!isCount(parsed.outOfSchedule)
			) {
				return DEFAULT_PLACEHOLDER_COUNTS;
			}

			return {
				inSchedule: parsed.inSchedule,
				outOfSchedule: parsed.outOfSchedule,
			};
		} catch {
			return DEFAULT_PLACEHOLDER_COUNTS;
		}
	};
