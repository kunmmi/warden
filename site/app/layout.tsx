import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ScrollFx } from "@/components/ScrollFx";

// A refined, warm humanist grotesque — the closest open-source match to the
// polished agency-grade grotesques these sites use. One family, many weights.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap" });

const url = "https://TODO-your-domain.example";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: "warden — trading agents you never have to trust",
    template: "%s — warden",
  },
  description:
    "Self-hosted trading agents you never have to trust. On-chain trading is non-custodial: keys stay on your machine, every cap enforced by the account contract itself. Name your agent, chat with it and steer it from Telegram. For BNB Smart Chain.",
  // "non-custodial" is scoped to on-chain trading everywhere it appears —
  // deliberately: a future brokerage rail would be custodial by construction
  // (the broker holds the account; warden holds a revocable trading token),
  // and a product-wide absolute here would become false the day it ships.
  keywords: ["warden", "BNB Smart Chain", "BSC", "trading agent", "self-hosted", "non-custodial on-chain trading", "session keys", "Telegram bot", "crypto", "autonomous agent"],
  openGraph: {
    title: "warden — trading agents you never have to trust",
    description:
      "Self-hosted trading agents inside hard caps — on-chain, the chain itself enforces them, non-custodially. Verify the wall in the explorer; steer it from Telegram.",
    url,
    siteName: "warden",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "warden",
    description: "Trading agents you never have to trust — your keys, your caps, enforced on-chain.",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${mono.variable}`}>
      <body>
        {/* Arm the reveal layer before first paint so content never flashes in
            un-animated; a delayed backstop un-hides everything if JS stalled. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement;if(!matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.add('fx-ready');setTimeout(function(){if(!document.querySelector('[data-reveal].is-in'))d.classList.add('fx-done')},4000)}}catch(e){}",
          }}
        />
        <div className="page">
          <div className="ambient" />
          <div className="halftone" />
          <div className="grain" />
          <ScrollFx />
          <Nav />
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
