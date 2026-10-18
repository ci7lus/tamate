import { readStorage, STORAGE_KEYS, writeStorage } from "./storage";

export type WorkMapping = {
	titleId: number;
	title: string;
	annictId: number;
};

export const readWorkMappings = (): WorkMapping[] => {
	try {
		const value: unknown = JSON.parse(
			readStorage(STORAGE_KEYS.workMappings) ?? "[]",
		);
		if (!Array.isArray(value)) return [];
		return value.filter(
			(entry): entry is WorkMapping =>
				typeof entry === "object" &&
				entry !== null &&
				"titleId" in entry &&
				Number.isSafeInteger(entry.titleId) &&
				entry.titleId > 0 &&
				"annictId" in entry &&
				Number.isSafeInteger(entry.annictId) &&
				entry.annictId > 0 &&
				"title" in entry &&
				typeof entry.title === "string",
		);
	} catch {
		return [];
	}
};

export const saveWorkMapping = (mapping: WorkMapping) => {
	const mappings = readWorkMappings().filter(
		(entry) => entry.titleId !== mapping.titleId,
	);
	writeStorage(
		STORAGE_KEYS.workMappings,
		JSON.stringify([...mappings, mapping]),
	);
};

export const removeWorkMapping = (titleId: number) => {
	const mappings = readWorkMappings().filter(
		(entry) => entry.titleId !== titleId,
	);
	writeStorage(STORAGE_KEYS.workMappings, JSON.stringify(mappings));
	return mappings;
};
