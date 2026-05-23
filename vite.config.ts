import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss(),
		VitePWA({
			devOptions: {
				enabled: true,
			},
			includeAssets: ["tamate.png"],
			manifest: {
				background_color: "#FF8B46",
				description: "由来でして",
				display: "standalone",
				icons: [
					{
						sizes: "192x192",
						src: "/tamate-192.png",
						type: "image/png",
					},
					{
						sizes: "512x512",
						src: "/tamate.png",
						type: "image/png",
					},
					{
						purpose: "maskable",
						sizes: "512x512",
						src: "/tamate.png",
						type: "image/png",
					},
				],
				name: "tamate",
				short_name: "tamate",
				start_url: "/",
				theme_color: "#FF8B46",
			},
			registerType: "autoUpdate",
			workbox: {
				cleanupOutdatedCaches: true,
				globPatterns: ["**/*.{js,png,svg,ico}"],
				navigateFallbackDenylist: [/^\/\.netlify\/functions\//],
			},
		}),
	],
});
