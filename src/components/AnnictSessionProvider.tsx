import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useState,
} from "react";

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
	const [viewer, setViewer] = useState<AnnictViewer | null>(null);
	const [isLoading, setIsLoading] = useState(Boolean(accessToken));
	const [authError, setAuthError] = useState<string | null>(null);
	const authUrl = buildAnnictAuthorizationUrl();

	useEffect(() => {
		if (!accessToken) {
			setViewer(null);
			setIsLoading(false);
			return;
		}

		let isActive = true;
		setIsLoading(true);
		setAuthError(null);

		fetchAnnictViewer(accessToken)
			.then((nextViewer) => {
				if (!isActive) {
					return;
				}

				setViewer(nextViewer);
			})
			.catch((error) => {
				if (!isActive) {
					return;
				}

				if (isUnauthorizedError(error)) {
					removeStorage(STORAGE_KEYS.annictAccessToken);
					setAccessToken(null);
					setViewer(null);
					setAuthError(
						"Annictのセッションが切れています。もう一度ログインしてください。",
					);
					return;
				}

				setAuthError(getErrorMessage(error));
			})
			.finally(() => {
				if (!isActive) {
					return;
				}

				setIsLoading(false);
			});

		return () => {
			isActive = false;
		};
	}, [accessToken]);

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
		setViewer(null);
		setAuthError(null);
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
				viewer,
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
