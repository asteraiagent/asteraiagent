"use client";

import { ReactNode, useMemo } from "react";
import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { http } from "viem";
import { mainnet, arbitrum, polygon, base } from "wagmi/chains";

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  const queryClient = useMemo(() => new QueryClient(), []);

  const wagmiConfig = useMemo(
    () =>
      getDefaultConfig({
        appName: "Aster AI Agent",
        projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
        chains: [mainnet, arbitrum, polygon, base],
        transports: {
          [mainnet.id]: http(),
          [arbitrum.id]: http(),
          [polygon.id]: http(),
          [base.id]: http(),
        },
      }),
    []
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#f2b46d",
            accentColorForeground: "#0e0e0e",
            borderRadius: "small",
            fontStack: "system",
          })}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}


