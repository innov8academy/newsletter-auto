import type { Metadata } from "next";
import { 
  Playfair_Display, 
  Plus_Jakarta_Sans, 
  JetBrains_Mono, 
  Anton, 
  Oswald, 
  Bebas_Neue,
  Bangers,
  Permanent_Marker,
  Passion_One,
  Black_Ops_One,
  Creepster,
  Bungee,
  Russo_One,
  Righteous,
  Press_Start_2P,
  Titan_One,
  Luckiest_Guy
} from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

// Meme fonts
const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  display: "swap",
  weight: "400",
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas",
  subsets: ["latin"],
  display: "swap",
  weight: "400",
});

// Additional meme fonts
const bangers = Bangers({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-bangers" });
const permanentMarker = Permanent_Marker({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-permanent-marker" });
const passionOne = Passion_One({ weight: ["400", "700"], subsets: ["latin"], display: "swap", variable: "--font-passion-one" });
const blackOpsOne = Black_Ops_One({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-black-ops" });
const creepster = Creepster({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-creepster" });
const bungee = Bungee({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-bungee" });
const russoOne = Russo_One({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-russo-one" });
const righteous = Righteous({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-righteous" });
const pressStart2P = Press_Start_2P({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-press-start" });
const titanOne = Titan_One({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-titan-one" });
const luckiestGuy = Luckiest_Guy({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-luckiest-guy" });

export const metadata: Metadata = {
  title: "Innov8 AI | Smart News Curation",
  description: "AI-powered news curation for the modern researcher",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${playfair.variable} ${jakarta.variable} ${jetbrains.variable} ${anton.variable} ${oswald.variable} ${bebasNeue.variable} ${bangers.variable} ${permanentMarker.variable} ${passionOne.variable} ${blackOpsOne.variable} ${creepster.variable} ${bungee.variable} ${russoOne.variable} ${righteous.variable} ${pressStart2P.variable} ${titanOne.variable} ${luckiestGuy.variable} font-sans antialiased bg-[#0B0B0F] text-white selection:bg-amber-500/20 selection:text-amber-200`}
      >
        {children}
      </body>
    </html>
  );
}
