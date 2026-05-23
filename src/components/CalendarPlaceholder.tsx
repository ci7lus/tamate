const placeholderStripStyle = {
	backgroundImage:
		"linear-gradient(90deg, rgba(255, 139, 70, 0.7), rgba(14, 165, 233, 0.3), rgb(55, 65, 81))",
} as const;

export function CalendarPlaceholder() {
	return (
		<div
			className="mt-4 grid gap-3 rounded-2xl border border-gray-800 bg-gray-950/80 p-4"
			style={{ minHeight: 180 }}
		>
			<div className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-300">
				today
			</div>
			<div
				className="h-5 w-full animate-pulse rounded-full"
				style={placeholderStripStyle}
			/>
			<div
				className="h-5 w-[62%] animate-pulse rounded-full"
				style={{ ...placeholderStripStyle, animationDelay: "180ms" }}
			/>
			<div
				className="h-5 w-full animate-pulse rounded-full"
				style={placeholderStripStyle}
			/>
		</div>
	);
}
