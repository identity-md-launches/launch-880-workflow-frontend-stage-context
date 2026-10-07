import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { loadRuntime } from "./config";
import { MossProvider } from "./context";
import { App } from "./App";
import "./styles.css";
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <main className="boot">
    <h1>moss</h1>
    <p role="status">Loading the deployment record…</p>
  </main>,
);
loadRuntime()
  .then((runtime) =>
    root.render(
      <WagmiProvider config={runtime.wagmi}>
        <QueryClientProvider client={new QueryClient()}>
          <MossProvider runtime={runtime}>
            <App />
          </MossProvider>
        </QueryClientProvider>
      </WagmiProvider>,
    ),
  )
  .catch((e) =>
    root.render(
      <main className="boot">
        <h1>Deployment unavailable</h1>
        <p role="alert">{e.message}</p>
        <button onClick={() => location.reload()}>Reload configuration</button>
      </main>,
    ),
  );
