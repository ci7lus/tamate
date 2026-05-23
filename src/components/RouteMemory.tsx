import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
	isStandaloneDisplayMode,
	readStorage,
	STORAGE_KEYS,
	writeStorage,
} from "../lib/storage";

export function RouteMemory() {
	const location = useLocation();
	const navigate = useNavigate();
	const didInitializeRef = useRef(false);
	const suppressNextWriteRef = useRef(false);

	useEffect(() => {
		if (didInitializeRef.current) {
			return;
		}

		didInitializeRef.current = true;

		if (
			!isStandaloneDisplayMode() ||
			location.pathname !== "/" ||
			location.search !== "" ||
			location.hash !== ""
		) {
			return;
		}

		const lastVisitedPath = readStorage(STORAGE_KEYS.lastVisitedPath);
		if (!lastVisitedPath || lastVisitedPath === "/") {
			return;
		}

		suppressNextWriteRef.current = true;
		navigate(lastVisitedPath, { replace: true });
	}, [location.hash, location.pathname, location.search, navigate]);

	useEffect(() => {
		if (suppressNextWriteRef.current) {
			suppressNextWriteRef.current = false;
			return;
		}

		writeStorage(
			STORAGE_KEYS.lastVisitedPath,
			`${location.pathname}${location.search}${location.hash}`,
		);
	}, [location.hash, location.pathname, location.search]);

	return null;
}
