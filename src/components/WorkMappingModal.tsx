import {
	startTransition,
	useDeferredValue,
	useEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { SEASON_LABELS, searchWorksByTitle } from "../lib/annict";
import { getErrorMessage } from "../lib/errors";
import { saveWorkMapping } from "../lib/workMappings";
import { useAnnictSession } from "./AnnictSessionProvider";

export function WorkMappingModal({
	titleId,
	title,
	onClose,
}: {
	titleId: number;
	title: string;
	onClose: () => void;
}) {
	const { accessToken } = useAnnictSession();
	const navigate = useNavigate();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const hasAutoNavigated = useRef(false);
	const [term, setTerm] = useState(title.replace(/\s*\(\d+\)$/, "").trim());
	const deferredTerm = useDeferredValue(term.trim());
	const [searchTerm, setSearchTerm] = useState(deferredTerm);
	useEffect(() => {
		const timer = window.setTimeout(() => setSearchTerm(deferredTerm), 280);
		return () => window.clearTimeout(timer);
	}, [deferredTerm]);
	useEffect(() => {
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	const {
		data: works,
		error,
		isLoading,
	} = useSWR(
		accessToken && searchTerm.length >= 2
			? ["annict-search", accessToken, searchTerm]
			: null,
		([, token, query]) => searchWorksByTitle(token, query),
		{
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
		},
	);
	const currentDateParts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "numeric",
	}).formatToParts(new Date());
	const currentYear = Number(
		currentDateParts.find((part) => part.type === "year")?.value,
	);
	const currentMonth = Number(
		currentDateParts.find((part) => part.type === "month")?.value,
	);
	const currentSeason = ["WINTER", "SPRING", "SUMMER", "AUTUMN"][
		Math.floor((currentMonth - 1) / 3)
	];
	const isPending = term.trim() !== searchTerm || isLoading;
	useEffect(() => {
		if (
			!accessToken ||
			error ||
			isPending ||
			searchTerm.length < 2 ||
			works?.length !== 1 ||
			hasAutoNavigated.current
		) {
			return;
		}

		const work = works[0];
		hasAutoNavigated.current = true;
		saveWorkMapping({ titleId, title, annictId: work.annictId });
		onClose();
		startTransition(() => navigate(`/works/${work.annictId}`));
	}, [
		accessToken,
		error,
		isPending,
		searchTerm,
		works,
		titleId,
		title,
		onClose,
		navigate,
	]);
	return (
		<dialog
			ref={dialogRef}
			onCancel={onClose}
			aria-labelledby="work-mapping-title"
			className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-3xl border border-gray-700 bg-gray-900 p-4 leading-relaxed text-gray-100 shadow-2xl backdrop:bg-gray-950/75"
		>
			<div className="flex items-start justify-between gap-3">
				<h2 id="work-mapping-title" className="text-lg font-semibold">
					Annict作品を選択
				</h2>
				<button
					type="button"
					onClick={onClose}
					className="rounded-full border border-gray-700 px-3 py-2 text-sm"
				>
					閉じる
				</button>
			</div>
			<p className="mt-2 text-sm text-gray-300 [overflow-wrap:anywhere]">
				「{title}」の紐づけ先を選んでください。次回から選択した作品を開きます。
			</p>
			<label className="mt-4 block text-sm">
				作品名
				<input
					value={term}
					onChange={(event) => setTerm(event.target.value)}
					className="mt-1 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-base"
				/>
			</label>
			<p className="my-3 text-xs text-gray-400">
				放送時期が新しい順・最大100件
			</p>
			{searchTerm.length < 2 ? (
				<p className="text-sm text-gray-400">2文字以上入力してください。</p>
			) : isPending ? (
				<p role="status">検索中です...</p>
			) : error ? (
				<p role="alert" className="text-orange-300">
					{getErrorMessage(error)}
				</p>
			) : works?.length ? (
				<ul>
					{works.map((work) => {
						const isCurrentSeason =
							work.seasonYear === currentYear &&
							work.seasonName === currentSeason;
						return (
							<li key={work.annictId}>
								<button
									type="button"
									className={`grid w-full grid-cols-1 items-start gap-1 border-b border-gray-700 px-2 py-3 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3 ${isCurrentSeason ? "bg-[#FF8B46]/10 hover:bg-[#FF8B46]/20" : "hover:bg-gray-800"}`}
									onClick={() => {
										saveWorkMapping({
											titleId,
											title,
											annictId: work.annictId,
										});
										onClose();
										startTransition(() => navigate(`/works/${work.annictId}`));
									}}
								>
									<span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">
										{work.title}
										{isCurrentSeason ? (
											<span className="ml-2 inline-block rounded-full border border-[#FF8B46]/40 bg-[#FF8B46]/15 px-2 py-0.5 align-middle text-xs font-semibold text-[#FF8B46]">
												今期
											</span>
										) : null}
									</span>
									<span className="text-xs text-gray-400 sm:pt-1 sm:whitespace-nowrap">
										{work.seasonYear
											? `${work.seasonYear}年${work.seasonName ? SEASON_LABELS[work.seasonName] : ""}`
											: "放送時期未定"}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="text-sm text-gray-400">
					一致する作品が見つかりませんでした。作品名を変えて検索できます。
				</p>
			)}
		</dialog>
	);
}
