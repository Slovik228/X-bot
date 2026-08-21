import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI X Bot — Multi-Model Twitter AI",
  description: "An X-native AI bot. Mention @aixbot with /claude /gpt /gemini /grok /deepseek /auto /compare /research /search and get a reply in-thread.",
  keywords: ["AI bot", "Twitter bot", "multi-model", "Claude", "GPT", "Gemini", "Grok", "DeepSeek"],
  authors: [{ name: "AI X Bot" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-neutral-950 text-neutral-100`}
      >
        {children}
        <SonnerToaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
