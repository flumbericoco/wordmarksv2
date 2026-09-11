import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NotificationsProvider } from '@/components/Notifications';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "wordmarks.net — AI Brand Logo Maker",
  description: "Generate complete, professional brand logos with AI. Guided brief, visual quality review, and meaningful iteration.",
  keywords: ["logo maker", "wordmark", "typography logo", "AI logo", "brand identity", "logo generator"],
  openGraph: {
    title: "wordmarks.net — AI Brand Logo Maker",
    description: "Generate complete professional logos with a distinctive symbol and readable wordmark.",
    url: "https://wordmarks.net",
    siteName: "wordmarks.net",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a0f] text-white"><NotificationsProvider>{children}</NotificationsProvider></body>
    </html>
  );
}
