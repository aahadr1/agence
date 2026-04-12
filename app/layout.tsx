import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: "variable",
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: "LàHaut Agency",
  description: "Agence digitale spécialisée en développement web, applications, CRM et génération de leads. Transformez votre présence digitale avec LàHaut Agency.",
  // Icons: use `app/favicon.ico`, `app/icon.*`, `app/apple-icon.png` (file convention).
  // Avoid listing missing `/public` paths — crawlers and Safari need real ICO/PNG.
  openGraph: {
    title: "LàHaut Agency",
    description: "Agence digitale spécialisée en développement web, applications, CRM et génération de leads.",
    siteName: "LàHaut Agency",
    locale: "fr_FR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeInit = `(function(){try{var k='agence-theme';var t=localStorage.getItem(k);var d=document.documentElement;if(t==='dark'){d.classList.add('dark');d.style.colorScheme='dark';}else if(t==='light'){d.classList.remove('dark');d.style.colorScheme='light';}else{var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(m){d.classList.add('dark');d.style.colorScheme='dark';}else{d.classList.remove('dark');d.style.colorScheme='light';}}}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}
      >
        <Script
          id="agence-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInit }}
        />
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
