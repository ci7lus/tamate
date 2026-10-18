import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import useSWRInfinite from "swr/infinite";

import {
	type AnnictRatingState,
	type AnnictStatusState,
	createAnnictRecord,
	fetchWorkByAnnictId,
	RATING_OPTIONS,
	SEASON_LABELS,
	STATUS_OPTIONS,
	updateAnnictWorkStatus,
} from "../lib/annict";
import { getErrorMessage } from "../lib/errors";
import { readWorkMappings, removeWorkMapping } from "../lib/workMappings";
import { recordVisitedWork } from "../shared/workHistory";
import { useAnnictSession } from "./AnnictSessionProvider";

export function WorkPage() {
	const { annictId } = useParams();
	const parsedAnnictId = Number(annictId);
	const [workMappings, setWorkMappings] = useState(readWorkMappings);
	const { accessToken, login } = useAnnictSession();
	const recordedVisitId = useRef<number | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isRecording, setIsRecording] = useState(false);
	const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
	const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
		null,
	);
	const [comment, setComment] = useState("");
	const [rating, setRating] = useState<AnnictRatingState | null>(null);
	const [shareFacebook, setShareFacebook] = useState(false);
	const [watchStatus, setWatchStatus] = useState<AnnictStatusState>("NO_STATE");

	const episodeListRef = useRef<HTMLDivElement>(null);
	const episodeSentinelRef = useRef<HTMLDivElement>(null);
	const {
		data: workPages,
		error: workErrorRaw,
		isLoading,
		isValidating,
		size,
		setSize,
		mutate: mutateWork,
	} = useSWRInfinite(
		(
			pageIndex,
			previousPage: Awaited<ReturnType<typeof fetchWorkByAnnictId>>,
		) => {
			if (
				!accessToken ||
				!Number.isInteger(parsedAnnictId) ||
				parsedAnnictId <= 0
			)
				return null;
			if (
				pageIndex > 0 &&
				(!previousPage?.episodesPageInfo.hasNextPage ||
					!previousPage.episodesPageInfo.endCursor)
			)
				return null;
			return [
				"annict-work-episodes-v1",
				accessToken,
				parsedAnnictId,
				pageIndex === 0 ? null : previousPage?.episodesPageInfo.endCursor,
			] as const;
		},
		([, token, id, after]) => fetchWorkByAnnictId(token, id, after),
		{
			persistSize: false,
			revalidateFirstPage: false,
			revalidateIfStale: false,
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			shouldRetryOnError: false,
		},
	);
	const firstPage = workPages?.[0];
	const work = firstPage
		? {
				...firstPage,
				episodes: workPages?.flatMap((page) => page?.episodes ?? []) ?? [],
			}
		: firstPage;
	const lastPage = workPages?.at(-1);
	const hasMoreEpisodes =
		!!lastPage?.episodesPageInfo.hasNextPage &&
		!!lastPage.episodesPageInfo.endCursor;
	const isLoadingEpisodes =
		isValidating || (size > (workPages?.length ?? 0) && !workErrorRaw);

	useEffect(() => {
		const sentinel = episodeSentinelRef.current;
		const root = episodeListRef.current;
		if (
			!sentinel ||
			!root ||
			!hasMoreEpisodes ||
			isLoadingEpisodes ||
			workErrorRaw
		)
			return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					observer.disconnect();
					void setSize((currentSize) => currentSize + 1);
				}
			},
			{ root },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMoreEpisodes, isLoadingEpisodes, workErrorRaw, setSize]);

	const workError = workErrorRaw ? getErrorMessage(workErrorRaw) : null;

	useEffect(() => {
		if (!work || recordedVisitId.current === work.annictId) {
			return;
		}

		recordedVisitId.current = work.annictId;
		recordVisitedWork({
			annictId: work.annictId,
			imageUrl: work.imageUrl,
			title: work.title,
		});
	}, [work]);

	useEffect(() => {
		if (!work) {
			return;
		}

		setErrorMessage(null);
		setWatchStatus(work.viewerStatusState);
		setSelectedEpisodeId((currentEpisodeId) => {
			if (
				currentEpisodeId &&
				work.episodes.some((episode) => episode.id === currentEpisodeId)
			) {
				return currentEpisodeId;
			}

			const mayNextEpisode = work.episodes.find(
				(episode) => !episode.viewerDidTrack,
			);
			return mayNextEpisode
				? mayNextEpisode.id
				: (work.episodes?.[0]?.id ?? null);
		});
	}, [work]);

	useEffect(() => {
		void selectedEpisodeId;

		setComment("");
		setRating(null);
	}, [selectedEpisodeId]);

	const mappingControls = workMappings
		.filter((entry) => entry.annictId === parsedAnnictId)
		.map((entry) => (
			<div
				key={entry.titleId}
				className="flex items-center justify-between gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300"
			>
				<span>番組表「{entry.title}」の紐づけ先</span>
				<button
					type="button"
					className="shrink-0 rounded-full border border-gray-700 px-3 py-2 hover:bg-gray-800"
					onClick={() => setWorkMappings(removeWorkMapping(entry.titleId))}
				>
					紐づけ解除
				</button>
			</div>
		));

	if (!Number.isInteger(parsedAnnictId) || parsedAnnictId <= 0) {
		return (
			<div className="flex flex-col gap-3">
				{mappingControls}
				<section className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4">
					<h1 className="m-0 text-4xl font-semibold leading-tight text-gray-50 max-[1279px]:max-w-none">
						不正な作品IDです
					</h1>
					<p>URL の Annict ID を確認してください。</p>
				</section>
			</div>
		);
	}

	if (!accessToken) {
		return (
			<div className="flex flex-col gap-3">
				{mappingControls}
				<section className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4">
					<h1 className="m-0 text-4xl font-semibold leading-tight text-gray-50 max-[1279px]:max-w-none">
						/works/{parsedAnnictId}
					</h1>
					<p>作品ページの取得と記録には Annict ログインが必要です。</p>
					<button
						className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#FF8B46] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#f07732] disabled:cursor-not-allowed disabled:opacity-50 mt-4"
						onClick={login}
						type="button"
					>
						Annictでログイン
					</button>
				</section>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex flex-col gap-3">
				{mappingControls}
				<section className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4">
					<h1 className="m-0 text-4xl font-semibold leading-tight text-gray-50 max-[1279px]:max-w-none">
						作品情報を読み込み中です...
					</h1>
				</section>
			</div>
		);
	}

	if (!work) {
		return (
			<div className="flex flex-col gap-3">
				{mappingControls}
				<section className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4">
					<h1 className="m-0 text-4xl font-semibold leading-tight text-gray-50 max-[1279px]:max-w-none">
						作品を表示できませんでした
					</h1>
					<p>
						{work === null
							? "対象の作品が見つかりませんでした。"
							: (workError ??
								errorMessage ??
								"Annictから作品情報を取得できませんでした。")}
					</p>
				</section>
			</div>
		);
	}

	const selectedEpisode =
		work.episodes.find((episode) => episode.id === selectedEpisodeId) ?? null;
	const seasonLabel =
		work.seasonName && work.seasonYear
			? `${work.seasonYear}年${SEASON_LABELS[work.seasonName]}`
			: "シーズン情報なし";

	return (
		<div className="flex flex-col gap-3">
			{mappingControls}
			<section className="group relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4 xl:flex xl:gap-6">
				{work.imageUrl ? (
					<div className="absolute inset-0 z-0">
						<div className="absolute inset-0 bg-linear-to-r from-gray-900/90 via-gray-950/70 to-transparent z-10"></div>
						<img
							src={work.imageUrl}
							alt={work.title}
							className="absolute right-0 h-full w-2/3 object-cover object-center"
						/>
					</div>
				) : null}
				<div className="relative flex flex-col max-[1279px]:mt-4 z-20">
					<h1 className="m-0 text-4xl font-semibold leading-tight text-gray-50 max-[1279px]:max-w-none">
						{work.title}
					</h1>
					{work.titleKana ? (
						<p className="text-sm text-gray-400 mt-1">{work.titleKana}</p>
					) : null}
					<div className="flex flex-wrap gap-3 mt-2">
						<span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
							{seasonLabel}
						</span>
						<span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
							{work.media ?? "media unknown"}
						</span>
						<span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
							全{work.episodeCount}話
						</span>
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
						<a
							className="text-sky-300 underline underline-offset-4 transition hover:text-sky-200"
							href={`https://annict.com/works/${work.annictId}`}
							rel="noopener"
							target="_blank"
						>
							Annictで開く
						</a>
						{work.syobocalTid ? (
							<a
								className="text-sky-300 underline underline-offset-4 transition hover:text-sky-200"
								href={`https://cal.syoboi.jp/tid/${work.syobocalTid}`}
								rel="noopener"
								target="_blank"
							>
								しょぼかるで開く
							</a>
						) : null}
						{work.officialSiteUrl ? (
							<a
								className="text-sky-300 underline underline-offset-4 transition hover:text-sky-200"
								href={work.officialSiteUrl}
								rel="noreferrer"
								target="_blank"
							>
								公式サイト
							</a>
						) : null}
						{work.twitterHashtag ? (
							<a
								className="text-sky-300 underline underline-offset-4 transition hover:text-sky-200"
								href={`https://x.com/hashtag/${encodeURIComponent(work.twitterHashtag)}`}
								rel="noreferrer"
								target="_blank"
							>
								#{work.twitterHashtag}
							</a>
						) : null}
					</div>
					<label className="flex flex-col gap-3 mt-4">
						<span className="text-sm font-medium text-gray-300">
							視聴ステータス
						</span>
						<select
							className="block w-full rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-[#FF8B46]"
							disabled={isUpdatingStatus}
							onChange={async (event) => {
								if (!accessToken) {
									return;
								}

								const nextStatus = event.target.value as AnnictStatusState;
								setWatchStatus(nextStatus);
								setIsUpdatingStatus(true);
								setErrorMessage(null);

								try {
									await updateAnnictWorkStatus(
										accessToken,
										work.id,
										nextStatus,
									);
									void mutateWork(
										(currentData) =>
											currentData?.map((page) =>
												page
													? { ...page, viewerStatusState: nextStatus }
													: page,
											),
										{ revalidate: false },
									);
								} catch (error) {
									setWatchStatus(work.viewerStatusState);
									setErrorMessage(getErrorMessage(error));
								} finally {
									setIsUpdatingStatus(false);
								}
							}}
							value={watchStatus}
						>
							{STATUS_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{errorMessage ? (
						<p className="text-sm text-[#ffc29d]">{errorMessage}</p>
					) : null}
				</div>
			</section>

			<section className="grid gap-3 md:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
				<article
					className="order-2 relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4 md:order-1"
					style={{ minHeight: 420 }}
				>
					<div
						ref={episodeListRef}
						className="grid gap-2 overflow-auto pr-1"
						style={{ maxHeight: 560 }}
					>
						{work.episodes.map((episode) => (
							<button
								className={`flex w-full items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-800 px-4 py-3 text-left text-sm text-gray-100 transition hover:bg-gray-700 max-[720px]:items-stretch ${
									selectedEpisodeId === episode.id
										? "border-[#FF8B46] bg-gray-700"
										: ""
								} ${episode.viewerDidTrack ? "text-gray-500" : ""}`}
								key={episode.id}
								onClick={() => setSelectedEpisodeId(episode.id)}
								type="button"
							>
								<span>
									{episode.numberText ?? episode.number ?? "話数不明"}{" "}
									{episode.title}
								</span>
								<span>{episode.viewerRecordsCount}</span>
							</button>
						))}
						<div ref={episodeSentinelRef} className="min-h-px" />
						{isLoadingEpisodes ? (
							<p role="status" className="text-sm text-gray-400">
								エピソードを読み込み中です...
							</p>
						) : null}
						{workError && work ? (
							<div className="text-sm text-[#ffc29d]">
								<p>{workError}</p>
								<button
									type="button"
									className="mt-2 rounded-full border border-gray-700 px-3 py-2"
									onClick={() => void mutateWork()}
								>
									再試行
								</button>
							</div>
						) : null}
					</div>
				</article>
				{selectedEpisode && (
					<article
						className="order-1 relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4 md:order-2"
						style={{ minHeight: 420 }}
					>
						{selectedEpisode ? (
							<form
								className="flex flex-col gap-3"
								onSubmit={async (event) => {
									event.preventDefault();
									if (!accessToken || !selectedEpisode) {
										return;
									}

									setIsRecording(true);
									setErrorMessage(null);

									try {
										await createAnnictRecord(accessToken, {
											comment: comment.trim() || null,
											episodeId: selectedEpisode.id,
											ratingState: rating,
											shareFacebook,
										});
										setComment("");
										setRating(null);
										const selectedEpisodeIndex = work.episodes.findIndex(
											(episode) => episode.id === selectedEpisode.id,
										);
										const nextUnrecordedEpisode = work.episodes
											.slice(selectedEpisodeIndex + 1)
											.find((episode) => episode.viewerRecordsCount === 0);
										if (nextUnrecordedEpisode) {
											setSelectedEpisodeId(nextUnrecordedEpisode.id);
										}
										void mutateWork();
									} catch (error) {
										setErrorMessage(getErrorMessage(error));
									} finally {
										setIsRecording(false);
									}
								}}
							>
								<a
									href={`https://annict.com/works/${work.annictId}/episodes/${selectedEpisode.annictId}`}
									rel="noopener"
									target="_blank"
								>
									<h2 className="m-0 text-2xl font-semibold text-gray-50">
										{selectedEpisode.numberText ??
											selectedEpisode.number ??
											"話数不明"}{" "}
										{selectedEpisode.title}
									</h2>
								</a>
								<p className="text-sm text-gray-400">
									視聴回数: {selectedEpisode.viewerRecordsCount}回
								</p>
								<div className="flex flex-wrap">
									{RATING_OPTIONS.map((option, index) => (
										<button
											aria-pressed={rating === option.value}
											className={`border border-gray-700 px-4 py-2 text-sm text-gray-100 transition ${
												rating === option.value
													? `border-[#FF8B46] text-white ${
															option.value === "BAD"
																? "bg-gray-400"
																: option.value === "AVERAGE"
																	? "bg-orange-400"
																	: option.value === "GOOD"
																		? "bg-green-400"
																		: "bg-blue-400"
														}`
													: ""
											} ${index === 0 ? "rounded-l" : ""} ${index === RATING_OPTIONS.length - 1 ? "rounded-r" : ""}`}
											key={option.value}
											onClick={() => {
												setRating((currentRating) =>
													currentRating === option.value ? null : option.value,
												);
											}}
											type="button"
										>
											{option.label}
										</button>
									))}
								</div>
								<textarea
									className="block w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-gray-100 outline-none transition placeholder:text-gray-500 focus:border-[#FF8B46]"
									onChange={(event) => setComment(event.target.value)}
									placeholder="感想を入力（省略可）"
									rows={4}
									style={{ minHeight: 140 }}
									value={comment}
								/>
								<label className="flex items-center gap-2 text-sm text-gray-300">
									<input
										className="accent-[#FF8B46]"
										checked={shareFacebook}
										onChange={() => setShareFacebook((current) => !current)}
										type="checkbox"
									/>
									Facebookへ共有する
								</label>
								<button
									className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#FF8B46] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#f07732] disabled:cursor-not-allowed disabled:opacity-50"
									disabled={isRecording}
									type="submit"
								>
									{isRecording ? "記録中..." : "記録する"}
								</button>
							</form>
						) : (
							<div
								className="grid place-items-center rounded-2xl border border-dashed border-gray-700 bg-gray-950/80 p-6 text-center text-sm text-gray-400"
								style={{ minHeight: 220 }}
							>
								<p>
									右のエピソード一覧から対象話数を選ぶと記録フォームが開きます。
								</p>
							</div>
						)}
					</article>
				)}
			</section>
		</div>
	);
}
