import {
	startTransition,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import useSWR from "swr";

import { searchWorksByTitle } from "../lib/annict";
import { getErrorMessage } from "../lib/errors";
import { SEARCH_TERM_EVENT_NAME } from "../shared/search";
import {
	readWorkHistory,
	recordVisitedWork,
	WORK_HISTORY_EVENT_NAME,
	type WorkHistoryEntry,
} from "../shared/workHistory";
import { useAnnictSession } from "./AnnictSessionProvider";

function GlobalSearch() {
	const navigate = useNavigate();
	const { accessToken, isLoading } = useAnnictSession();
	const [term, setTerm] = useState("");
	const [isMenuVisible, setIsMenuVisible] = useState(false);
	const [workHistory, setWorkHistory] =
		useState<WorkHistoryEntry[]>(readWorkHistory);
	const deferredTerm = useDeferredValue(term.trim());
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(deferredTerm);

	useEffect(() => {
		const timerId = window.setTimeout(
			() => setDebouncedSearchTerm(deferredTerm),
			280,
		);
		return () => window.clearTimeout(timerId);
	}, [deferredTerm]);

	const {
		data: works,
		error: searchErrorRaw,
		isLoading: isSearching,
	} = useSWR(
		accessToken && debouncedSearchTerm.length >= 2
			? ["annict-search", accessToken, debouncedSearchTerm]
			: null,
		([, token, term]) => searchWorksByTitle(token, term),
		{
			keepPreviousData: true,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
		},
	);

	const searchError = searchErrorRaw ? getErrorMessage(searchErrorRaw) : null;
	const searchResults = [...(works ?? [])].sort(
		(left, right) => left.annictId - right.annictId,
	);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const searchRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (
			searchResults.length > 0 &&
			document.activeElement === inputRef.current
		) {
			setIsMenuVisible(true);
		}
	}, [searchResults]);

	useEffect(() => {
		const syncWorkHistory = () => setWorkHistory(readWorkHistory());

		window.addEventListener(WORK_HISTORY_EVENT_NAME, syncWorkHistory);
		window.addEventListener("storage", syncWorkHistory);

		return () => {
			window.removeEventListener(WORK_HISTORY_EVENT_NAME, syncWorkHistory);
			window.removeEventListener("storage", syncWorkHistory);
		};
	}, []);

	useEffect(() => {
		const closeMenu = (event: MouseEvent | TouchEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (searchRef.current?.contains(target)) {
				return;
			}

			setIsMenuVisible(false);
		};

		document.addEventListener("mousedown", closeMenu);
		document.addEventListener("touchstart", closeMenu);

		return () => {
			document.removeEventListener("mousedown", closeMenu);
			document.removeEventListener("touchstart", closeMenu);
		};
	}, []);

	useEffect(() => {
		const syncSearchTerm = (event: Event) => {
			const customEvent = event as CustomEvent<{
				focus?: boolean;
				openMenu?: boolean;
				term?: string;
			}>;
			const nextTerm = customEvent.detail?.term?.trim() ?? "";
			setTerm(nextTerm);
			setIsMenuVisible(customEvent.detail?.openMenu ?? true);

			if (customEvent.detail?.focus ?? true) {
				window.requestAnimationFrame(() => {
					inputRef.current?.focus({ preventScroll: true });
				});
			}
		};

		window.addEventListener(SEARCH_TERM_EVENT_NAME, syncSearchTerm);

		return () => {
			window.removeEventListener(SEARCH_TERM_EVENT_NAME, syncSearchTerm);
		};
	}, []);

	const moveToWork = (annictId: number, work?: WorkHistoryEntry) => {
		const visitedWork =
			work ?? workHistory.find((entry) => entry.annictId === annictId);
		if (visitedWork) {
			setWorkHistory(recordVisitedWork(visitedWork));
		}

		setIsMenuVisible(false);
		setTerm("");
		startTransition(() => {
			navigate(`/works/${annictId}`);
		});
	};

	const isDisabled = isLoading || !accessToken;
	return (
		<div className="relative min-w-0 flex-1 self-center" ref={searchRef}>
			<form
				className="flex min-w-0 items-center gap-3 max-[720px]:flex-col max-[720px]:items-stretch"
				onSubmit={(event) => {
					event.preventDefault();
					const trimmedTerm = term.trim();
					if (/^\d+$/.test(trimmedTerm)) {
						moveToWork(Number(trimmedTerm));
						return;
					}

					if (searchResults[0]) {
						moveToWork(searchResults[0].annictId, searchResults[0]);
					}
				}}
			>
				<div className="relative min-w-0 flex-1">
					<input
						aria-label="Annict作品検索"
						autoComplete="off"
						className="block w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 pr-11 text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-[#FF8B46] disabled:cursor-not-allowed disabled:opacity-50"
						disabled={isDisabled}
						ref={inputRef}
						onChange={(event) => setTerm(event.target.value)}
						onClick={() => setIsMenuVisible(true)}
						onFocus={() => {
							setWorkHistory(readWorkHistory());
							setIsMenuVisible(true);
						}}
						placeholder={"検索"}
						value={term}
					/>
					{term.length > 0 ? (
						<button
							aria-label="検索語をクリア"
							className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-gray-400 transition hover:bg-gray-800 hover:text-gray-100"
							onClick={() => {
								setTerm("");
								setIsMenuVisible(true);
								inputRef.current?.focus({ preventScroll: true });
							}}
							type="button"
						>
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								viewBox="0 0 24 24"
							>
								<path
									d="m6 6 12 12M18 6 6 18"
									stroke="currentColor"
									strokeLinecap="round"
									strokeWidth="2"
								/>
							</svg>
						</button>
					) : null}
				</div>
			</form>
			<div
				className={`absolute inset-x-0 top-full z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-800 shadow-2xl transition-all duration-150 ${
					isMenuVisible
						? "pointer-events-auto translate-y-0 opacity-100"
						: "pointer-events-none -translate-y-1.5 opacity-0"
				}`}
				role="listbox"
			>
				{isDisabled ? (
					<p className="w-full px-4 py-3 text-left text-sm text-gray-400">
						検索はAnnictログイン後に有効になります。
					</p>
				) : isSearching ? (
					<p className="w-full px-4 py-3 text-left text-sm text-gray-400">
						検索中です...
					</p>
				) : searchError ? (
					<p className="w-full px-4 py-3 text-left text-sm text-[#ffc29d]">
						{searchError}
					</p>
				) : term.trim().length === 0 ? (
					<div className="opacity-80">
						<p className="border-b border-gray-700 px-4 py-2 text-xs font-semibold text-gray-400">
							閲覧履歴
						</p>
						{workHistory.length > 0 ? (
							workHistory.map((work) => (
								<button
									className="flex w-full items-center justify-between gap-3 border-b border-gray-700 bg-transparent px-4 py-3 text-left text-sm text-gray-100 transition hover:bg-gray-700 last:border-b-0 max-[720px]:flex-col max-[720px]:items-stretch"
									key={work.annictId}
									onClick={() => moveToWork(work.annictId, work)}
									type="button"
								>
									<span className="font-medium text-gray-50">{work.title}</span>
									<span className="text-sm text-gray-400">
										#{work.annictId}
									</span>
								</button>
							))
						) : (
							<p className="w-full px-4 py-3 text-left text-sm text-gray-400">
								閲覧した作品はまだありません。
							</p>
						)}
					</div>
				) : deferredTerm.length < 2 ? (
					<p className="w-full px-4 py-3 text-left text-sm text-gray-400">
						2文字以上入力すると候補を表示します。
					</p>
				) : searchResults.length > 0 ? (
					<div>
						<p className="border-b border-gray-700 px-4 py-2 text-xs font-semibold text-gray-400">
							検索結果
						</p>
						{searchResults.map((work) => (
							<button
								className="flex w-full items-center justify-between gap-3 border-b border-gray-700 bg-transparent px-4 py-3 text-left text-sm text-gray-100 transition hover:bg-gray-700 last:border-b-0 max-[720px]:flex-col max-[720px]:items-stretch"
								key={work.annictId}
								onClick={() => moveToWork(work.annictId, work)}
								type="button"
							>
								<span className="font-medium text-gray-50">{work.title}</span>
								<span className="text-sm text-gray-400">#{work.annictId}</span>
							</button>
						))}
					</div>
				) : (
					<p className="w-full px-4 py-3 text-left text-sm text-gray-400">
						一致する作品が見つかりませんでした。
					</p>
				)}
			</div>
		</div>
	);
}

