import { readStorage, STORAGE_KEYS, writeStorage } from "../lib/storage";

const MAX_WORK_HISTORY_SIZE = 10;

export const WORK_HISTORY_EVENT_NAME = "tamate:work-history-updated";

export type WorkHistoryEntry = {
	annictId: number;
	imageUrl: string | null;
	title: string;
};

const isWorkHistoryEntry = (value: unknown): value is WorkHistoryEntry => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const entry = value as Record<string, unknown>;
	return (
		typeof entry.annictId === "number" &&
		Number.isSafeInteger(entry.annictId) &&
		entry.annictId > 0 &&
		typeof entry.title === "string" &&
		(entry.imageUrl === null || typeof entry.imageUrl === "string")
	);
};

export const readWorkHistory = (): WorkHistoryEntry[] => {
	const storedValue = readStorage(STORAGE_KEYS.workHistory);
	if (!storedValue) {
		return [];
	}

	try {
		const parsedValue: unknown = JSON.parse(storedValue);
		if (!Array.isArray(parsedValue)) {
			return [];
		}

		const seenAnnictIds = new Set<number>();
		return parsedValue
			.filter(isWorkHistoryEntry)
			.filter((entry) => {
				if (seenAnnictIds.has(entry.annictId)) {
					return false;
				}

				seenAnnictIds.add(entry.annictId);
				return true;
			})
			.slice(0, MAX_WORK_HISTORY_SIZE);
	} catch {
		return [];
	}
};

export const recordVisitedWork = (entry: WorkHistoryEntry) => {
	const nextHistory = [
		entry,
		...readWorkHistory().filter((work) => work.annictId !== entry.annictId),
	].slice(0, MAX_WORK_HISTORY_SIZE);

	writeStorage(STORAGE_KEYS.workHistory, JSON.stringify(nextHistory));

	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event(WORK_HISTORY_EVENT_NAME));
	}

	return nextHistory;
};
