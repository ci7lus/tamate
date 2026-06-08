import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useState,
} from "react";
import useSWR, { mutate } from "swr";

import {
	type AnnictViewer,
	buildAnnictAuthorizationUrl,
	fetchAnnictViewer,
} from "../lib/annict";
import { getErrorMessage, isUnauthorizedError } from "../lib/errors";
import {
	readStorage,
	removeStorage,
	STORAGE_KEYS,
	writeStorage,
} from "../lib/storage";

type AnnictSessionContextValue = {
	accessToken: string | null;
	authError: string | null;
	authUrl: string | null;
	isLoading: boolean;
	login: () => void;
	logout: () => void;
	viewer: AnnictViewer | null;
};

const AnnictSessionContext = createContext<AnnictSessionContextValue | null>(
	null,
);

function AnnictSessionProvider({ children }: PropsWithChildren) {
	const [accessToken, setAccessToken] = useState<string | null>(() =>
		readStorage(STORAGE_KEYS.annictAccessToken),
	);
	const [authError, setAuthError] = useState<string | null>(null);
	const authUrl = buildAnnictAuthorizationUrl();

	const {
		data: viewer,
		error: viewerErrorRaw,
		isLoading,
	} = useSWR(
		accessToken ? ["annict-viewer", accessToken] : null,
		([, token]) => fetchAnnictViewer(token),
		{
			errorRetryCount: 0,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
		},
	);

	useEffect(() => {
		if (!viewerErrorRaw) {
			return;
		}

		if (isUnauthorizedError(viewerErrorRaw)) {
			removeStorage(STORAGE_KEYS.annictAccessToken);
			setAccessToken(null);
			setAuthError(
				"Annictのセッションが切れています。もう一度ログインしてください。",
			);
			return;
		}

		setAuthError(getErrorMessage(viewerErrorRaw));
	}, [viewerErrorRaw]);

	useEffect(() => {
		if (viewer) {
			setAuthError(null);
		}
	}, [viewer]);

	const login = () => {
		if (!authUrl) {
			setAuthError(
				"VITE_ANNICT_CLIENT_ID が未設定です。Netlifyの環境変数を確認してください。",
			);
			return;
		}

		writeStorage(
			STORAGE_KEYS.pendingAuthPath,
			`${window.location.pathname}${window.location.search}${window.location.hash}`,
		);
		window.location.assign(authUrl);
	};

	const logout = () => {
		removeStorage(STORAGE_KEYS.annictAccessToken);
		removeStorage(STORAGE_KEYS.pendingAuthPath);
		setAccessToken(null);
		setAuthError(null);
		void mutate(
			(key) => Array.isArray(key) && key[0] === "annict-viewer",
			undefined,
			{ revalidate: false },
		);
	};

	return (
		<AnnictSessionContext.Provider
			value={{
				accessToken,
				authError,
				authUrl,
				isLoading,
				login,
				logout,
				viewer: viewer ?? null,
			}}
		>
			{children}
		</AnnictSessionContext.Provider>
	);
}

function useAnnictSession() {
	const context = useContext(AnnictSessionContext);

	if (!context) {
		throw new Error("AnnictSessionProvider is required.");
	}

	return context;
}

export { AnnictSessionProvider, useAnnictSession };
