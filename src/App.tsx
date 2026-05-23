import { AnnictSessionProvider } from "./components/AnnictSessionProvider";
import { AppShell } from "./components/AppShell";

function App() {
	return (
		<AnnictSessionProvider>
			<AppShell />
		</AnnictSessionProvider>
	);
}

export default App;