function AnnictAccountControl() {
	const { authError, authUrl, isLoading, login, logout, viewer } =
		useAnnictSession();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!viewer) {
			setIsMenuOpen(false);
			return;
		}

		const closeMenu = (event: MouseEvent | TouchEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (menuRef.current?.contains(target)) {
				return;
			}

			setIsMenuOpen(false);
		};

		document.addEventListener("mousedown", closeMenu);
		document.addEventListener("touchstart", closeMenu);

		return () => {
			document.removeEventListener("mousedown", closeMenu);
			document.removeEventListener("touchstart", closeMenu);
		};
	}, [viewer]);

	if (!viewer) {
		return (
			<div className="flex min-w-0 self-center flex-col items-end gap-3 max-[1279px]:items-start">
				<button
					className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#FF8B46] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#f07732] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isLoading || !authUrl}
					onClick={login}
					type="button"
				>
					Annictでログイン
				</button>
				{authError ? (
					<p className="text-sm text-[#ffc29d]">{authError}</p>
				) : null}
			</div>
		);
	}

	return (
		<div
			className="relative self-center justify-self-end leading-none"
			ref={menuRef}
		>
			<button
				aria-expanded={isMenuOpen}
				aria-label="アカウントメニュー"
				className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-gray-700 bg-gray-800 p-0 leading-none transition hover:bg-gray-700"
				onClick={() => setIsMenuOpen((current) => !current)}
				type="button"
			>
				{viewer.avatarUrl ? (
					<img
						alt={`${viewer.name} avatar`}
						className="h-12 w-12 rounded-full border border-gray-700 bg-gray-800 object-cover"
						src={viewer.avatarUrl}
					/>
				) : (
					<div className="grid h-12 w-12 place-items-center rounded-full border border-gray-700 bg-[#FF8B46] text-white">
						{viewer.name.slice(0, 1)}
					</div>
				)}
			</button>
			<div
				className={`absolute right-0 top-full z-30 mt-3 w-72 rounded-2xl border border-gray-700 bg-gray-900 p-4 shadow-2xl transition-all duration-150 ${
					isMenuOpen
						? "pointer-events-auto translate-y-0 opacity-100"
						: "pointer-events-none -translate-y-1.5 opacity-0"
				}`}
			>
				<div className="flex flex-wrap items-center gap-3 max-[720px]:flex-col max-[720px]:items-start">
					{viewer.avatarUrl ? (
						<img
							alt={`${viewer.name} avatar`}
							className="h-12 w-12 rounded-full border border-gray-700 bg-gray-800 object-cover"
							src={viewer.avatarUrl}
						/>
					) : (
						<div className="grid h-12 w-12 place-items-center rounded-full border border-gray-700 bg-[#FF8B46] text-white">
							{viewer.name.slice(0, 1)}
						</div>
					)}
					<p className="font-medium text-gray-50">
						{viewer.name} @{viewer.username}
					</p>
				</div>
				<div className="mt-3 flex flex-col gap-3">
					<button
						className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[#FF8B46]/40 bg-[#FF8B46]/10 px-5 py-3 text-sm font-semibold text-gray-100 transition hover:bg-[#FF8B46]/20"
						onClick={() => {
							setIsMenuOpen(false);
							window.location.reload();
						}}
						type="button"
					>
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							viewBox="0 0 24 24"
						>
							<path
								d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4m-4 5a8 8 0 0 0 14.9 4M20 20v-4h-4"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="1.8"
							/>
						</svg>
						アプリを再読み込み
					</button>
					<button
						className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-gray-700 bg-gray-800 px-5 py-3 text-sm font-semibold text-gray-100 transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
						onClick={() => {
							setIsMenuOpen(false);
							logout();
						}}
						type="button"
					>
						ログアウト
					</button>
					{authError ? (
						<p className="text-sm text-[#ffc29d]">{authError}</p>
					) : null}
				</div>
			</div>
		</div>
	);
}

export function AppHeader() {
	return (
		<header className="sticky top-3 z-50 flex items-center justify-center gap-3 rounded-3xl border border-gray-800 bg-gray-900/95 p-4 shadow-2xl backdrop-blur max-[720px]:rounded-2xl max-[720px]:p-4">
			<Link
				aria-label="TAMATE"
				className="shrink-0 overflow-hidden rounded-2xl border border-[#FF8B46]/30 bg-[#FF8B46]/10 transition hover:border-[#FF8B46]/60"
				to="/"
			>
				<img
					alt="TAMATE"
					className="h-11 w-11 object-cover"
					src="/tamate.png"
				/>
			</Link>
			<GlobalSearch />
			<AnnictAccountControl />
		</header>
	);
}
