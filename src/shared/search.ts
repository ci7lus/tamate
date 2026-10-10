export const SEARCH_TERM_EVENT_NAME = "tamate:set-search-term";

export const requestSearchTerm = (
	term: string,
	options: { focus?: boolean; openMenu?: boolean } = {},
) => {
	if (typeof window === "undefined") {
		return;
	}

	window.dispatchEvent(
		new CustomEvent(SEARCH_TERM_EVENT_NAME, {
			detail: {
				focus: options.focus ?? true,
				openMenu: options.openMenu ?? true,
				term,
			},
		}),
	);
};
