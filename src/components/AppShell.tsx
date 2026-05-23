import { Navigate, Route, Routes } from "react-router-dom";

import { AppHeader } from "./AppHeader";
import { HomePage } from "./HomePage";
import { RouteMemory } from "./RouteMemory";
import { WorkPage } from "./WorkPage";

export function AppShell() {
	return (
		<div className="flex min-h-screen flex-col gap-6 bg-[linear-gradient(180deg,rgba(17,24,39,0.96),rgba(3,7,18,1))] p-6 font-sans leading-8 text-gray-100 antialiased max-[720px]:p-4">
			<RouteMemory />
			<AppHeader />
			<main className="flex flex-col gap-3 leading-relaxed">
				<Routes>
					<Route element={<HomePage />} path="/" />
					<Route element={<WorkPage />} path="/works/:annictId" />
					<Route element={<Navigate replace to="/" />} path="*" />
				</Routes>
			</main>
		</div>
	);
}
