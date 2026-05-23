import {
	startTransition,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";

import type { AnnictSearchWork } from "../lib/annict";
import { searchWorksByTitle } from "../lib/annict";
import { getErrorMessage } from "../lib/errors";
import { useAnnictSession } from "./AnnictSessionProvider";

function GlobalSearch() {
	const navigate = useNavigate();
	const { accessToken, isLoading } = useAnnictSession();
	const [term, setTerm] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isMenuVisible, setIsMenuVisible] = useState(false);
	const [isSearching, setIsSearching] = useState(false);
	const [works, setWorks] = useState<AnnictSearchWork[]>([]);
	const deferredTerm = useDeferredValue(term.trim());
	const searchRef = useRef<HTMLDivElement | null>(null);

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
		if (!accessToken) {
			setWorks([]);
			setIsSearching(false);
			setErrorMessage(null);
			return;
		}

		if (deferredTerm.length < 2) {
			setWorks([]);
			setIsSearching(false);
			setErrorMessage(null);
			return;
		}

		let isActive = true;
		setIsSearching(true);
		setErrorMessage(null);

		const timerId = window.setTimeout(() => {
			searchWorksByTitle(accessToken, deferredTerm)
				.then((result) => {
					if (!isActive) {
						return;
					}

					setWorks(result);
					setIsMenuVisible(true);
				})
				.catch((error) => {
					if (!isActive) {
						return;
					}

					setWorks([]);
					setErrorMessage(getErrorMessage(error));
					setIsMenuVisible(true);
				})
				.finally(() => {
					if (!isActive) {
						return;
					}

					setIsSearching(false);
				});
		}, 280);

		return () => {
			isActive = false;
			window.clearTimeout(timerId);
		};
	}, [accessToken, deferredTerm]);

	const moveToWork = (annictId: number) => {
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

					if (works[0]) {
						moveToWork(works[0].annictId);
					}
				}}
			>
				<input
					aria-label="Annict作品検索"
					autoComplete="off"
					className="block w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-[#FF8B46] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isDisabled}
					onChange={(event) => setTerm(event.target.value)}
					onClick={() => setIsMenuVisible(true)}
					onFocus={() => setIsMenuVisible(true)}
					placeholder={"検索"}
					value={term}
				/>
			</form>
			<div
				className={`absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-gray-700 bg-gray-800 shadow-2xl transition-all duration-150 ${
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
				) : errorMessage ? (
					<p className="w-full px-4 py-3 text-left text-sm text-[#ffc29d]">
						{errorMessage}
					</p>
				) : deferredTerm.length < 2 ? (
					<p className="w-full px-4 py-3 text-left text-sm text-gray-400">
						2文字以上入力すると候補を表示します。
					</p>
				) : works.length > 0 ? (
					works.map((work) => (
						<button
							className="flex w-full items-center justify-between gap-3 border-b border-gray-700 bg-transparent px-4 py-3 text-left text-sm text-gray-100 transition hover:bg-gray-700 last:border-b-0 max-[720px]:flex-col max-[720px]:items-stretch"
							key={work.annictId}
							onClick={() => moveToWork(work.annictId)}
							type="button"
						>
							<span className="font-medium text-gray-50">{work.title}</span>
							<span className="text-sm text-gray-400">#{work.annictId}</span>
						</button>
					))
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
