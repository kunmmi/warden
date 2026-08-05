import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { BandSection } from "@/components/BandSection";
import { ChainStats } from "@/components/ChainStats";
import { FeedPanel } from "@/components/FeedPanel";
import { KillSwitch } from "@/components/KillSwitch";
import { MarketTable } from "@/components/MarketTable";
import { RecoverPanel } from "@/components/RecoverPanel";
import { Statusbar } from "@/components/Statusbar";
import { TelegramCta } from "@/components/TelegramCta";
import { TradesPanel } from "@/components/TradesPanel";
import { WallPanel } from "@/components/WallPanel";

export default function Dashboard() {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="arrow"><LogoMark size={20} /></span>
          <span>warden</span>
          <span className="tagline">your AI trader, working 24/7</span>
        </div>
        <span className="chain-pill">
          <span className="dot" />
          BSC · 56
        </span>
        <ChainStats />
        <Link href="/scoreboard" className="mono" style={{ color: "var(--text-dim)", fontSize: 12 }}>
          scoreboard
        </Link>
        <Link href="/settings" className="mono" style={{ color: "var(--text-dim)", fontSize: 12 }}>
          settings
        </Link>
        <TelegramCta variant="pill" />
        <Link href="/grant" className="connect-btn" style={{ textDecoration: "none" }}>
          deploy an agent
        </Link>
      </header>

      <main className="shell">
        <section className="agents">
          <div className="section-title">your agents</div>
          <BandSection />

          <TradesPanel />

          <div className="section-title market-title">market</div>
          <MarketTable />
        </section>

        <aside className="rail">
          <TelegramCta />

          <WallPanel />

          <div className="panel">
            <KillSwitch />
          </div>

          <RecoverPanel />

          <div className="panel">
            <div className="section-title">activity</div>
            <FeedPanel />
          </div>
        </aside>
      </main>

      <Statusbar />
    </>
  );
}
