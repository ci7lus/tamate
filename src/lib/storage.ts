import { STORAGE_KEYS } from "../shared/constants";

const canUseStorage = () =>
	typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export { STORAGE_KEYS };

export const readStorage = (key: string) => {
	if (!canUseStorage()) {
		return null;
	}

	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
};

export const writeStorage = (key: string, value: string) => {
	if (!canUseStorage()) {
		return;
	}

	try {
		window.localStorage.setItem(key, value);
	} catch {
		return;
	}
};

export const removeStorage = (key: string) => {
	if (!canUseStorage()) {
		return;
	}

	try {
		window.localStorage.removeItem(key);
	} catch {
		return;
	}
};

export const isStandaloneDisplayMode = () => {
	if (typeof window === "undefined") {
		return false;
	}

	const standaloneNavigator = navigator as Navigator & { standalone?: boolean };

	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		standaloneNavigator.standalone === true
	);
};
