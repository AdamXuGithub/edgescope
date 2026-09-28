import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EdgeScope — opening-price valuation for Panta markets",
  description:
    "EdgeScope prices Panta crypto prediction markets from spot and realised volatility and compares the model with live Panta quotes, after fees. Research only, not financial advice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
