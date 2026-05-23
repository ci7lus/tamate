import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import {
	type AnnictRatingState,
	type AnnictStatusState,
	type AnnictWork,
	createAnnictRecord,
	fetchWorkByAnnictId,
	RATING_OPTIONS,
	SEASON_LABELS,
	STATUS_OPTIONS,
	updateAnnictWorkStatus,
} from "../lib/annict";
import { getErrorMessage } from "../lib/errors";
import { useAnnictSession } from "./AnnictSessionProvider";

export function WorkPage() {
	const { annictId } = useParams();
	const parsedAnnictId = Number(annictId);
	const { accessToken, login } = useAnnictSession();
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
		null,
	);
	const [comment, setComment] = useState("");
	const [rating, setRating] = useState<AnnictRatingState | null>(null);
	const [shareFacebook, setShareFacebook] = useState(false);
	const [watchStatus, setWatchStatus] = useState<AnnictStatusState>("NO_STATE");
	const [work, setWork] = useState<AnnictWork | null>(null);

	useEffect(() => {
		void reloadKey;

		if (
			!accessToken ||
			!Number.isInteger(parsedAnnictId) ||
			parsedAnnictId <= 0
		) {
			setWork(null);
			setIsLoading(false);
			return;
		}

		let isActive = true;
		setIsLoading(true);
		setErrorMessage(null);

		fetchWorkByAnnictId(accessToken, parsedAnnictId)
			.then((nextWork) => {
				if (!isActive) {
					return;
				}

				if (!nextWork) {
					setWork(null);
					setErrorMessage("対象の作品が見つかりませんでした。");
					return;
				}

				setWork(nextWork);
				setWatchStatus(nextWork.viewerStatusState);
				setSelectedEpisodeId((currentEpisodeId) => {
					if (
						currentEpisodeId &&
						nextWork.episodes.some((episode) => episode.id === currentEpisodeId)
					) {
						return currentEpisodeId;
					}

					return null;
				});
			})
			.catch((error) => {
				if (!isActive) {
					return;
				}

				setWork(null);
				setErrorMessage(getErrorMessage(error));
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
	}, [accessToken, parsedAnnictId, reloadKey]);

	useEffect(() => {
		void selectedEpisodeId;

		setComment("");
		setRating(null);
	}, [selectedEpisodeId]);

	if (!Number.isInteger(parsedAnnictId) || parsedAnnictId <= 0) {
		return (
			<div className="flex flex-col gap-3">
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
				<section className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4">
					<h1 className="m-0 text-4xl font-semibold leading-tight text-gray-50 max-[1279px]:max-w-none">
						作品を表示できませんでした
					</h1>
					<p>{errorMessage ?? "Annictから作品情報を取得できませんでした。"}</p>
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
			<section className="group relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4 xl:flex xl:flex-row xl:gap-6">
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
						<p className="text-sm text-gray-400">{work.titleKana}</p>
					) : null}
					<div className="flex flex-wrap gap-3 mt-2">
						<span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
							{seasonLabel}
						</span>
						<span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
							{work.media ?? "media unknown"}
						</span>
						<span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
							全{work.episodes.length}話
						</span>
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
						<a
							className="text-sky-300 underline underline-offset-4 transition hover:text-sky-200"
							href={`https://annict.com/works/${work.annictId}`}
							rel="noreferrer"
							target="_blank"
						>
							Annictで開く
						</a>
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
					{work.seriesList.length > 0 ? (
						<div className="flex flex-wrap gap-3">
							{work.seriesList.map((seriesName) => (
								<span
									className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300"
									key={seriesName}
								>
									{seriesName}
								</span>
							))}
						</div>
					) : null}
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
									setWork((currentWork) =>
										currentWork
											? { ...currentWork, viewerStatusState: nextStatus }
											: currentWork,
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

			<section className="grid gap-6 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
				<article
					className="relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4"
					style={{ minHeight: 420 }}
				>
					<div
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
								onClick={() => {
									setSelectedEpisodeId((currentEpisodeId) =>
										currentEpisodeId === episode.id ? null : episode.id,
									);
								}}
								type="button"
							>
								<span>
									{episode.numberText ?? episode.number ?? "話数不明"}{" "}
									{episode.title}
								</span>
								<span>{episode.viewerRecordsCount}</span>
							</button>
						))}
					</div>
				</article>
				{selectedEpisode && (
					<article
						className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl max-[720px]:rounded-2xl max-[720px]:p-4"
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
										setSelectedEpisodeId(null);
										setReloadKey((current) => current + 1);
									} catch (error) {
										setErrorMessage(getErrorMessage(error));
									} finally {
										setIsRecording(false);
									}
								}}
							>
								<div className="flex flex-col gap-3">
									<h2 className="m-0 text-2xl font-semibold text-gray-50">
										{selectedEpisode.numberText ??
											selectedEpisode.number ??
											"話数不明"}{" "}
										{selectedEpisode.title}
									</h2>
								</div>
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
