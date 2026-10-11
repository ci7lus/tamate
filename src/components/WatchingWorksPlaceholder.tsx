function PlaceholderSection({
	count,
	label,
	showProgramDetails,
}: {
	count: number;
	label: string;
	showProgramDetails: boolean;
}) {
	const skeletonKeys = Array.from(
		{ length: count },
		(_, index) => `${label}-${index}`,
	);

	return (
		<section>
			<div className="mb-2 flex items-center justify-between">
				<p className="text-sm font-semibold text-gray-200">{label}</p>
				<span
					aria-hidden="true"
					className="h-3 w-10 animate-pulse rounded bg-gray-700"
				/>
			</div>
			<div className="grid min-w-0 gap-2">
				{skeletonKeys.map((skeletonKey) => (
					<div
						aria-hidden="true"
						className="flex min-w-0 w-full animate-pulse flex-col gap-1 rounded-2xl border border-[#FF8B46]/30 bg-[#FF8B46]/10 px-3 py-2"
						key={skeletonKey}
					>
						<div className="flex min-w-0 w-full items-center justify-between gap-2">
							<div className="min-w-0 flex-1 space-y-2">
								<div className="h-3 w-2/3 rounded bg-[#FF8B46]/25" />
								<div className="h-2.5 w-1/2 rounded bg-gray-700" />
							</div>
							{showProgramDetails ? (
								<div className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1">
									<div className="h-2.5 w-12 rounded bg-gray-700" />
									<div className="h-2.5 w-8 rounded bg-[#FF8B46]/25" />
								</div>
							) : null}
						</div>
						<div className="h-1.5 w-full rounded-full bg-gray-700" />
					</div>
				))}
			</div>
		</section>
	);
}

export function WatchingWorksPlaceholder({
	inScheduleCount,
	outOfScheduleCount,
}: {
	inScheduleCount: number;
	outOfScheduleCount: number;
}) {
	return (
		<div
			aria-label="Annictの視聴中作品を読み込み中"
			className="min-w-0 space-y-5"
			role="status"
		>
			<PlaceholderSection
				count={inScheduleCount}
				label="番組表内"
				showProgramDetails
			/>
			<PlaceholderSection
				count={outOfScheduleCount}
				label="番組表外"
				showProgramDetails={false}
			/>
		</div>
	);
}
